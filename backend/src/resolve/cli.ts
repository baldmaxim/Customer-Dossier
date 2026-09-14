// Backfill идентичности (этап 04).
//
//   npm run backfill:identity -- --identifiers                   dry-run: tax_id → реестр реквизитов
//   npm run backfill:identity -- --renormalize                   dry-run: пересчёт ключей текущей версией нормализатора
//   ... --apply --confirm-copy                                   записать (только копия базы после backup)
//   ... --batch 500 --from-start --report out.json
//
// Из миграций и при старте не запускается. Совпавшие ключи уходят в очередь слияний, не сливаются.

import fs from 'node:fs';

import { closeDb, getPool } from '../db/pool.js';
import { runIdentifierBackfill, runRenormalizeBackfill } from './identityBackfill.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};
const has = (flag: string): boolean => process.argv.includes(flag);

const main = async (): Promise<void> => {
  const apply = has('--apply');
  if (apply && !has('--confirm-copy')) {
    console.error('[identity] запись требует --confirm-copy: запускайте на копии базы после backup, не на рабочей');
    process.exitCode = 1;
    return;
  }
  const options = { dryRun: !apply, batchSize: Number(argValue('--batch') ?? 500), fromStart: has('--from-start') };
  let report: unknown;
  if (has('--identifiers')) report = await runIdentifierBackfill(getPool(), options);
  else if (has('--renormalize')) report = await runRenormalizeBackfill(getPool(), options);
  else {
    console.error('[identity] укажите --identifiers или --renormalize');
    process.exitCode = 1;
    return;
  }
  console.log(`[identity] ${apply ? 'ЗАПИСЬ' : 'dry-run (ничего не записано)'}`);
  console.log(JSON.stringify(report, null, 2));
  const reportPath = argValue('--report');
  if (reportPath) {
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[identity] отчёт: ${reportPath}`);
  }
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[identity] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
