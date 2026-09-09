// CLI пайплайна извлечения.
//
//   npm run pipeline:once -- --check          проверить, что LM Studio поднят
//   npm run pipeline:once                     обработать одну пачку из очереди
//   npm run pipeline:once -- --loop           крутить, пока очередь не опустеет
//   npm run pipeline:once -- --stats          состояние очереди и доля ошибок
//   npm run pipeline:once -- --merges         очередь на ручное слияние
//   npm run pipeline:once -- --merge <id>     подтвердить слияние
//   npm run pipeline:once -- --reject <id>    отклонить пару

import { closeDb, query, queryOne } from '../db/pool.js';
import { checkLlmConnection } from '../llm/client.js';
import { env } from '../config/env.js';
import { applyMerge, rejectMerge, listPendingMerges } from '../resolve/merge.js';
import { runPipelinePass } from './worker.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
};

const printPass = (results: Awaited<ReturnType<typeof runPipelinePass>>): number => {
  if (results.length === 0) {
    console.log('[pipeline] очередь пуста');
    return 0;
  }
  const totals = { extracted: 0, skipped: 0, failed: 0 };
  for (const r of results) totals[r.status] += 1;

  const applied = results.reduce(
    (acc, r) => {
      if (!r.stats) return acc;
      acc.companies += r.stats.companies;
      acc.projects += r.stats.projects;
      acc.mentions += r.stats.mentions;
      acc.participants += r.stats.participants;
      acc.events += r.stats.events;
      acc.queued += r.stats.queuedMerges;
      return acc;
    },
    { companies: 0, projects: 0, mentions: 0, participants: 0, events: 0, queued: 0 },
  );

  console.log(
    `[pipeline] обработано ${results.length}: извлечено ${totals.extracted}, ` +
      `пропущено ${totals.skipped}, ошибок ${totals.failed}`,
  );
  console.log(
    `[pipeline] в канон: компаний ${applied.companies}, объектов ${applied.projects}, ` +
      `упоминаний ${applied.mentions}, ролей ${applied.participants}, событий ${applied.events}`,
  );
  if (applied.queued > 0) {
    console.log(`[pipeline] на ручное слияние отправлено пар: ${applied.queued}`);
  }
  for (const r of results.filter(r => r.status === 'failed')) {
    console.error(`[pipeline] док ${r.documentId}: ${r.error}`);
  }
  return totals.extracted;
};

const showStats = async (): Promise<void> => {
  const q = await queryOne<{
    new_docs: number;
    extracting: number;
    extracted: number;
    failed: number;
    skipped: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('new','queued'))::int AS new_docs,
       count(*) FILTER (WHERE status = 'extracting')::int      AS extracting,
       count(*) FILTER (WHERE status = 'extracted')::int       AS extracted,
       count(*) FILTER (WHERE status = 'failed')::int          AS failed,
       count(*) FILTER (WHERE status = 'skipped')::int         AS skipped
     FROM raw_documents`,
  );
  console.log('[pipeline] очередь:');
  console.log(`  ожидают:    ${q?.new_docs ?? 0}`);
  console.log(`  в работе:   ${q?.extracting ?? 0}`);
  console.log(`  извлечены:  ${q?.extracted ?? 0}`);
  console.log(`  нерелевант: ${q?.skipped ?? 0}`);
  console.log(`  ошибки:     ${q?.failed ?? 0}`);

  const e = await queryOne<{ total: number; bad: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status <> 'ok')::int AS bad
     FROM extractions WHERE prompt_version = $1`,
    [env.PROMPT_VERSION],
  );
  const total = e?.total ?? 0;
  const bad = e?.bad ?? 0;
  const rate = total === 0 ? 0 : (bad / total) * 100;
  console.log(
    `[pipeline] версия промпта ${env.PROMPT_VERSION}: вызовов ${total}, ` +
      `неудачных ${bad} (${rate.toFixed(1)} %, цель M2 < 2 %)`,
  );

  const byFailure = await query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM extractions
     WHERE status <> 'ok' AND prompt_version = $1
     GROUP BY status ORDER BY n DESC`,
    [env.PROMPT_VERSION],
  );
  for (const row of byFailure) console.log(`  ${row.status}: ${row.n}`);
};

const showMerges = async (): Promise<void> => {
  const pending = await listPendingMerges();
  if (pending.length === 0) {
    console.log('[merge] очередь пуста');
    return;
  }
  console.log(`[merge] пар на подтверждение: ${pending.length}`);
  for (const p of pending) {
    console.log(
      `  #${p.id} ${p.entityKind} score=${Number(p.score).toFixed(2)}\n` +
        `      «${p.sourceName}»  ->  «${p.targetName}»\n` +
        `      ${JSON.stringify(p.reasons)}`,
    );
  }
  console.log('\nПодтвердить: --merge <id>   Отклонить: --reject <id>');
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--check')) {
    const llm = await checkLlmConnection();
    if (!llm.ok) {
      console.error(`[llm] недоступен по ${env.LMSTUDIO_BASE_URL}: ${llm.error}`);
      console.error('[llm] запустите LM Studio и включите локальный сервер.');
      process.exitCode = 1;
      return;
    }
    console.log(`[llm] доступен, моделей загружено: ${llm.models.length}`);
    for (const m of llm.models) {
      console.log(`  ${m}${m === env.LMSTUDIO_MODEL ? '  <-- LMSTUDIO_MODEL' : ''}`);
    }
    if (!llm.models.includes(env.LMSTUDIO_MODEL)) {
      console.warn(`[llm] модель ${env.LMSTUDIO_MODEL} не найдена среди загруженных`);
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--stats')) return showStats();
  if (process.argv.includes('--merges')) return showMerges();

  const mergeId = argValue('--merge');
  if (mergeId) {
    const result = await applyMerge({ queueId: Number(mergeId), decidedBy: 'cli' });
    console.log(
      `[merge] ${result.entityKind} ${result.sourceId} -> ${result.targetId}: ` +
        `перенесено упоминаний ${result.movedMentions}, ролей ${result.movedParticipants}`,
    );
    return;
  }

  const rejectId = argValue('--reject');
  if (rejectId) {
    await rejectMerge(Number(rejectId), 'cli');
    console.log(`[merge] пара #${rejectId} отклонена`);
    return;
  }

  if (process.argv.includes('--loop')) {
    for (;;) {
      const results = await runPipelinePass();
      if (results.length === 0) break;
      printPass(results);
    }
    console.log('[pipeline] очередь разобрана');
    return;
  }

  printPass(await runPipelinePass());
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[pipeline] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
