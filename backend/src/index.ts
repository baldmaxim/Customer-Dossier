// Точка входа: HTTP API + фоновый ингест + приём форвардов.

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, checkDbConnection } from './db/pool.js';
import { runIngestPass } from './ingest/scheduler.js';
import { runBotLoop } from './ingest/telegramBot.js';

/** Как часто шедулер проверяет, не пора ли опросить источники. */
const INGEST_TICK_MS = 60_000;

const startIngestScheduler = (signal: AbortSignal): void => {
  let running = false;

  const tick = async (): Promise<void> => {
    // Если предыдущий проход ещё идёт (медленный канал, длинная пауза между
    // запросами), новый не запускаем: иначе троттлинг перестанет соблюдаться.
    if (running || signal.aborted) return;
    running = true;
    try {
      const reports = await runIngestPass();
      const inserted = reports.reduce((sum, r) => sum + r.stats.inserted, 0);
      if (inserted > 0) console.log(`[ingest] новых документов: ${inserted}`);
      for (const r of reports.filter(r => !r.ok)) {
        console.error(`[ingest] ${r.sourceKey}: ${r.error}`);
      }
    } catch (err) {
      console.error(`[ingest] проход упал: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), INGEST_TICK_MS);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};

const main = async (): Promise<void> => {
  if (!(await checkDbConnection())) {
    throw new Error('Нет соединения с БД — проверьте DATABASE_URL и что сервер PostgreSQL запущен');
  }

  const controller = new AbortController();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[api] слушает порт ${env.PORT}`);
  });

  startIngestScheduler(controller.signal);

  if (env.TG_BOT_TOKEN !== '') {
    void runBotLoop(controller.signal);
  } else {
    console.log('[bot] TG_BOT_TOKEN не задан — приём форвардов выключен');
  }

  const shutdown = (sig: string): void => {
    console.log(`[app] ${sig}, останавливаюсь`);
    controller.abort();
    server.close(() => {
      void closeDb().finally(() => process.exit(0));
    });
    // Страховка: если соединения висят, не ждём вечно.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

main().catch(async err => {
  console.error('[app] не удалось стартовать:', err instanceof Error ? err.message : String(err));
  await closeDb().catch(() => undefined);
  process.exit(1);
});
