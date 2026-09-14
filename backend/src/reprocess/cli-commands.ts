// Команды CLI нового конвейера (этап 03B). Разбор аргументов — в pipeline/cli.ts.

import { getPool } from '../db/pool.js';
import { approvedPolicySql } from '../ingest/policy.js';
import { previewCandidateSet, publishCandidateSet, type IPreviewItem } from './publish.js';
import { lmStudioProvider } from './provider.js';
import { enqueueRun, retryRun } from './runs.js';
import { runReprocessPass, type IPassResult } from './worker.js';

/** Потолок одной команды переразбора: массовый переразбор рабочей базы — не одной командой. */
export const REEXTRACT_MAX_LIMIT = 200;

export const showRuns = async (limit = 20): Promise<void> => {
  const rows = (
    await getPool().query<{
      id: number;
      revision_id: number;
      status: string;
      covered_chars: number | null;
      total_chars: number | null;
      relevant: boolean | null;
      error: string | null;
      set_id: number | null;
      set_status: string | null;
      created_at: Date;
    }>(
      `SELECT er.id, er.revision_id, er.status, er.covered_chars, er.total_chars, er.relevant, er.error,
              cs.id AS set_id, cs.status AS set_status, er.created_at
       FROM extraction_runs er LEFT JOIN candidate_sets cs ON cs.run_id = er.id
       ORDER BY er.id DESC LIMIT $1`,
      [limit],
    )
  ).rows;
  if (rows.length === 0) {
    console.log('[runs] запусков нет');
    return;
  }
  for (const r of rows) {
    const coverage = r.total_chars !== null ? ` ${r.covered_chars ?? 0}/${r.total_chars}` : '';
    const set = r.set_id !== null ? ` набор #${r.set_id} (${r.set_status})` : '';
    const relevant = r.relevant === null ? '' : r.relevant ? ' релевантен' : ' нерелевантен';
    console.log(`#${r.id} ред.${r.revision_id} ${r.status}${coverage}${relevant}${set}${r.error ? ` — ${r.error}` : ''}`);
  }
};

export const reextractCommand = async (options: {
  limit: number | null;
  sourceKey: string | null;
  documentId: number | null;
}): Promise<void> => {
  if (options.limit === null || !Number.isInteger(options.limit) || options.limit <= 0) {
    console.error(`[reextract] нужен явный --limit N (1…${REEXTRACT_MAX_LIMIT}): переразбор без лимита запрещён`);
    process.exitCode = 1;
    return;
  }
  const limit = Math.min(options.limit, REEXTRACT_MAX_LIMIT);
  const rows = (
    await getPool().query<{ id: number }>(
      `SELECT r.id
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE r.revision_no = (SELECT max(r2.revision_no) FROM document_revisions r2 WHERE r2.source_item_id = r.source_item_id)
         AND ($1::text IS NULL OR s.key = $1)
         AND ($2::bigint IS NULL OR r.source_item_id IN (
               SELECT r3.source_item_id FROM document_revisions r3 WHERE r3.legacy_document_id = $2))
         AND ${approvedPolicySql('s', 'ai_processing')}
       ORDER BY r.first_observed_at DESC, r.id
       LIMIT $3`,
      [options.sourceKey, options.documentId, limit],
    )
  ).rows;

  const provider = lmStudioProvider();
  const totals = { queued: 0, already_live: 0, refused_policy: 0, not_found: 0 };
  for (const row of rows) {
    const result = await enqueueRun(getPool(), { revisionId: row.id, provider, requestedBy: 'cli' });
    totals[result.outcome] += 1;
  }
  console.log(
    `[reextract] поставлено ${totals.queued}, уже в очереди ${totals.already_live}, отказ политики ${totals.refused_policy}` +
      ` (лимит ${limit}). Карточки не меняются до публикации набора: --runs, --preview <набор>, --publish <набор>.`,
  );
};

