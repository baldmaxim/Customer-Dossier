// Разовый пересчёт агрегатов карточки: npm run metrics:refresh
//
// Пересчитывает materialized view company_metrics. Канон не меняется —
// только производное представление над ним.

import { closeDb } from '../db/pool.js';
import { refreshCompanyMetrics } from './refresh.js';

const main = async (): Promise<void> => {
  const ms = await refreshCompanyMetrics();
  if (ms === null) {
    console.log('[metrics] пересчёт уже идёт в этом процессе — пропущено');
    return;
  }
  console.log(`[metrics] пересчитано за ${ms} мс`);
};

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async err => {
    console.error('[metrics] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
