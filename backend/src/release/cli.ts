// Приёмка локальной установки (этап 09): контрольные числа, сравнение с сохранённым снимком, замеры.
//
//   npm run release:check                      контрольные числа текущей базы
//   npm run release:check -- --out before.json сохранить снимок в файл
//   npm run release:check -- --compare before.json   сверить с сохранённым (после восстановления копии)
//   npm run release:bench [-- --runs 5]        фактические времена поиска, карточки, схемы, снимка
//
// Пишущие действия: только шаг «создание снимка» в замерах. Цель обязана быть тестовой — иначе отказ.
// Секреты и тексты публикаций не печатаются.

import fs from 'node:fs';

import { closeDb, getPool } from '../db/pool.js';
import { collectInventory, diffInventory, type IInventory } from './inventory.js';
import { runBench } from './bench.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const isTestTarget = (name: string): boolean => /test/i.test(name);

const printInventory = (inv: IInventory): void => {
  console.log(`[release] ${inv.version} · база ${inv.database.name} · миграций ${inv.migrations.applied} (последняя ${inv.migrations.last ?? '—'})`);
  const counts = Object.entries(inv.counts).filter(([, n]) => n > 0);
  console.log(`[release] непустых таблиц ${counts.length}: ${counts.map(([t, n]) => `${t}=${n}`).join(', ')}`);
  const broken = inv.integrity.filter(c => c.violations > 0);
  console.log(broken.length === 0 ? `[release] связность: нарушений нет (${inv.integrity.length} проверок)` : `[release] СВЯЗНОСТЬ НАРУШЕНА: ${broken.map(c => `${c.code}=${c.violations}`).join(', ')}`);
  for (const s of inv.sources) {
    console.log(`[release] источник ${s.key} (${s.kind}): ${s.status}, сбор ${s.accessStatus}, ИИ ${s.aiProcessingStatus}, публикаций ${s.items}${s.isSynthetic ? ', синтетический' : ''}`);
  }
  console.log(`[release] решения аналитика: ${inv.reviews.total}${inv.reviews.total ? ` (${Object.entries(inv.reviews.byDecision).map(([d, n]) => `${d}=${n}`).join(', ')})` : ''}`);
  console.log(`[release] снимки досье: ${inv.snapshots.total}, с вымаранными фрагментами ${inv.snapshots.redacted}`);
  console.log(`[release] флаги: ${Object.entries(inv.flags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
};

const main = async (): Promise<void> => {
  const pool = getPool();
  const inventory = await collectInventory(pool);

  if (argv.includes('--bench')) {
    console.error('[release] замеры — отдельная команда: npm run release:bench');
    process.exitCode = 1;
    return;
  }

  printInventory(inventory);

  const out = flag('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    console.log(`[release] снимок контрольных чисел записан: ${out}`);
  }

  const compare = flag('--compare');
  if (compare) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8')) as IInventory;
    const diff = diffInventory(before, inventory);
    for (const n of diff.notes) console.log(`[release] ${n}`);
    if (diff.equal) {
      console.log(`[release] совпадает с ${compare}: количества, источники, решения и снимки без расхождений`);
      return;
    }
    console.log('[release] РАСХОЖДЕНИЯ:');
    for (const c of diff.counts) console.log(`  таблица ${c.table}: было ${c.before}, стало ${c.after}`);
    for (const s of diff.sources) console.log(`  источник ${s.key} · ${s.field}: было ${s.before}, стало ${s.after}`);
    for (const r of diff.reviews) console.log(`  решения ${r.decision}: было ${r.before}, стало ${r.after}`);
    for (const s of diff.snapshots) console.log(`  снимки ${s.field}: было ${s.before}, стало ${s.after}`);
    for (const c of diff.integrity) console.log(`  связность ${c.code}: нарушений ${c.violations}`);
    process.exitCode = 1;
  }
};

const bench = async (): Promise<void> => {
  const pool = getPool();
  const name = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
  if (!isTestTarget(name)) {
    console.error(`[release] замеры создают снимок досье и запускаются только на тестовой базе; текущая — ${name}`);
    process.exitCode = 1;
    return;
  }
  const runsArg = Number.parseInt(flag('--runs') ?? '', 10);
  const report = await runBench(pool, { runs: Number.isSafeInteger(runsArg) && runsArg > 0 ? runsArg : 5 });
  console.log(`[bench] ${report.machine.platform} ${report.machine.release} · ${report.machine.cpu} · ядер ${report.machine.cores} · память ${report.machine.memoryGb} ГБ · Node ${report.machine.node}`);
  console.log(`[bench] объём: ${Object.entries(report.volume).map(([t, n]) => `${t}=${n}`).join(', ')}`);
  for (const s of report.steps) {
    console.log(`[bench] ${s.title}: медиана ${s.median} мс (мин ${s.min}, макс ${s.max}, прогонов ${s.runs})${s.note ? ` — ${s.note}` : ''}`);
  }
  for (const n of report.notes) console.log(`[bench] ${n}`);
  const out = flag('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[bench] отчёт записан: ${out}`);
  }
};

const run = argv.includes('--bench-run') ? bench : main;
run()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[release] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