export const retryRunsCommand = async (limit: number): Promise<void> => {
  const rows = (
    await getPool().query<{ id: number }>(
      `SELECT er.id FROM extraction_runs er
       WHERE er.status IN ('failed', 'partial')
         AND NOT EXISTS (
           SELECT 1 FROM extraction_runs newer
           WHERE newer.revision_id = er.revision_id AND newer.id > er.id)
       ORDER BY er.id DESC LIMIT $1`,
      [Math.min(limit, REEXTRACT_MAX_LIMIT)],
    )
  ).rows;
  const provider = lmStudioProvider();
  let queued = 0;
  for (const row of rows) {
    const result = await retryRun(row.id, provider, 'cli-retry');
    if (result.outcome === 'queued') queued += 1;
  }
  console.log(`[retry] новых запусков вместо провалившихся: ${queued} (прежние запуски не изменены)`);
};

const printPassResults = (results: IPassResult[]): void => {
  for (const r of results) {
    if (!r.run) {
      console.log(`[pipeline] запуск прерван: ${r.error ?? '—'}`);
      continue;
    }
    const set = r.run.candidateSetId !== null ? `, набор #${r.run.candidateSetId}` : '';
    const publish = r.publish ? `, публикация: ${r.publish.outcome}` : '';
    console.log(
      `[pipeline] запуск #${r.run.runId}: ${r.run.status}, покрыто ${r.run.coveredChars}/${r.run.totalChars}${set}${publish}` +
        (r.run.error ? ` — ${r.run.error}` : ''),
    );
  }
};

export const processRunsCommand = async (loop: boolean): Promise<void> => {
  const provider = lmStudioProvider();
  for (;;) {
    // Из CLI — без автопостановки и без автопубликации: только уже поставленные запуски.
    const results = await runReprocessPass(provider, { autoPublish: false });
    if (results.length === 0) {
      console.log('[pipeline] очередь запусков пуста');
      return;
    }
    printPassResults(results);
    if (!loop) return;
  }
};

const printItems = (title: string, items: IPreviewItem[]): void => {
  if (items.length === 0) return;
  console.log(`${title} (${items.length}):`);
  for (const item of items.slice(0, 30)) {
    console.log(`  ${item.signature}${item.quotes[0] ? `  «${item.quotes[0].slice(0, 100)}»` : ''}`);
  }
};

export const previewCommand = async (setId: number): Promise<void> => {
  const p = await previewCandidateSet(setId);
  console.log(
    `[preview] набор #${p.setId} (${p.status}), публикация ${p.sourceItemId}: активный набор ${p.activeSetId ?? '—'}, версия ${p.expectedVersion}`,
  );
  console.log(`  релевантен: ${p.relevant ? 'да' : 'нет'}`);
  if (!p.policy.allowed) console.log(`  ПОЛИТИКА: ${p.policy.reason}`);
  if (p.stale.stale) console.log(`  УСТАРЕЛ: ${p.stale.reason} (публикация только с --allow-stale)`);
  printItems('+ добавится', p.added);
  printItems('- снимется основание', p.removed);
  printItems('= без изменений', p.kept);
  for (const c of p.changed) console.log(`~ изменение: ${c.before}  →  ${c.after}`);
  printItems('? без цитаты (не публикуется)', p.ungrounded);
  for (const r of p.reviewImpact) {
    console.log(`! решение аналитика: утверждение #${r.assertionId} (${r.status}, решений ${r.decisions}) — может потребовать пересмотра`);
  }
  for (const c of p.contradictions) console.log(`! есть опровержение: утверждение #${c.assertionId}`);
};

export const publishCommand = async (setId: number, allowStale: boolean): Promise<void> => {
  const preview = await previewCandidateSet(setId);
  const result = await publishCandidateSet({
    setId,
    expectedVersion: preview.expectedVersion,
    actor: 'cli',
    allowStale,
  });
  console.log(
    `[publish] набор #${setId}: ${result.outcome}, версия ${result.version}` +
      (result.outcome === 'published'
        ? `; утверждений ${result.assertions}, новых оснований ${result.evidenceAdded}, снято ${result.evidenceSuperseded}`
        : '') +
      (result.reason ? ` — ${result.reason}` : ''),
  );
  if (result.outcome === 'rejected_policy' || result.outcome === 'rejected_stale') process.exitCode = 1;
};
