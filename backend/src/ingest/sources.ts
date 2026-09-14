// Операции над таблицей источников: выбор просроченных, курсор, журнал запусков.

import { query, queryOne, execute, withTransaction } from '../db/pool.js';
import { DELETE_WITH_DOCUMENTS_BLOCK_REASON } from '../pipeline/guard.js';
import type { PermissionStatus } from './policy.js';

export type SourceKind = 'telegram' | 'website' | 'manual';
export type SourceStatus = 'active' | 'paused' | 'broken';

export interface ISource {
  id: number;
  kind: SourceKind;
  key: string;
  title: string;
  baseUrl: string | null;
  cursor: Record<string, unknown>;
  config: Record<string, unknown>;
  status: SourceStatus;
  pollIntervalSec: number;
  failStreak: number;
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyExpiresAt: Date | null;
  isSynthetic: boolean;
}

const SELECT_COLUMNS = `
  id, kind, key, title, base_url AS "baseUrl", cursor, config,
  status, poll_interval_sec AS "pollIntervalSec", fail_streak AS "failStreak",
  access_status AS "accessStatus", ai_processing_status AS "aiProcessingStatus",
  policy_expires_at AS "policyExpiresAt", is_synthetic AS "isSynthetic"
`;

/**
 * Источники, которым пора. kind='manual' исключён: форварды и ручная вставка
 * приходят пушем, опрашивать там нечего.
 */
export const getDueSources = async (limit = 20): Promise<ISource[]> =>
  query<ISource>(
    `SELECT ${SELECT_COLUMNS} FROM sources
     WHERE status = 'active' AND kind <> 'manual' AND next_run_at <= now()
     ORDER BY next_run_at
     LIMIT $1`,
    [limit],
  );

export const getSourceByKey = async (kind: SourceKind, key: string): Promise<ISource | null> =>
  queryOne<ISource>(`SELECT ${SELECT_COLUMNS} FROM sources WHERE kind = $1 AND key = $2`, [
    kind,
    key,
  ]);

export const getSourceById = async (id: number): Promise<ISource | null> =>
  queryOne<ISource>(`SELECT ${SELECT_COLUMNS} FROM sources WHERE id = $1`, [id]);

export const startRun = async (sourceId: number): Promise<number> => {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO source_runs (source_id, status) VALUES ($1, 'running') RETURNING id`,
    [sourceId],
  );
  if (!row) throw new Error(`Не удалось создать source_run для источника ${sourceId}`);
  return row.id;
};

export interface IRunOutcome {
  itemsSeen: number;
  itemsNew: number;
  httpStatus: number | null;
  error: string | null;
  layoutStats: Record<string, number>;
}

/** Порог, после которого источник помечается сломанным и уходит из опроса. */
export const MAX_FAIL_STREAK = 3;

export const finishRun = async (
  runId: number,
  sourceId: number,
  outcome: IRunOutcome,
): Promise<void> => {
  const ok = outcome.error === null;

  await execute(
    `UPDATE source_runs
     SET finished_at = now(), status = $2, items_seen = $3, items_new = $4,
         http_status = $5, error = $6, layout_stats = $7
     WHERE id = $1`,
    [
      runId,
      ok ? 'ok' : 'failed',
      outcome.itemsSeen,
      outcome.itemsNew,
      outcome.httpStatus,
      outcome.error,
      JSON.stringify(outcome.layoutStats),
    ],
  );

  if (ok) {
    await execute(
      `UPDATE sources
       SET last_ok_at = now(), fail_streak = 0, updated_at = now(),
           next_run_at = now() + (poll_interval_sec || ' seconds')::interval
       WHERE id = $1`,
      [sourceId],
    );
    return;
  }

  // При неудаче отодвигаем следующий запуск экспоненциально: сломанный источник
  // не должен долбить Telegram каждые 15 минут. После MAX_FAIL_STREAK подряд —
  // снимаем с опроса и показываем в админке.
  await execute(
    `UPDATE sources
     SET fail_streak = fail_streak + 1,
         updated_at = now(),
         next_run_at = now() + (poll_interval_sec * least(power(2, fail_streak + 1), 16) || ' seconds')::interval,
         status = CASE WHEN fail_streak + 1 >= $2 THEN 'broken'::source_status ELSE status END
     WHERE id = $1`,
    [sourceId, MAX_FAIL_STREAK],
  );
};

/** Сдвиг курсора чтения. Merge, а не замена: в cursor могут лежать другие ключи. */
export const updateCursor = async (
  sourceId: number,
  patch: Record<string, unknown>,
): Promise<void> => {
  await execute(`UPDATE sources SET cursor = cursor || $2::jsonb, updated_at = now() WHERE id = $1`, [
    sourceId,
    JSON.stringify(patch),
  ]);
};

/** Пометить источник сломанным немедленно (закрытый канал, 404). */
export const markBroken = async (sourceId: number, reason: string): Promise<void> => {
  await execute(
    `UPDATE sources SET status = 'broken', fail_streak = fail_streak + 1, updated_at = now() WHERE id = $1`,
    [sourceId],
  );
  console.error(`[ingest] источник ${sourceId} помечен broken: ${reason}`);
};

/**
 * Новый источник всегда заводится на паузе и с неподтверждённым допуском:
 * включать опрос и разрешать сбор — отдельные осознанные действия оператора.
 */
export const addTelegramSource = async (channel: string, title?: string): Promise<ISource> => {
  const key = channel.replace(/^@/, '').trim();
  const row = await queryOne<ISource>(
    `INSERT INTO sources (kind, key, title, base_url, status)
     VALUES ('telegram', $1, $2, $3, 'paused')
     ON CONFLICT (kind, key) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [key, title ?? key, `https://t.me/s/${key}`],
  );
  if (!row) throw new Error(`Не удалось добавить канал ${key}`);
  return row;
};

