// Куда и как клиент модели отправляет запрос: локальный LM Studio или OpenRouter.
//
// OpenRouter отдаёт одну модель через десятки хостингов с разной квантизацией, и хостинг влияет на ответ.
// Поэтому маршрут — часть идентичности исполнения запуска (reprocess/provider.ts); ключ в неё не входит.

import type { LlmProvider } from '../config/llm.js';

export interface ILlmTarget {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  /** Пусто — без заголовка Authorization. */
  apiKey: string;
  routeProviders: readonly string[];
}

export interface ILlmConnection {
  ok: boolean;
  models: string[];
  error?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Маршрут OpenRouter. require_parameters — только хостинги, которые держат строгую JSON-схему: иначе
 * запрос уйдёт туда, где response_format молча игнорируется. data_collection: deny — только хостинги,
 * которые не хранят запросы и не обучаются на них. Хостинги названы — только они, по порядку;
 * не названы — самый дешёвый из подходящих.
 */
export const openRouterRouting = (routeProviders: readonly string[]): Record<string, unknown> =>
  routeProviders.length > 0
    ? { order: [...routeProviders], allow_fallbacks: false, require_parameters: true, data_collection: 'deny' }
    : { sort: 'price', require_parameters: true, data_collection: 'deny' };

/** Поле `provider` тела запроса; у LM Studio его нет. */
export const requestRouting = (target: ILlmTarget): Record<string, unknown> | null =>
  target.provider === 'openrouter' ? openRouterRouting(target.routeProviders) : null;

export const requestHeaders = (target: Pick<ILlmTarget, 'apiKey'>): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(target.apiKey !== '' ? { Authorization: `Bearer ${target.apiKey}` } : {}),
});

/** Хостинг подходит маршруту: тег совпал целиком или маршрут назвал только провайдера (`deepinfra` ⊃ `deepinfra/fp8`). */
export const matchesRoute = (tag: string, routeProviders: readonly string[]): boolean =>
  routeProviders.length === 0 || routeProviders.some(r => tag === r || tag.startsWith(`${r}/`));

interface IOpenRouterEndpoint {
  tag?: string;
  supported_parameters?: string[] | null;
}

/** accepted — принят и лимит не исчерпан; rejected — не принят; unreachable — проверить не удалось. */
export type KeyVerdict = 'accepted' | 'rejected' | 'exhausted' | 'unreachable';

export interface IKeyCheck {
  verdict: KeyVerdict;
  error?: string;
}

/** Ключ принят OpenRouter и лимит ключа не исчерпан. Перед проходом конвейера и при сохранении ключа в админке. */
export const checkOpenRouterKey = async (
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<IKeyCheck> => {
  try {
    const response = await fetchImpl(`${baseUrl}/key`, { headers: requestHeaders({ apiKey }), signal: AbortSignal.timeout(timeoutMs) });
    if (response.status === 401 || response.status === 403) {
      return { verdict: 'rejected', error: `OpenRouter не принял ключ (HTTP ${response.status})` };
    }
    if (!response.ok) return { verdict: 'unreachable', error: `OpenRouter /key: HTTP ${response.status}` };
    const info = (await response.json()) as { data?: { limit_remaining?: unknown } };
    const limitRemaining = info.data?.limit_remaining;
    // null — у ключа нет своего лимита, тратит средства счёта.
    if (typeof limitRemaining === 'number' && limitRemaining <= 0) {
      return { verdict: 'exhausted', error: 'у ключа OpenRouter исчерпан лимит расходов' };
    }
    return { verdict: 'accepted' };
  } catch (err) {
    return { verdict: 'unreachable', error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * Проверка перед проходом конвейера (worker.probeModel) и для экрана. Список моделей OpenRouter публичен
 * и о ключе ничего не говорит: без этой проверки запуски падали бы с 401/402, и после REPROCESS_RETRY_MAX
 * неудач редакция выпадала бы из автопотока. Поэтому ok — только если ключ задан и принят, лимит ключа и
 * средства на счёте не исчерпаны и у модели есть хостинг со строгой схемой в пределах маршрута.
 */
export const checkOpenRouter = async (
  target: ILlmTarget,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<ILlmConnection> => {
  const get = (path: string): Promise<Response> =>
    fetchImpl(`${target.baseUrl}${path}`, { headers: requestHeaders(target), signal: AbortSignal.timeout(timeoutMs) });
  const fail = (error: string): ILlmConnection => ({ ok: false, models: [], error });
  if (target.apiKey === '') return fail('ключ OpenRouter не задан: админка → «Модель» или LLM_API_KEY в .env');
  const key = await checkOpenRouterKey(target.baseUrl, target.apiKey, timeoutMs, fetchImpl);
  if (key.verdict !== 'accepted') return fail(key.error ?? 'ключ OpenRouter не проверен');
  try {
    // Остаток счёта — по возможности: не ответил — проверку не проваливаем, это скажет сам запрос (402).
    const credits = await get('/credits').catch(() => null);
    if (credits?.ok) {
      const data = ((await credits.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } }).data;
      if (typeof data?.total_credits === 'number' && typeof data.total_usage === 'number' && data.total_credits - data.total_usage <= 0) {
        return fail('на счёте OpenRouter закончились средства');
      }
    }

    const modelPath = target.model.split('/').map(encodeURIComponent).join('/');
    const endpoints = await get(`/models/${modelPath}/endpoints`);
    if (endpoints.status === 404) return fail(`модели ${target.model} нет в OpenRouter`);
    if (!endpoints.ok) return fail(`OpenRouter /models: HTTP ${endpoints.status}`);
    const list = ((await endpoints.json()) as { data?: { endpoints?: IOpenRouterEndpoint[] } }).data?.endpoints ?? [];
    const usable = list.filter(
      e => (e.supported_parameters ?? []).includes('structured_outputs') && matchesRoute(e.tag ?? '', target.routeProviders),
    );
    if (usable.length === 0) {
      const where = target.routeProviders.length > 0 ? ' среди OPENROUTER_PROVIDERS' : '';
      return fail(`у модели ${target.model} нет хостинга со строгой JSON-схемой${where}`);
    }
    return { ok: true, models: [target.model] };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};
