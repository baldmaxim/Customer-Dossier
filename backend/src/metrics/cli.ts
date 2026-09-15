// Разовый пересчёт производных представлений: npm run metrics:refresh [-- --cutoff 2026-09-15T00:00:00Z]
//
// 1. Снимок объяснимых сигналов (этап 07) на явный срез: при ошибке остаётся прежний снимок.
// 2. Устаревшая materialized view company_metrics (007) — только для deprecated-эндпоинта.
// Канон не меняется.

import { closeDb } from '../db/pool.js';
import { refreshSignals } from '../signals/refresh.js';
import { refreshCompanyMetrics } from './refresh.js';

const argValue = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
};

const main = async (): Promise<void> => {
  const raw = argValue('--cutoff');
  const cutoff = raw ? new Date(raw) : undefined;
  if (cutoff && Number.isNaN(cutoff.getTime())) {
    console.error('[signals] --cutoff: ожидается дата ISO, например 2026-09-15T00:00:00Z');
    process.exitCode = 1;
    return;
  }
  const signals = await refreshSignals({ cutoff, requestedBy: 'cli' });
  if (signals.outcome === 'succeeded') {
    console.log(`[signals] снимок #${signals.refreshId}: компаний ${signals.companies}, срез ${signals.cutoff}, ${signals.durationMs} мс`);
  } else if (signals.outcome === 'failed') {
    console.error(`[signals] пересчёт #${signals.refreshId} не удался, остаётся прежний снимок: ${signals.error}`);
    process.exitCode = 1;
  } else {
    console.log('[signals] пересчёт уже идёт — пропущено');
  }

  const ms = await refreshCompanyMetrics();
  console.log(ms === null ? '[metrics] legacy-пересчёт уже идёт — пропущено' : `[metrics] legacy company_metrics пересчитана за ${ms} мс`);
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[metrics] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