export interface IDeleteSourceResult {
  deleted: boolean;
  documentCount: number;
  /** Почему не удалили, если не удалили. */
  reason: string | null;
}

/**
 * Удаление источника.
 *
 * По умолчанию отказываем, если по источнику есть документы. Причина не в
 * технике (внешний ключ и так не даст), а в сути портала: каждое утверждение
 * в карточке прослеживается до источника. Удалить источник, оставив документы,
 * значит разорвать эту цепочку — карточка продолжит показывать факты, про
 * которые больше нельзя сказать, откуда они.
 *
 * Обычно нужен не delete, а статус paused: источник перестаёт опрашиваться,
 * собранное остаётся.
 *
 * withDocuments сейчас заблокирован: каскад уносит упоминания и события, а
 * роли на объектах остаются без доказательства. Удаление с документами
 * вернётся вместе с моделью ревизий и доказательств (этапы 02–03A).
 */
export const deleteSource = async (
  id: number,
  withDocuments = false,
): Promise<IDeleteSourceResult> => {
  // Публикации и редакции (этап 02) — тоже собранные документы: их история
  // не удаляется вместе с источником.
  const row = await queryOne<{ n: number }>(
    `SELECT (SELECT count(*) FROM raw_documents WHERE source_id = $1)
          + (SELECT count(*) FROM source_items WHERE source_id = $1) AS n`,
    [id],
  );
  const documentCount = Number(row?.n ?? 0);

  if (documentCount > 0 && !withDocuments) {
    return {
      deleted: false,
      documentCount,
      reason:
        `по источнику собрано документов: ${documentCount}. Удаление разорвёт ` +
        'прослеживаемость фактов в карточках. Поставьте источник на паузу либо ' +
        'подтвердите удаление вместе с документами.',
    };
  }

  if (withDocuments && documentCount > 0) {
    // Каскад из схемы унёс бы mentions и events, а роли на объектах остались
    // бы без доказательства (evidence_document_id = NULL). До модели
    // доказательств (этапы 02–03A) такое удаление выключено.
    return { deleted: false, documentCount, reason: DELETE_WITH_DOCUMENTS_BLOCK_REASON };
  }

  const affected = await execute('DELETE FROM sources WHERE id = $1', [id]);
  return {
    deleted: affected > 0,
    documentCount,
    reason: affected > 0 ? null : 'источник не найден',
  };
};

/** Добавление сайта. RSS предпочтительнее: стабильнее любых селекторов. */
export const addWebsiteSource = async (
  key: string,
  title: string,
  baseUrl: string,
  config: Record<string, unknown> = {},
): Promise<ISource> => {
  const row = await queryOne<ISource>(
    `INSERT INTO sources (kind, key, title, base_url, status, config)
     VALUES ('website', $1, $2, $3, 'paused', $4::jsonb)
     ON CONFLICT (kind, key)
     DO UPDATE SET title = EXCLUDED.title, base_url = EXCLUDED.base_url,
                   config = EXCLUDED.config, updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [key, title, baseUrl, JSON.stringify(config)],
  );
  if (!row) throw new Error(`Не удалось добавить сайт ${key}`);
  return row;
};

export interface ISourcePolicyInput {
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  scope: string | null;
  basis: string | null;
  reference: string | null;
  owner: string | null;
  expiresAt: Date | null;
}

export class SourcePolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcePolicyValidationError';
  }
}

/**
 * Решение о допуске: одной транзакцией меняет поля и пишет журнал.
 * Разрешение без основания и ответственного не принимается (и в схеме тоже).
 */
export const updateSourcePolicy = async (
  sourceId: number,
  input: ISourcePolicyInput,
  changedBy: string,
): Promise<ISource | null> => {
  const approving = input.accessStatus === 'approved' || input.aiProcessingStatus === 'approved';
  if (approving && (!input.basis?.trim() || !input.owner?.trim())) {
    throw new SourcePolicyValidationError('Для разрешения обязательны основание и ответственный');
  }
  if (input.expiresAt !== null && input.expiresAt <= new Date() && approving) {
    throw new SourcePolicyValidationError('Срок действия разрешения уже истёк');
  }

  return withTransaction(async client => {
    const before = await client.query<{
      kind: SourceKind;
      key: string;
      snapshot: Record<string, unknown>;
    }>(
      `SELECT kind, key,
              jsonb_build_object(
                'accessStatus', access_status, 'aiProcessingStatus', ai_processing_status,
                'scope', policy_scope, 'basis', policy_basis, 'reference', policy_reference,
                'owner', policy_owner, 'decidedAt', policy_decided_at, 'expiresAt', policy_expires_at
              ) AS snapshot
       FROM sources WHERE id = $1 FOR UPDATE`,
      [sourceId],
    );
    const prev = before.rows[0];
    if (!prev) return null;

    const updated = await client.query<ISource>(
      `UPDATE sources
       SET access_status = $2::source_permission,
           ai_processing_status = $3::source_permission,
           policy_scope = $4, policy_basis = $5, policy_reference = $6, policy_owner = $7,
           policy_expires_at = $8, policy_decided_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [
        sourceId,
        input.accessStatus,
        input.aiProcessingStatus,
        input.scope,
        input.basis,
        input.reference,
        input.owner,
        input.expiresAt,
      ],
    );

    await client.query(
      `INSERT INTO source_policy_log (source_id, source_kind, source_key, changed_by, previous, next)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sourceId, prev.kind, prev.key, changedBy, JSON.stringify(prev.snapshot), JSON.stringify(input)],
    );

    return updated.rows[0] ?? null;
  });
};
