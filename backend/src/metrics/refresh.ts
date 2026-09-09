// Пересчёт агрегатов карточки.
//
// CONCURRENTLY обязателен: без него REFRESH берёт эксклюзивную блокировку и
// портал на время пересчёта отдаёт пустые карточки. Требует UNIQUE-индекса —
// он создан в миграции 007 (company_metrics_pk).

import { getPool } from '../db/pool.js';

let refreshing = false;

/**
 * Возвращает время пересчёта в мс либо null, если пересчёт уже идёт.
 *
 * Флаг вместо очереди: два одновременных REFRESH одной MV всё равно
 * сериализуются в PostgreSQL, и второй просто ждёт впустую.
 */
export const refreshCompanyMetrics = async (): Promise<number | null> => {
  if (refreshing) return null;
  refreshing = true;
  const startedAt = Date.now();
  try {
    await getPool().query('REFRESH MATERIALIZED VIEW CONCURRENTLY company_metrics');
    return Date.now() - startedAt;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Первый REFRESH после создания MV не может быть CONCURRENTLY: вью ещё
    // ни разу не заполнялась. Один раз делаем обычный.
    if (message.includes('has not been populated')) {
      await getPool().query('REFRESH MATERIALIZED VIEW company_metrics');
      return Date.now() - startedAt;
    }
    throw err;
  } finally {
    refreshing = false;
  }
};

/** Интервал фонового пересчёта. */
export const METRICS_REFRESH_MS = 10 * 60_000;

export const startMetricsScheduler = (signal: AbortSignal): void => {
  const tick = async (): Promise<void> => {
    if (signal.aborted) return;
    try {
      const ms = await refreshCompanyMetrics();
      if (ms !== null && ms > 5000) {
        console.warn(`[metrics] пересчёт занял ${ms} мс — критерий приёмки M4 не выполняется`);
      }
    } catch (err) {
      console.error(`[metrics] ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const timer = setInterval(() => void tick(), METRICS_REFRESH_MS);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
