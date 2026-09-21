// Точка входа: HTTP API на loopback. Фоновые задания (сбор, разбор моделью,
// пересчёт метрик, приём форвардов) запускаются только явными флагами.

import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, checkDbConnection } from './db/pool.js';
import { runIngestPass } from './ingest/scheduler.js';
import { runBotLoop } from './ingest/telegramBot.js';
import { startBackgroundJobs } from './jobs.js';
import { startMetricsScheduler } from './metrics/refresh.js';
import { lmStudioProvider } from './reprocess/provider.js';
import { runReprocessPass } from './reprocess/worker.js';
import { runHeadlinePass } from './headline/service.js';

/** Как часто шедулер проверяет, не пора ли опросить источники. */
const INGEST_TICK_MS = 60_000;

/** Как часто воркер заглядывает в очередь извлечения. */
const PIPELINE_TICK_MS = 30_000;

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

const startPipelineWorker = (signal: AbortSignal): void => {
  let running = false;
  const provider = lmStudioProvider();

  const tick = async (): Promise<void> => {
    // Запуск обрабатывается дольше тика: наложение проходов дало бы двойную нагрузку на GPU.
    if (running || signal.aborted) return;
    running = true;
    try {
      const results = await runReprocessPass(provider, {
        autoPublish: env.REPROCESS_AUTO_PUBLISH,
        enqueueLimit: env.EXTRACT_BATCH_SIZE,
      });
      if (results.length > 0) {
        const completed = results.filter(r => r.run?.status === 'completed').length;
        const published = results.filter(r => r.publish?.outcome === 'published').length;
        console.log(`[pipeline] запусков ${results.length}: завершено ${completed}, в карточки ${published}`);
      }
      // Темы — после разбора и последовательно с ним: параллельный запрос к локальной
      // модели делит VRAM и возвращает таймауты (TG_Info/CLAUDE.md, раздел LM Studio).
      const headlines = await runHeadlinePass();
      const saved = headlines.filter(h => h.outcome === 'saved').length;
      if (saved > 0) console.log(`[headline] тем составлено: ${saved}`);
    } catch (err) {
      console.error(`[pipeline] проход упал: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), PIPELINE_TICK_MS);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};

const main = async (): Promise<void> => {
  if (!(await checkDbConnection())) {
    throw new Error('Нет соединения с БД — проверьте DATABASE_URL и что сервер PostgreSQL запущен');
  }

  const controller = new AbortController();
  const app = createApp();
  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`[api] слушает http://${env.HOST.includes(':') ? `[${env.HOST}]` : env.HOST}:${env.PORT}`);
    console.log('[api] вход не требуется: портал открыт для локальных запросов');
  });

  const decision = startBackgroundJobs(
    env,
    {
      ingest: startIngestScheduler,
      pipeline: startPipelineWorker,
      metrics: startMetricsScheduler,
      bot: signal => void runBotLoop(signal),
    },
    controller.signal,
  );
  for (const note of decision.notes) console.log(`[jobs] ${note}`);
  if (decision.started.length > 0) console.log(`[jobs] запущено: ${decision.started.join(', ')}`);

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
