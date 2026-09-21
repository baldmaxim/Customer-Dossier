// Проход нового конвейера: постановка новых редакций, захват запусков,
// выполнение и (только по отдельному флагу) публикация.
//
// Автопостановка берёт лишь редакции, которые ещё никто не разбирал: последнюю
// редакцию публикации без единого запуска, чей legacy-документ не был разобран
// старым путём. Переразбор уже разобранного — только явной командой с лимитом.

import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { approvedPolicySql } from '../ingest/policy.js';
import { NotPublishableError, PublicationConflictError, publishCandidateSet, type IPublishResult } from './publish.js';
import type { IModelProvider } from './provider.js';
import { claimNextRun, enqueueRun, processRun, StaleLeaseError, type IRunResult } from './runs.js';

export const enqueueNewRevisions = async (provider: IModelProvider, limit: number): Promise<number> => {
  const rows = (
    await getPool().query<{ id: number }>(
      `SELECT r.id
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       LEFT JOIN raw_documents d ON d.id = r.legacy_document_id
       WHERE r.revision_no = (SELECT max(r2.revision_no) FROM document_revisions r2 WHERE r2.source_item_id = r.source_item_id)
         AND NOT EXISTS (SELECT 1 FROM extraction_runs er WHERE er.revision_id = r.id)
         AND (d.id IS NULL OR d.status NOT IN ('extracted', 'skipped'))
         AND ${approvedPolicySql('s', 'ai_processing')}
       ORDER BY r.first_observed_at DESC, r.id
       LIMIT $1`,
      [limit],
    )
  ).rows;
  let queued = 0;
  for (const row of rows) {
    const result = await enqueueRun(getPool(), { revisionId: row.id, provider, requestedBy: 'worker' });
    if (result.outcome === 'queued') queued += 1;
  }
  return queued;
};

export interface IPassResult {
  run: IRunResult | null;
  error: string | null;
  publish: IPublishResult | null;
  /** Разбор прошёл, но набор публиковать нельзя: причина словами. */
  publishRefusal: string | null;
}

export const runReprocessPass = async (
  provider: IModelProvider,
  options: { maxRuns?: number; autoPublish?: boolean; owner?: string; enqueueLimit?: number } = {},
): Promise<IPassResult[]> => {
  const owner = options.owner ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  if (options.enqueueLimit && options.enqueueLimit > 0) await enqueueNewRevisions(provider, options.enqueueLimit);

  const results: IPassResult[] = [];
  const maxRuns = options.maxRuns ?? env.EXTRACT_BATCH_SIZE;
  for (let i = 0; i < maxRuns; i += 1) {
    // Только запуски идентичности модели этого исполнителя: чужую конфигурацию не исполняем и не переписываем.
    const claim = await claimNextRun(owner, { provider });
    if (!claim) break;
    try {
      const run = await processRun(provider, claim);
      let publish: IPublishResult | null = null;
      let publishRefusal: string | null = null;
      if (options.autoPublish && run.candidateSetId !== null) {
        // Автопубликация без allowStale: устаревший разбор остаётся кандидатом.
        const version = (
          await getPool().query<{ version: number }>(
            `SELECT coalesce((SELECT p.version FROM item_publications p
                              JOIN candidate_sets cs ON cs.source_item_id = p.source_item_id
                              WHERE cs.id = $1), 0) AS version`,
            [run.candidateSetId],
          )
        ).rows[0]!.version;
        try {
          publish = await publishCandidateSet({ setId: run.candidateSetId, expectedVersion: version, actor: 'auto' });
        } catch (err) {
          // Отказ публикации — исход набора, а не падение запуска. Раньше он летел
          // в общий catch, и успешный разбор попадал в лог как «запуск прерван».
          if (err instanceof NotPublishableError || err instanceof PublicationConflictError) {
            publishRefusal = err.message;
            console.warn(`[reprocess] запуск ${claim.runId}: набор не опубликован — ${err.message}`);
          } else {
            throw err;
          }
        }
      }
      results.push({ run, error: null, publish, publishRefusal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Потерянный lease — не ошибка данных: запуск продолжит другой worker.
      if (!(err instanceof StaleLeaseError)) console.error(`[reprocess] запуск ${claim.runId}: ${message}`);
      results.push({ run: null, error: message, publish: null, publishRefusal: null });
    }
  }
  return results;
};
