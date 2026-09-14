// Backfill публикаций и редакций из legacy-документов.
//
//   npm run backfill:revisions                         dry-run: всё в транзакции и откат, отчёт
//   npm run backfill:revisions -- --apply              записать (пакетами, с checkpoint)
//   npm run backfill:revisions -- --batch 500          размер пакета (1–5000, по умолчанию 500)
//   npm run backfill:revisions -- --max-batches 3      не больше N пакетов за запуск
//   npm run backfill:revisions -- --from-start         игнорировать checkpoint (проверка идемпотентности)
//   npm run backfill:revisions -- --report out.json    сохранить отчёт в файл
//
// На рабочей базе — только после backup и отдельного решения. Команда не
// запускается автоматически ни миграцией, ни стартом приложения.

import fs from 'node:fs';

import { closeDb, getPool } from '../db/pool.js';
import { runLegacyRevisionBackfill } from './backfill.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

const main = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const batchSize = Number(argValue('--batch') ?? 500);
  const maxBatchesRaw = argValue('--max-batches');
  const report = await runLegacyRevisionBackfill(getPool(), {
    dryRun: !apply,
    batchSize,
    maxBatches: maxBatchesRaw === null ? undefined : Number(maxBatchesRaw),
    fromStart: process.argv.includes('--from-start'),
  });

  const { ambiguous, ...summary } = report;
  console.log(`[backfill] ${apply ? 'ЗАПИСЬ' : 'dry-run (ничего не записано)'}`);
  console.log(JSON.stringify(summary, null, 2));
  if (ambiguous.length > 0) {
    console.log(`[backfill] неоднозначных: ${report.ambiguousCount}, первые ${ambiguous.length}:`);
    for (const a of ambiguous.slice(0, 20)) {
      console.log(`  документ ${a.documentId}, источник ${a.sourceId}, ${a.itemKey}: ${a.reason}`);
    }
  }

  const reportPath = argValue('--report');
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[backfill] отчёт: ${reportPath}`);
  }
};

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async err => {
    console.error('[backfill] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
