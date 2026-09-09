// Исполнение слияния сущностей. Вызывается ТОЛЬКО человеком из очереди —
// автоматического пути сюда нет по замыслу.
//
// Здесь же живёт единственное место, где переставляется полиморфный
// mentions.entity_id. Схема сознательно не имеет на него FK (иначе понадобились
// бы две почти одинаковые таблицы), и цена этого решения — вот эта функция.
// Любой новый объект, ссылающийся на компанию или проект, обязан быть добавлен
// в неё, иначе слияние оставит висячие ссылки.

import { withTransaction } from '../db/pool.js';
import { refreshCompanyMetrics } from '../metrics/refresh.js';

export interface IMergeRequest {
  queueId: number;
  decidedBy: string;
}

export interface IMergeResult {
  entityKind: 'company' | 'project';
  sourceId: number;
  targetId: number;
  movedMentions: number;
  movedParticipants: number;
}

interface IQueueRow {
  entity_kind: 'company' | 'project';
  source_entity_id: number;
  target_entity_id: number;
  status: string;
}

/**
 * Подтвердить слияние из очереди. Всё в одной транзакции: частично слитая
 * сущность хуже, чем не слитая вовсе.
 */
export const applyMerge = async (request: IMergeRequest): Promise<IMergeResult> => {
  const result = await withTransaction(async client => {
    // FOR UPDATE: два модератора не должны обработать одну пару одновременно.
    const queue = await client.query<IQueueRow>(
      `SELECT entity_kind, source_entity_id, target_entity_id, status
       FROM merge_queue WHERE id = $1 FOR UPDATE`,
      [request.queueId],
    );
    const row = queue.rows[0];
    if (!row) throw new Error(`Запись очереди ${request.queueId} не найдена`);
    if (row.status !== 'pending') {
      throw new Error(`Запись очереди ${request.queueId} уже обработана (${row.status})`);
    }

    const { entity_kind: kind, source_entity_id: sourceId, target_entity_id: targetId } = row;
    if (sourceId === targetId) throw new Error('Нельзя слить сущность саму с собой');

    const table = kind === 'company' ? 'companies' : 'projects';

    // Ставим tombstone. Сама строка остаётся: на неё могут ссылаться внешние
    // ссылки и закладки, и отдать 404 хуже, чем редирект на живую сущность.
    await client.query(
      `UPDATE ${table} SET merged_into_id = $2, updated_at = now() WHERE id = $1`,
      [sourceId, targetId],
    );

    // Алиасы переносим со сложением счётчиков: hits показывает, насколько
    // написание распространено, и терять его при слиянии незачем.
    await client.query(
      `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source, hits)
       SELECT $1, $3, alias, alias_norm, alias_latin, source, hits
       FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2
       ON CONFLICT (entity_kind, entity_id, alias_norm)
       DO UPDATE SET hits = entity_aliases.hits + EXCLUDED.hits`,
      [kind, sourceId, targetId],
    );
    await client.query(`DELETE FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2`, [
      kind,
      sourceId,
    ]);

    const mentions = await client.query(
      `UPDATE mentions SET entity_id = $3 WHERE entity_kind = $1 AND entity_id = $2`,
      [kind, sourceId, targetId],
    );

    let participants = 0;

    if (kind === 'company') {
      await client.query(`UPDATE events SET company_id = $2 WHERE company_id = $1`, [
        sourceId,
        targetId,
      ]);
      await client.query(`UPDATE events SET counterparty_id = $2 WHERE counterparty_id = $1`, [
        sourceId,
        targetId,
      ]);

      // Перенос ролей с защитой от нарушения pp_current_uidx: если у цели уже
      // есть открытая запись с той же ролью на том же объекте, переносить нечего.
      const moved = await client.query(
        `UPDATE project_participants pp SET company_id = $2, updated_at = now()
         WHERE pp.company_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM project_participants x
             WHERE x.project_id = pp.project_id AND x.company_id = $2
               AND x.role = pp.role AND x.ended_on IS NULL
           )`,
        [sourceId, targetId],
      );
      participants = moved.rowCount ?? 0;
      await client.query(`DELETE FROM project_participants WHERE company_id = $1`, [sourceId]);
    } else {
      await client.query(`UPDATE events SET project_id = $2 WHERE project_id = $1`, [
        sourceId,
        targetId,
      ]);
      const moved = await client.query(
        `UPDATE project_participants pp SET project_id = $2, updated_at = now()
         WHERE pp.project_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM project_participants x
             WHERE x.project_id = $2 AND x.company_id = pp.company_id
               AND x.role = pp.role AND x.ended_on IS NULL
           )`,
        [sourceId, targetId],
      );
      participants = moved.rowCount ?? 0;
      await client.query(`DELETE FROM project_participants WHERE project_id = $1`, [sourceId]);
    }

    await client.query(
      `UPDATE merge_queue SET status = 'merged', decided_by = $2, decided_at = now() WHERE id = $1`,
      [request.queueId, request.decidedBy],
    );

    // Пары, где слитая сущность фигурировала как кандидат, больше не актуальны.
    await client.query(
      `UPDATE merge_queue SET status = 'rejected', decided_by = $2, decided_at = now()
       WHERE status = 'pending' AND entity_kind = $3
         AND (source_entity_id = $1 OR target_entity_id = $1)`,
      [sourceId, request.decidedBy, kind],
    );

    return {
      entityKind: kind,
      sourceId,
      targetId,
      movedMentions: mentions.rowCount ?? 0,
      movedParticipants: participants,
    };
  });

  // Метрики пересчитываем после коммита: внутри транзакции REFRESH CONCURRENTLY
  // работать не может.
  await refreshCompanyMetrics();

  return result;
};

/** Отклонить пару: она больше не всплывёт в очереди. */
export const rejectMerge = async (queueId: number, decidedBy: string): Promise<void> => {
  await withTransaction(async client => {
    const res = await client.query(
      `UPDATE merge_queue SET status = 'rejected', decided_by = $2, decided_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [queueId, decidedBy],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw new Error(`Запись очереди ${queueId} не найдена или уже обработана`);
    }
  });
};

export interface IPendingMerge {
  id: number;
  entityKind: 'company' | 'project';
  score: number;
  reasons: Record<string, unknown>;
  sourceName: string;
  targetName: string;
  sourceId: number;
  targetId: number;
  sampleDocumentId: number | null;
}

/** Очередь на подтверждение, самые уверенные пары сверху. */
export const listPendingMerges = async (limit = 50): Promise<IPendingMerge[]> => {
  const { query } = await import('../db/pool.js');
  return query<IPendingMerge>(
    `SELECT q.id,
            q.entity_kind          AS "entityKind",
            q.score,
            q.reasons,
            q.source_entity_id     AS "sourceId",
            q.target_entity_id     AS "targetId",
            q.sample_document_id   AS "sampleDocumentId",
            coalesce(cs.name, ps.name) AS "sourceName",
            coalesce(ct.name, pt.name) AS "targetName"
     FROM merge_queue q
     LEFT JOIN companies cs ON q.entity_kind = 'company' AND cs.id = q.source_entity_id
     LEFT JOIN companies ct ON q.entity_kind = 'company' AND ct.id = q.target_entity_id
     LEFT JOIN projects  ps ON q.entity_kind = 'project' AND ps.id = q.source_entity_id
     LEFT JOIN projects  pt ON q.entity_kind = 'project' AND pt.id = q.target_entity_id
     WHERE q.status = 'pending'
     ORDER BY q.score DESC
     LIMIT $1`,
    [limit],
  );
};
