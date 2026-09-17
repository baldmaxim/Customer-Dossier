// Очередь ручного слияния: просмотр, отклонение и применение пары через
// безопасное слияние (resolve/entityMerge.ts). Вызывается ТОЛЬКО человеком —
// автоматического пути сюда нет по замыслу.

import { query, withTransaction } from '../db/pool.js';
import { assertMergeAllowed } from '../pipeline/guard.js';
import {
  MergeNotFoundError,
  applyEntityMerge,
  previewMerge,
  undoEntityMerge,
  type IMergeApplyResult,
  type IMergePreview,
  type IUndoResult,
} from './entityMerge.js';

interface IQueueRow {
  entity_kind: 'company' | 'project';
  source_entity_id: number;
  target_entity_id: number;
  status: string;
}

const loadQueue = async (queueId: number): Promise<IQueueRow> => {
  const row = (
    await query<IQueueRow>(
      `SELECT entity_kind, source_entity_id, target_entity_id, status::text AS status FROM merge_queue WHERE id = $1`,
      [queueId],
    )
  )[0];
  if (!row) throw new MergeNotFoundError(`Запись очереди ${queueId}`);
  return row;
};

/** Предпросмотр пары из очереди. Ничего не пишет. */
export const previewQueuedMerge = async (queueId: number): Promise<IMergePreview & { queueStatus: string }> => {
  const row = await loadQueue(queueId);
  const preview = await previewMerge(row.entity_kind, row.source_entity_id, row.target_entity_id);
  return { ...preview, queueStatus: row.status };
};

export interface IQueuedMergeRequest {
  queueId: number;
  actor: string;
  expectedSourceVersion: number;
  expectedTargetVersion: number;
  idempotencyKey: string;
  reason?: string | null;
  expectedPreviewToken?: string | null;
}

/** Применить пару из очереди: явное действие оператора с версиями из предпросмотра. */
export const applyQueuedMerge = async (request: IQueuedMergeRequest): Promise<IMergeApplyResult> => {
  assertMergeAllowed();
  const row = await loadQueue(request.queueId);
  if (row.status !== 'pending' && row.status !== 'merged') {
    throw new MergeNotFoundError(`Ожидающая запись очереди ${request.queueId}`);
  }
  return applyEntityMerge({
    kind: row.entity_kind,
    sourceId: row.source_entity_id,
    targetId: row.target_entity_id,
    expectedSourceVersion: request.expectedSourceVersion,
    expectedTargetVersion: request.expectedTargetVersion,
    idempotencyKey: request.idempotencyKey,
    actor: request.actor,
    reason: request.reason ?? null,
    queueId: request.queueId,
    expectedPreviewToken: request.expectedPreviewToken ?? null,
  });
};

export const undoMerge = async (mergeId: number, actor: string, idempotencyKey: string): Promise<IUndoResult> => {
  assertMergeAllowed();
  return undoEntityMerge({ mergeId, actor, idempotencyKey });
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

/** Очередь на подтверждение, самые уверенные пары сверху. Пары со слитыми сущностями не показываются. */
export const listPendingMerges = async (limit = 50): Promise<IPendingMerge[]> =>
  query<IPendingMerge>(
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
       AND coalesce(cs.merged_into_id, ps.merged_into_id) IS NULL
       AND coalesce(ct.merged_into_id, pt.merged_into_id) IS NULL
     ORDER BY q.score DESC
     LIMIT $1`,
    [limit],
  );

export interface IMergeHistoryItem {
  id: number;
  entityKind: 'company' | 'project';
  sourceId: number;
  targetId: number;
  sourceName: string | null;
  targetName: string | null;
  status: 'applied' | 'undone';
  actor: string;
  reason: string | null;
  counts: Record<string, number>;
  createdAt: string;
  undoneAt: string | null;
}

/** Журнал слияний: подписи сторон — из снимка на момент слияния, а не из текущих строк. */
export const listMergeHistory = async (limit = 50): Promise<IMergeHistoryItem[]> =>
  query<IMergeHistoryItem>(
    `SELECT id, entity_kind AS "entityKind", source_id AS "sourceId", target_id AS "targetId",
            source_snapshot->'row'->>'name' AS "sourceName", target_snapshot->'row'->>'name' AS "targetName",
            status, actor, reason, counts, created_at AS "createdAt", undone_at AS "undoneAt"
     FROM entity_merges ORDER BY id DESC LIMIT $1`,
    [limit],
  );
