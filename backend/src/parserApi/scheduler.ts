// Проверка компаний «на контроле» в parser-api.com по расписанию (PARSER_API_ENABLED, этап 24A).
//
// Проход — раз в PARSER_API_TICK_MS: компании, у которых срок набора пришёл, по одной, с паузой. Сколько
// запросов — решает резерв лимита перед каждым запросом (parserApi/store.ts): нет места — проход стоит до
// следующего. Без ключа проход ничего не делает; ключ, заданный в админке, подхватывается следующим проходом.
// После наборов — карточки арбитражных дел тех, чью картотеку проход проверил (суммы исков, caseCards.ts).

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { loadStoredParserApiKey, parserApiKey } from '../settings/parserApiKey.js';
import { fetchCaseCards, type ICaseCardsResult } from './caseCards.js';
import { refreshParserApiDatasets, type ParserApiRefreshResult } from './refresh.js';
import { pgParserApiStore, SCHEDULER_ACTOR } from './store.js';
import { dueParserApiTargets } from './targets.js';

const PARSER_API_TICK_MS = 30 * 60_000;
/** Компаний за проход: проход короткий, лимит тарифа маленький. */
const MAX_TARGETS_PER_PASS = 3;
/** Пауза между компаниями: чужой сервис, не дёргаем залпом. */
const DELAY_BETWEEN_TARGETS_MS = 2000;

export interface IParserApiPassReport {
  skipped: 'no_key' | 'limit' | null;
  results: Array<{ companyId: number; result: ParserApiRefreshResult }>;
  /** Карточки дел (суммы исков) — после наборов всех компаний прохода. */
  cards: Array<{ companyId: number; result: ICaseCardsResult }>;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

const limits = () => ({ daily: env.PARSER_API_DAILY_LIMIT, monthly: env.PARSER_API_MONTHLY_LIMIT });

export const runParserApiPass = async (signal?: AbortSignal): Promise<IParserApiPassReport> => {
  await loadStoredParserApiKey();
  const key = parserApiKey();
  if (key === null) return { skipped: 'no_key', results: [], cards: [] };
  const usage = await pgParserApiStore.usage();
  if (usage.day >= env.PARSER_API_DAILY_LIMIT || usage.month >= env.PARSER_API_MONTHLY_LIMIT) return { skipped: 'limit', results: [], cards: [] };

  const results: IParserApiPassReport['results'] = [];
  const targets = await dueParserApiTargets(getPool(), MAX_TARGETS_PER_PASS);
  let stopped = false;
  for (const [i, target] of targets.entries()) {
    if (signal?.aborted) break;
    if (i > 0) await sleep(DELAY_BETWEEN_TARGETS_MS, signal);
    const result = await refreshParserApiDatasets(target.inn, target.datasets, SCHEDULER_ACTOR, {
      store: pgParserApiStore,
      key,
      limits: limits(),
      kadMaxPages: env.PARSER_API_KAD_MAX_PAGES,
    });
    results.push({ companyId: target.companyId, result });
    if (result.status === 'stopped') {
      stopped = true;
      break;
    }
  }
  // Суммы исков — только у тех, чью картотеку проход проверил, и только если на наборы хватило лимита.
  const cards: IParserApiPassReport['cards'] = [];
  const checkedCourts = results.filter(r => r.result.datasets.courts?.status === 'checked');
  for (const r of stopped ? [] : checkedCourts) {
    if (signal?.aborted) break;
    const inn = targets.find(t => t.companyId === r.companyId)!.inn;
    const result = await fetchCaseCards(inn, SCHEDULER_ACTOR, env.PARSER_API_KAD_CARDS_MAX, { store: pgParserApiStore, key, limits: limits() });
    cards.push({ companyId: r.companyId, result });
    if (result.stop) break;
  }
  return { skipped: null, results, cards };
};

const STOP_TEXT: Record<string, string> = {
  no_key: 'ключ не задан — запросов нет (админка → Источники → parser-api.com)',
  limit: 'лимит запросов портала исчерпан (PARSER_API_DAILY_LIMIT / PARSER_API_MONTHLY_LIMIT) — продолжим, когда освободится',
  daily_limit: 'суточный лимит исчерпан — продолжим, когда освободится',
  monthly_limit: 'месячный лимит исчерпан — продолжим в следующем месяце',
  key_rejected: 'parser-api.com не принял ключ — проверка остановлена до замены ключа',
  subscription_expired: 'подписка parser-api.com истекла — проверка остановлена',
  ip_rejected: 'parser-api.com не разрешает запросы с этого адреса — добавьте адрес сервера в личном кабинете сервиса',
};

export const startParserApiScheduler = (signal: AbortSignal): void => {
  let running = false;
  // Пропуск печатаем один раз, а не каждые полчаса.
  let reported: string | null = null;

  const tick = async (): Promise<void> => {
    if (running || signal.aborted) return;
    running = true;
    try {
      const pass = await runParserApiPass(signal);
      const stopped = pass.results.find(r => r.result.status === 'stopped')?.result;
      const reason = pass.skipped ?? (stopped?.status === 'stopped' ? stopped.reason : null) ?? pass.cards.find(c => c.result.stop)?.result.stop ?? null;
      if (reason !== null && reason !== reported) console.warn(`[parser-api] ${STOP_TEXT[reason] ?? reason}`);
      reported = reason;
      const checked = pass.results.filter(r => Object.values(r.result.datasets).some(d => d?.status === 'checked'));
      if (checked.length > 0) console.log(`[parser-api] проверено компаний: ${checked.length}`);
      const cardsFetched = pass.cards.reduce((n, c) => n + c.result.fetched, 0);
      if (cardsFetched > 0) console.log(`[parser-api] карточек дел (суммы исков): ${cardsFetched}`);
      for (const r of pass.results) {
        for (const [dataset, d] of Object.entries(r.result.datasets)) {
          if (d?.status === 'failed') console.warn(`[parser-api] компания ${r.companyId}, ${dataset}: ${d.error}`);
        }
      }
    } catch (err) {
      console.error(`[parser-api] проход упал: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), PARSER_API_TICK_MS);
  signal.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
