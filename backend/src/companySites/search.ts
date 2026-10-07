// Поиск официального сайта компании и проверка кандидатов (этап 25A, ADR-018).
//
// Поиск: компания из очереди → поисковый запрос (formatSiteSearchQuery) → модель с веб-плагином OpenRouter →
// адреса, чей хост был в выдаче (acceptCandidates) → кандидаты ждут решения оператора. Каждая попытка — платный
// поиск: место в суточном лимите резервируется до запроса, повтор — только если модель ответила не по схеме,
// и тоже за место в лимите. Модель и поиск — только при LLM_PROVIDER=openrouter.
//
// Проверка: главная и до трёх страниц кандидата — признаки реквизита (verify.ts). Сеть, но не модель:
// идёт в тике сбора.

import { env } from '../config/env.js';
import { extractSiteSearch, type IExtractOptions, type ILlmResult } from '../llm/client.js';
import { SITE_SEARCH_PROMPT_VERSION, formatSiteSearchQuery } from '../llm/siteSearch/prompt.js';
import type { ISiteSearch } from '../llm/siteSearch/schema.js';
import {
  SCHEDULER_ACTOR,
  claimSiteSearch,
  failSiteSearch,
  finishSiteSearch,
  postponeSiteSearch,
  reserveSiteSearch,
  saveSiteCheck,
  saveSiteSearch,
  siteSearchUsedLastDay,
  uncheckedCandidates,
  type ISiteSearchTarget,
  type IUncheckedCandidate,
  type SiteSearchOutcome,
} from './store.js';
import { acceptCandidates, citationFallback, type IAcceptedSite, type SiteRejection } from './url.js';
import { verifyCandidate, type ISiteCheck } from './verify.js';

export type SiteSearchMode = 'off' | 'needs_openrouter' | 'on';

/** Включён ли поиск: флаг владельца и провайдер, у которого веб-поиск есть. */
export const siteSearchMode = (): SiteSearchMode =>
  !env.SITE_SEARCH_ENABLED ? 'off' : env.LLM_PROVIDER !== 'openrouter' ? 'needs_openrouter' : 'on';

export type SiteSearchRunOutcome = SiteSearchOutcome | 'daily_limit' | 'llm_error' | 'invalid_answer';

export interface ISiteSearchRun {
  companyId: number;
  name: string;
  query: string;
  outcome: SiteSearchRunOutcome;
  /** Новых кандидатов записано (у пробы — 0). */
  inserted: number;
  citations: number;
  citationHosts: string[];
  accepted: IAcceptedSite[];
  rejected: Array<{ url: string; why: SiteRejection }>;
  /** Почему сайта нет — словами модели. */
  noneReason: string | null;
  error: string | null;
}

/** Зависимости за интерфейсом: логика попыток и лимита проверяется без базы и сети. */
export interface ISiteSearchDeps {
  extract: (options: IExtractOptions) => Promise<ILlmResult<ISiteSearch>>;
  reserve: typeof reserveSiteSearch;
  finish: typeof finishSiteSearch;
  save: typeof saveSiteSearch;
  fail: typeof failSiteSearch;
  postpone: typeof postponeSiteSearch;
}

const PG_DEPS: ISiteSearchDeps = {
  extract: extractSiteSearch,
  reserve: reserveSiteSearch,
  finish: finishSiteSearch,
  save: saveSiteSearch,
  fail: failSiteSearch,
  postpone: postponeSiteSearch,
};

/** Попыток на один поиск: первая и повтор при ответе не по схеме. */
const ATTEMPTS_MAX = 2;

/** Ответ — несколько адресов и фраз: длиннее не нужно, а выдача поиска считается входом, не выходом. */
const ANSWER_MAX_TOKENS = 800;

/**
 * Поиск сайта одной компании. `persist: false` — проба: журнал расхода пишется (поиск оплачен), кандидаты
 * и очередь не трогаются.
 */
