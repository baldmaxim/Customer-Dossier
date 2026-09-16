// Приёмка локальной установки (этап 09): контрольные числа и сравнение с сохранённым снимком.
//
//   npm run release:check                            контрольные числа текущей базы (DATABASE_URL), только чтение
//   npm run release:check -- --out before.json       сохранить снимок в файл
//   npm run release:check -- --compare before.json   сверить количества с сохранённым (после восстановления копии)
//
// Содержимое строк сверяет отдельная команда release:manifest; замеры — release:bench (только тестовая цель).
// Exit 1: расхождение, несовместимый формат, отсутствующая таблица, пропущенная или нарушенная проверка связности.
// Секреты и тексты публикаций не печатаются.

import fs from 'node:fs';

import { closeDb, getPool } from '../db/pool.js';
import { collectInventory, diffInventory, inventoryProblems, type IInventory } from './inventory.js';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const printInventory = (inv: IInventory): void => {
  console.log(`[release] ${inv.version} · база ${inv.database.name}${inv.database.isTestTarget ? ' (маркер тестовой цели)' : ''} · миграций ${inv.migrations.applied} (последняя ${inv.migrations.last ?? '—'})`);
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
  if (argv.includes('--bench') || argv.includes('--bench-run')) {
    console.error('[release] замеры — отдельная команда: npm run release:bench (только TEST_DATABASE_URL)');
    process.exitCode = 1;
    return;
  }

  const pool = getPool();
  const inventory = await collectInventory(pool);
  printInventory(inventory);

  const problems = inventoryProblems(inventory);
  for (const p of problems) console.log(`[release] ПРОБЛЕМА: ${p}`);
  if (problems.length > 0) process.exitCode = 1;

  const out = flag('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    console.log(`[release] снимок контрольных чисел записан: ${out}`);
  }

  const compare = flag('--compare');
  if (compare) {
    const before = JSON.parse(fs.readFileSync(compare, 'utf8')) as IInventory;
    const diff = diffInventory(before, inventory);
    if (diff.incompatible) {
      console.log(`[release] НЕСОВМЕСТИМО: ${diff.incompatible}`);
      process.exitCode = 1;
      return;
    }
    for (const n of diff.notes) console.log(`[release] ${n}`);
    if (diff.equal) {
      console.log(`[release] совпадает с ${compare}: миграции, количества, источники, решения и снимки без расхождений`);
      return;
    }
    console.log('[release] РАСХОЖДЕНИЯ:');
    for (const m of diff.migrations) console.log(`  миграции ${m.field}: было ${m.before}, стало ${m.after}`);
    for (const t of diff.missingTables) console.log(`  нет таблицы ${t.table} (${t.side === 'before' ? 'в сохранённом' : 'в текущем'})`);
    for (const s of diff.skippedIntegrity) console.log(`  проверка ${s.code} не выполнена (${s.side === 'before' ? 'в сохранённом' : 'в текущем'})`);
    for (const c of diff.counts) console.log(`  таблица ${c.table}: было ${c.before}, стало ${c.after}`);
    for (const s of diff.sources) console.log(`  источник ${s.key} · ${s.field}: было ${s.before}, стало ${s.after}`);
    for (const r of diff.reviews) console.log(`  решения ${r.decision}: было ${r.before}, стало ${r.after}`);
    for (const s of diff.snapshots) console.log(`  снимки ${s.field}: было ${s.before}, стало ${s.after}`);
    for (const c of diff.integrity) console.log(`  связность ${c.code} (${c.side === 'before' ? 'в сохранённом' : 'в текущем'}): нарушений ${c.violations}`);
    process.exitCode = 1;
  }
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[release] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
