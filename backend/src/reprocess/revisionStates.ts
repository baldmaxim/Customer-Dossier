// «Где тексты сейчас» (этап 22): состояние каждой последней редакции по её запускам. Одно правило на счётчики
// «Обработки» (`/api/admin/pipeline`) и на фильтр списка разборов (`/api/reprocess/runs?state=`): раньше плитка
// считала редакции, а список по нажатию показывал все запуски со статусом failed за всё время — «39» и «10»
// открывали один и тот же список, и число в нём не совпадало ни с одной плиткой.

import { modelTextPolicySql } from '../ingest/policy.js';
import type { RunStatus } from './workbench.js';

export const REVISION_STATES = [
  'irrelevant',
  'published',
  'completed_unpublished',
  'in_queue',
  'no_ai_permission',
  'failed_exhausted',
  'failed_retrying',
  'cancelled',
  'waiting',
  'unknown',
] as const;
export type RevisionState = (typeof REVISION_STATES)[number];

/**
 * Состояния, которые сводятся к запускам, и запуски, которыми их показывает список: по одному на редакцию —
 * последний из этих статусов. Остальные состояния (нет запусков, в карточках, не о стройке) запусками не объяснить.
 */
export const STATE_RUN_STATUSES = {
  failed_exhausted: ['failed', 'partial'],
  failed_retrying: ['failed', 'partial'],
  completed_unpublished: ['completed'],
  in_queue: ['queued', 'running'],
  cancelled: ['cancelled'],
} as const satisfies Partial<Record<RevisionState, readonly RunStatus[]>>;
export type RunListState = keyof typeof STATE_RUN_STATUSES;
export const RUN_LIST_STATES = Object.keys(STATE_RUN_STATUSES) as [RunListState, ...RunListState[]];

/**
 * (revision_id, item_id, state) по каждой последней редакции. Порядок CASE — смысловой: разобранное важнее
 * повтора, повтор — отмены. `retryMaxParam` — номер параметра запроса с REPROCESS_RETRY_MAX.
 */
export const revisionStatesSql = (retryMaxParam: number): string => `
  WITH latest AS (
    SELECT r.id AS revision_id, si.id AS item_id,
           ${modelTextPolicySql('s')} AS ai_allowed
    FROM document_revisions r
    JOIN source_items si ON si.id = r.source_item_id
    JOIN sources s ON s.id = si.source_id
    WHERE r.revision_no = (SELECT max(r2.revision_no) FROM document_revisions r2
                             WHERE r2.source_item_id = r.source_item_id)
  ),
  rolled AS (
    SELECT l.revision_id, l.item_id, l.ai_allowed,
           count(er.id)::int AS runs_total,
           count(er.id) FILTER (WHERE er.status IN ('failed', 'partial'))::int AS fails,
           bool_or(er.status IN ('queued', 'running')) AS live,
           bool_or(er.status = 'completed') AS done,
           bool_or(er.status = 'completed' AND er.relevant IS FALSE) AS irrelevant,
           bool_or(er.status IN ('failed', 'partial')) AS broken,
           bool_or(er.status = 'cancelled') AS cancelled
    FROM latest l
    LEFT JOIN extraction_runs er ON er.revision_id = l.revision_id
    GROUP BY l.revision_id, l.item_id, l.ai_allowed
  )
  SELECT revision_id, item_id,
         CASE
           WHEN done AND irrelevant THEN 'irrelevant'
           WHEN done AND EXISTS (SELECT 1 FROM item_publications p
                                   WHERE p.source_item_id = rolled.item_id AND p.active_set_id IS NOT NULL)
             THEN 'published'
           WHEN done THEN 'completed_unpublished'
           WHEN live THEN 'in_queue'
           WHEN NOT ai_allowed THEN 'no_ai_permission'
           WHEN broken AND fails >= $${retryMaxParam}::int THEN 'failed_exhausted'
           WHEN broken THEN 'failed_retrying'
           WHEN cancelled THEN 'cancelled'
           WHEN runs_total = 0 THEN 'waiting'
           ELSE 'unknown'
         END AS state
  FROM rolled`;
