// Точка входа: HTTP API на loopback. Фоновые задания (сбор, разбор моделью,
// пересчёт метрик, приём форвардов) запускаются только явными флагами.

import { createApp } from './app.js';
import { pgAuthStore } from './auth/pgStore.js';
import { env } from './config/env.js';
import { closeDb, checkDbConnection } from './db/pool.js';
import { runIngestPass } from './ingest/scheduler.js';
import { checkLlmConnection, modelProbeTimeoutMs } from './llm/client.js';
import { runBotLoop } from './ingest/telegramBot.js';
import { startBackgroundJobs } from './jobs.js';
import { startMetricsScheduler } from './metrics/refresh.js';
import { lmStudioProvider } from './reprocess/provider.js';
import { runReprocessPass } from './reprocess/worker.js';
import { runHeadlinePass } from './headline/service.js';
import { applyDomRfModelDecisions } from './ingest/registry/domrfModelDecisions.js';
import { runDomRfHintPass } from './ingest/registry/domrfHints.js';
import { syncDomRfGroupRelations } from './registry/groupSync.js';
import { applyJudgedPairs, runModelReviewPass } from './resolve/modelReview.js';
import { loadStoredLlmKey } from './settings/llmKey.js';
import { startDomRfBrowserWorker } from './ingest/registry/domrfBrowserWorker.js';
import { startFocusScheduler } from './focus/scheduler.js';
import { loadStoredFocusKey } from './settings/focusKey.js';
import { startParserApiScheduler } from './parserApi/scheduler.js';
import { loadStoredParserApiKey } from './settings/parserApiKey.js';
import { runSiteCheckPass, runSiteSearchPass } from './companySites/search.js';

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
      // Признаки кандидатов в сайты компаний (этап 25A): сеть без модели — в тике сбора.
      const checks = await runSiteCheckPass(3);
      for (const c of checks) console.log(`[site-check] ${c.host}: ${c.check.status}${c.check.innOnPage ? ', ИНН на сайте' : ''}`);
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
  // Печатаем недоступность модели один раз, а не каждые полминуты.
  let reportedSkip: string | null = null;

  const tick = async (): Promise<void> => {
    // Запуск обрабатывается дольше тика: наложение проходов дало бы двойную нагрузку на GPU.
    if (running || signal.aborted) return;
    running = true;
    try {
      const pass = await runReprocessPass(provider, {
        autoPublish: env.REPROCESS_AUTO_PUBLISH,
        enqueueLimit: env.EXTRACT_BATCH_SIZE,
        probeModel: () => checkLlmConnection(modelProbeTimeoutMs()),
        retry: env.REPROCESS_RETRY_ENABLED
          ? { max: env.REPROCESS_RETRY_MAX, backoffMinutes: env.REPROCESS_RETRY_BACKOFF_MIN }
          : null,
      });
      if (pass.skipped !== null) {
        // Ни постановки, ни вызовов модели, ни тем: редакции ждут, ничего не сгорает.
        if (pass.skipped !== reportedSkip) {
          console.warn(`[pipeline] проход пропущен — ${pass.skipped}. Разбор продолжится, когда модель ответит`);
          reportedSkip = pass.skipped;
        }
        return;
      }
      if (reportedSkip !== null) {
        console.log('[pipeline] модель снова отвечает, разбор продолжается');
        reportedSkip = null;
      }
      if (pass.results.length > 0) {
        const completed = pass.results.filter(r => r.run?.status === 'completed').length;
        const published = pass.results.filter(r => r.publish?.outcome === 'published').length;
        console.log(`[pipeline] запусков ${pass.results.length}: завершено ${completed}, в карточки ${published}`);
      }
      // Темы — после разбора и последовательно с ним: параллельный запрос к локальной
      // модели делит VRAM и возвращает таймауты (TG_Info/CLAUDE.md, раздел LM Studio).
      const headlines = await runHeadlinePass();
      const saved = headlines.filter(h => h.outcome === 'saved').length;
      if (saved > 0) console.log(`[headline] тем составлено: ${saved}`);
      // Подсказки к найденному в реестре ДОМ.РФ — тем же заданием и после тем, по той же причине.
      const hints = await runDomRfHintPass();
      const hinted = hints.filter(h => h.outcome === 'saved').length;
      if (hinted > 0) console.log(`[domrf-hint] подсказок к совпадениям: ${hinted}`);
      for (const h of hints.filter(h => h.outcome !== 'saved')) console.warn(`[domrf-hint] совпадение ${h.linkId}: ${h.outcome} — ${h.reason}`);
      // Разбор разногласий моделью (02.10.2026): совпадения с ДОМ.РФ и пары «возможный дубль» — тем же
      // заданием и последним, по той же причине. Без MODEL_REVIEW_APPLY — только вердикты рядом с записями.
      if (env.MODEL_REVIEW_ENABLED) {
        const decisions = await applyDomRfModelDecisions(env.MODEL_REVIEW_APPLY);
        const applied = decisions.filter(d => d.applied);
        for (const d of applied) console.log(`[model-review] ${d.companyName}: ${d.action === 'confirm' ? 'это он' : 'не он'} — ${d.record}; ${d.reason}`);
        if (applied.length > 0) {
          const sync = await syncDomRfGroupRelations();
          if (sync.linked + sync.withdrawn > 0) console.log(`[model-review] связи с группами: записано ${sync.linked}, снято ${sync.withdrawn}`);
        }
        // Включили применение после прогона «посмотреть» — сначала прежние вердикты, без вызова модели.
        const stored = env.MODEL_REVIEW_APPLY ? await applyJudgedPairs(env.MODEL_REVIEW_BATCH_SIZE) : [];
        const pairs = [...stored, ...(await runModelReviewPass())];
        for (const p of pairs.filter(p => p.action !== 'judged')) {
          console.log(`[model-review] «${p.sourceName}» ↔ «${p.targetName}»: ${p.verdict} — ${p.action}${p.note ? ` (${p.note})` : ''}; ${p.reason}`);
        }
        if (pairs.length > 0) console.log(`[model-review] пар с вердиктом: ${pairs.length}`);
      }
      // Сайты компаний (этап 25A): веб-поиск OpenRouter — тем же заданием и последним; без флага — ничего.
      const sites = await runSiteSearchPass(2);
      for (const s of sites) console.log(`[site-search] ${s.name}: ${s.outcome}${s.inserted > 0 ? `, новых кандидатов ${s.inserted}` : ''}${s.error ? ` — ${s.error}` : ''}`);
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
    console.log(
      env.AUTH_MODE === 'password'
        ? `[api] вход по логину и паролю; адрес портала: ${env.PUBLIC_ORIGIN ?? 'только loopback'}`
        : '[api] вход не требуется: портал открыт для локальных запросов',
    );
  });
  if (env.OPERATOR_TOKEN_LEFTOVER) {
    console.warn('[auth] OPERATOR_TOKEN больше не используется (ADR-014) — уберите его из .env');
  }
  if (env.AUTH_MODE === 'password') {
    // Подсказка, а не условие старта: без миграции 031 вход всё равно не заработает, но портал
    // и фоновые задания не должны падать из-за строки в логе.
    const users = await pgAuthStore.countUsers().catch(() => null);
    if (users === null) console.warn('[auth] таблицы пользователей нет — примените миграции (031)');
    else if (users === 0) console.warn('[auth] пользователей нет — войти некому. Первый администратор: node dist/auth/cli.js --create-admin <логин>');
  }
  // Ключ OpenRouter из админки — до фоновых заданий: первый проход конвейера уже идёт с ним.
  const llmKey = await loadStoredLlmKey().catch(err => {
    console.warn(`[llm] ключ из админки не прочитан: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (env.LLM_PROVIDER === 'openrouter' && llmKey?.problem === 'store_missing') {
    console.warn('[llm] хранилища ключей нет — примените миграции (032); действует только LLM_API_KEY из .env');
  }
  if (llmKey?.problem === 'undecryptable') {
    console.warn('[llm] ключ OpenRouter из админки не расшифровывается (сменился пароль базы?) — задайте его в админке заново');
  }

  // Ключ Контур.Фокуса из админки — тоже до фоновых заданий (ADR-015).
  const focusKey = await loadStoredFocusKey().catch(err => {
    console.warn(`[focus] ключ из админки не прочитан: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (focusKey?.problem === 'undecryptable') {
    console.warn('[focus] ключ Контур.Фокуса из админки не расшифровывается (сменился пароль базы?) — задайте его в админке заново');
  }

  // Ключ parser-api.com из админки — тоже до фоновых заданий (этап 24A).
  const parserKey = await loadStoredParserApiKey().catch(err => {
    console.warn(`[parser-api] ключ из админки не прочитан: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (parserKey?.problem === 'undecryptable') {
    console.warn('[parser-api] ключ parser-api.com из админки не расшифровывается (сменился пароль базы?) — задайте его в админке заново');
  }

  const decision = startBackgroundJobs(
    env,
    {
      ingest: startIngestScheduler,
      domrf: startDomRfBrowserWorker,
      pipeline: startPipelineWorker,
      metrics: startMetricsScheduler,
      focus: startFocusScheduler,
      parserApi: startParserApiScheduler,
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
