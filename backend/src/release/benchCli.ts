// Замеры локальной установки: только выделенная тестовая цель TEST_DATABASE_URL.
//
//   npm run release:bench [-- --runs 5] [-- --out bench.json] [-- --pipeline-synthetic] [-- --profile-queries] [-- --case-id <id>]
//
// Порядок: общий preflight адреса (до импорта env и пула) → подключение и проверка базы, роли и маркера →
// только затем вход оператора в приложение и запись снимков. Никакого запасного DATABASE_URL.
// Exit 1: цель не прошла проверку, обязательный шаг без успешных выборок или нет данных для замера.

import fs from 'node:fs';

import { prepareTestTargetProcess } from '../db/testTargetBootstrap.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const main = async (): Promise<void> => {
  const target = prepareTestTargetProcess();
  const { closeDb, getPool } = await import('../db/pool.js');
  try {
    const { verifyConnectedTestDatabase } = await import('../db/testTarget.js');
    await verifyConnectedTestDatabase(getPool(), target);
    console.log(`[bench] тестовая цель подтверждена: ${target.host}:${target.port}/${target.database} (роль и маркер проверены)`);

    const { runBench } = await import('./bench.js');
    const runsArg = Number.parseInt(flag('--runs') ?? '', 10);
    const runs = Number.isSafeInteger(runsArg) && runsArg > 0 ? runsArg : 5;
    const caseArg = Number.parseInt(flag('--case-id') ?? '', 10);
    const { installQueryProfiler } = await import('./queryProfile.js');
    const profile = argv.includes('--profile-queries') ? installQueryProfiler(getPool()) : undefined;
    const report = await runBench(getPool(), { runs, profile, ...(Number.isSafeInteger(caseArg) && caseArg > 0 ? { caseId: caseArg } : {}) });
    profile?.uninstall();
    if (argv.includes('--pipeline-synthetic')) {
      const { runPipelineSyntheticBench } = await import('./benchPipeline.js');
      report.steps.push(await runPipelineSyntheticBench(runs));
    }

    const m = report.machine;
    console.log(`[bench] ${report.version} · ${m.platform} ${m.release} · ${m.cpu} · ядер ${m.cores} · память ${m.memoryGb} ГБ · Node ${m.node}`);
    console.log(`[bench] харнесс: ${report.harness}`);
    console.log(`[bench] объём до: ${Object.entries(report.volumeBefore).map(([t, n]) => `${t}=${n}`).join(', ')}`);
    for (const s of report.steps) {
      const time = s.median === null ? 'времени нет' : `медиана ${s.median} мс (мин ${s.min}, макс ${s.max}${s.p95 !== null ? `, p95 ${s.p95}` : ''})`;
      console.log(`[bench] ${s.status.toUpperCase()} ${s.code} — ${s.title}: ${time}; успешно ${s.successes}/${s.requested}, прогрев ${s.warmup.ok ? 'ok' : `ошибка (${s.warmup.detail})`}`);
      for (const e of s.errors) console.log(`[bench]   ошибка: HTTP ${e.status} ${e.detail}`);
      if (s.queries) {
        console.log(`[bench]   SQL: ${s.queries.queriesPerSample} запросов и ${s.queries.msPerSample} мс на выборку`);
        for (const q of s.queries.top) console.log(`[bench]     ${q.totalMs} мс / ${q.calls} выз.: ${q.sql}`);
        for (const q of s.queries.suspectedNPlusOne) console.log(`[bench]     N+1? ${q.callsPerSample} на выборку: ${q.sql}`);
      }
    }
    console.log(`[bench] объём после: ${Object.entries(report.volumeAfter).map(([t, n]) => `${t}=${n}`).join(', ')}`);
    for (const n of report.notes) console.log(`[bench] ${n}`);
    const out = flag('--out');
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      console.log(`[bench] отчёт записан: ${out}`);
    }
    if (!report.valid) {
      for (const r of report.invalidReasons) console.log(`[bench] НЕДЕЙСТВИТЕЛЕН: ${r}`);
      process.exitCode = 1;
    } else {
      console.log('[bench] отчёт действителен: все обязательные шаги имеют успешные выборки');
    }
  } finally {
    await closeDb().catch(() => undefined);
  }
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(err => {
    console.error('[bench] прервано:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
