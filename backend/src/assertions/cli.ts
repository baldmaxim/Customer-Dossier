// Backfill утверждений из legacy-канона.
//
//   npm run backfill:assertions                       dry-run: транзакции с откатом, сводка
//   npm run backfill:assertions -- --apply            записать пакетами с checkpoint
//   npm run backfill:assertions -- --batch 500        размер пакета (1–5000)
//   npm run backfill:assertions -- --from-start       пройти заново (проверка идемпотентности)
//   npm run backfill:assertions -- --report out.json  сохранить отчёт
//
// Требует выполненного backfill:revisions: доказательство ссылается на редакцию.
// На рабочей базе — только после backup и отдельного решения.

import fs from 'node:fs';

import { closeDb, getPool } from '../db/pool.js';
import { runLegacyAssertionBackfill } from './backfill.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const report = await runLegacyAssertionBackfill(getPool(), {
    dryRun: !apply,
    batchSize: Number(argValue('--batch') ?? 500),
    fromStart: process.argv.includes('--from-start'),
  });
  console.log(`[assertions] ${apply ? 'ЗАПИСЬ' : 'dry-run (ничего не записано)'}`);
  console.log(JSON.stringify(report, null, 2));
  const reportPath = argValue('--report');
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[assertions] отчёт: ${reportPath}`);
  }
};

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async err => {
    console.error('[assertions] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
