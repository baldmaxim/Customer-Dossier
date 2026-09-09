// Операции над таблицей источников: выбор просроченных, курсор, журнал запусков.

import { query, queryOne, execute } from '../db/pool.js';

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
}

const SELECT_COLUMNS = `
  id, kind, key, title, base_url AS "baseUrl", cursor, config,
  status, poll_interval_sec AS "pollIntervalSec", fail_streak AS "failStreak"
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

export const addTelegramSource = async (channel: string, title?: string): Promise<ISource> => {
  const key = channel.replace(/^@/, '').trim();
  const row = await queryOne<ISource>(
    `INSERT INTO sources (kind, key, title, base_url, status)
     VALUES ('telegram', $1, $2, $3, 'active')
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
 * withDocuments — для честных ошибок: добавили не тот канал, он натаскал
 * мусора. Тогда удаляем вместе с документами, а каскад уносит упоминания
 * и события. Компании и объекты остаются: они могли упоминаться и в других
 * источниках, а осиротевшие подчистит --recheck.
 */
export const deleteSource = async (
  id: number,
  withDocuments = false,
): Promise<IDeleteSourceResult> => {
  const row = await queryOne<{ n: number }>(
    'SELECT count(*)::int AS n FROM raw_documents WHERE source_id = $1',
    [id],
  );
  const documentCount = row?.n ?? 0;

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
    // Каскад из схемы уносит mentions и events; document_sightings тоже.
    await execute('DELETE FROM raw_documents WHERE source_id = $1', [id]);
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
     VALUES ('website', $1, $2, $3, 'active', $4::jsonb)
     ON CONFLICT (kind, key)
     DO UPDATE SET title = EXCLUDED.title, base_url = EXCLUDED.base_url,
                   config = EXCLUDED.config, status = 'active', updated_at = now()
     RETURNING ${SELECT_COLUMNS}`,
    [key, title, baseUrl, JSON.stringify(config)],
  );
  if (!row) throw new Error(`Не удалось добавить сайт ${key}`);
  return row;
};