export const searchCompanySite = async (
  target: ISiteSearchTarget,
  actor: string,
  { persist }: { persist: boolean },
  deps: ISiteSearchDeps = PG_DEPS,
): Promise<ISiteSearchRun> => {
  const query = formatSiteSearchQuery(target);
  const base: ISiteSearchRun = {
    companyId: target.companyId,
    name: target.name,
    query,
    outcome: 'none',
    inserted: 0,
    citations: 0,
    citationHosts: [],
    accepted: [],
    rejected: [],
    noneReason: null,
    error: null,
  };
  for (let attempt = 0; attempt < ATTEMPTS_MAX; attempt += 1) {
    const slot = await deps.reserve(
      { companyId: target.companyId, actor, model: env.LMSTUDIO_MODEL, maxResults: env.SITE_SEARCH_MAX_RESULTS },
      env.SITE_SEARCH_DAILY_LIMIT,
    );
    if (!slot.ok) {
      if (persist) await deps.postpone(target.companyId);
      return { ...base, outcome: 'daily_limit', error: `суточный лимит поиска исчерпан: ${slot.used} из ${env.SITE_SEARCH_DAILY_LIMIT}` };
    }
    const result = await deps.extract({ body: query, publishedAt: null, temperature: attempt === 0 ? 0.1 : 0, maxTokens: ANSWER_MAX_TOKENS });
    if (!result.ok) {
      const outcome = result.failure === 'llm_error' ? 'llm_error' : 'invalid_answer';
      await deps.finish(slot.id, { outcome, citations: null, accepted: null, error: result.message });
      if (outcome === 'invalid_answer' && attempt + 1 < ATTEMPTS_MAX) continue;
      if (persist) await deps.fail(target.companyId, result.message, target.attemptCount);
      return { ...base, outcome, error: result.message };
    }
    const citations = result.citations ?? [];
    const acceptance = acceptCandidates(result.data.sites, citations);
    // Поиск не вернул ни одной страницы — предложениям модели верить не на чем, даже если она их дала.
    // Модель страницы видела, но сайт не выбрала — кандидаты из самой выдачи по названию (citationFallback).
    const accepted =
      citations.length === 0 ? [] : acceptance.accepted.length > 0 ? acceptance.accepted : citationFallback(citations, target.name);
    const outcome: SiteSearchOutcome = citations.length === 0 ? 'no_citations' : accepted.length > 0 ? 'found' : 'none';
    await deps.finish(slot.id, { outcome, citations: citations.length, accepted: accepted.length, error: null });
    const run: ISiteSearchRun = {
      ...base,
      outcome,
      citations: citations.length,
      citationHosts: acceptance.citationHosts,
      accepted,
      rejected: acceptance.rejected,
      noneReason: result.data.noneReason,
    };
    if (!persist) return run;
    const saved = await deps.save(target.companyId, {
      query,
      outcome,
      resultCount: citations.length,
      accepted,
      model: env.LMSTUDIO_MODEL,
      promptVersion: SITE_SEARCH_PROMPT_VERSION,
      refreshDays: env.SITE_SEARCH_REFRESH_DAYS,
    });
    return { ...run, outcome: saved.outcome, inserted: saved.inserted };
  }
  // Недостижимо: последняя попытка возвращает результат.
  return base;
};

/**
 * Проход поиска: не больше `limit` компаний из очереди. Выключен флагом или без OpenRouter — ничего.
 * Лимит исчерпан — проход заканчивается: следующие компании упрутся в тот же предел.
 */
export const runSiteSearchPass = async (
  limit = 2,
  claim: () => Promise<ISiteSearchTarget | null> = claimSiteSearch,
  usedLastDay: () => Promise<number> = siteSearchUsedLastDay,
): Promise<ISiteSearchRun[]> => {
  if (siteSearchMode() !== 'on') return [];
  // Лимит за сутки исчерпан — очередь не считаем (07.10.2026, замер на сервере): её расчёт по ролям и членству всех
  // компаний (~15 мс) шёл на каждом проходе разбора, а поиск всё равно отказывал. Место резервирует reserveSiteSearch.
  if ((await usedLastDay()) >= env.SITE_SEARCH_DAILY_LIMIT) return [];
  const runs: ISiteSearchRun[] = [];
  for (let i = 0; i < limit; i += 1) {
    const target = await claim();
    if (!target) break;
    const run = await searchCompanySite(target, SCHEDULER_ACTOR, { persist: true });
    runs.push(run);
    if (run.outcome === 'daily_limit') break;
  }
  return runs;
};

export interface ISiteCheckRun {
  candidateId: number;
  host: string;
  check: ISiteCheck;
}

/** Проход проверки: не больше `limit` кандидатов без признаков. Неожиданная ошибка — тоже исход, без вечного повтора. */
export const runSiteCheckPass = async (
  limit = 3,
  deps: {
    list: (limit: number) => Promise<IUncheckedCandidate[]>;
    verify: typeof verifyCandidate;
    save: typeof saveSiteCheck;
  } = { list: uncheckedCandidates, verify: verifyCandidate, save: saveSiteCheck },
): Promise<ISiteCheckRun[]> => {
  const runs: ISiteCheckRun[] = [];
  for (const candidate of await deps.list(limit)) {
    let check: ISiteCheck;
    try {
      check = await deps.verify(candidate.url, candidate.host, { name: candidate.companyName, inn: candidate.inn, ogrn: candidate.ogrn });
    } catch (err) {
      check = {
        status: 'unreachable',
        pageTitle: null,
        innOnPage: null,
        ogrnOnPage: null,
        nameOnPage: null,
        otherInns: [],
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        pagesRead: 0,
      };
    }
    await deps.save(candidate.id, check);
    runs.push({ candidateId: candidate.id, host: candidate.host, check });
  }
  return runs;
};
