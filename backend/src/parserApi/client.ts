// Клиент parser-api.com (этап 24A, ADR-017): GET https://parser-api.com/parser/<api>/<метод>?key=…&…
//
// Сеть — только net/safeFetch: один хост, без перенаправлений (ключ стоит в адресе и не должен уехать по
// редиректу), лимиты времени и размера. Ключ не попадает ни в лог, ни в журнал, ни в текст ошибки.
//
// Ответы разных реестров устроены по-разному, и признак успеха называется по-разному: success (ГИР БО,
// «Прозрачный бизнес», Федресурс), Success (картотека арбитражных дел), done (ФССП). Отказ — error и
// error_code: 40301 ключ не принят, 40302 подписка истекла, 40303 адрес не разрешён, 40304 / 40305 —
// лимит суток / месяца, 40001 — параметры. Так написано в документации сервиса; живой ответ сверяется
// пробой (`npm run parserapi -- --probe`), карта полей — на чтении, а не здесь.

import { NetworkPolicyError, safeFetch, type ISafeFetchDeps, type ISourceNetworkPolicy } from '../net/safeFetch.js';

export const PARSER_API_HOST = 'parser-api.com';
export const PARSER_API_BASE = `https://${PARSER_API_HOST}/parser/`;

/** Методы, которые портал вызывает: имя в журнале → путь сервиса. */
export const PARSER_API_METHODS = {
  bo_search: 'nalog_bo_api/search',
  bo_details: 'nalog_bo_api/details',
  pb_org: 'nalog_pb_api/search_org',
  kad_search: 'arbitr_api/search',
  fssp_ur: 'fssp_api/search_ur_by_inn',
  fedresurs_ur: 'fedresurs_api/search_ur',
  fedresurs_org: 'fedresurs_api/get_org',
} as const;

export type ParserApiMethod = keyof typeof PARSER_API_METHODS;

export const isParserApiMethod = (value: string): value is ParserApiMethod => Object.hasOwn(PARSER_API_METHODS, value);

export type ParserApiFailure =
  | 'key_rejected'
  | 'subscription_expired'
  | 'ip_rejected'
  | 'daily_limit'
  | 'monthly_limit'
  | 'bad_request'
  | 'bad_response'
  | 'http_error'
  | 'network';

export type ParserApiCallResult =
  | { ok: true; httpStatus: number; body: Record<string, unknown> }
  | { ok: false; failure: ParserApiFailure; httpStatus: number | null; apiCode: number | null; error: string };

const POLICY: ISourceNetworkPolicy = {
  allowedHosts: [PARSER_API_HOST],
  allowSubdomains: false,
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 60_000,
  maxRedirects: 0,
};

const ERROR_BODY_CHARS = 200;

const errorText = (body: string, key: string): string =>
  (key === '' ? body : body.split(key).join('***')).replace(/\s+/g, ' ').trim().slice(0, ERROR_BODY_CHARS);

export const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const CODE_FAILURE: Readonly<Record<number, ParserApiFailure>> = {
  40301: 'key_rejected',
  40302: 'subscription_expired',
  40303: 'ip_rejected',
  40304: 'daily_limit',
  40305: 'monthly_limit',
  40001: 'bad_request',
};

const apiCodeOf = (body: Record<string, unknown> | null): number | null => {
  const raw = body?.error_code ?? body?.errorCode ?? asObject(body?.error)?.code;
  const code = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
  return code !== null && Number.isInteger(code) ? code : null;
};

/** Признак успеха в ответе: success / Success / done со значением 1 или true. null — признака нет. */
export const successFlag = (body: Record<string, unknown>): boolean | null => {
  for (const name of ['success', 'Success', 'done']) {
    const value = body[name];
    if (value === 1 || value === true || value === '1') return true;
    if (value === 0 || value === false || value === '0') return false;
  }
  return null;
};

/** Отказ по коду сервиса, иначе по HTTP: 401/403 без кода — ключ, 400 — параметры. */
export const classifyFailure = (httpStatus: number, apiCode: number | null): ParserApiFailure => {
  if (apiCode !== null && CODE_FAILURE[apiCode]) return CODE_FAILURE[apiCode]!;
  if (httpStatus === 401 || httpStatus === 403) return 'key_rejected';
  if (httpStatus === 400 || httpStatus === 422) return 'bad_request';
  return 'http_error';
};

/** Разбор ответа: JSON-объект с признаком успеха, иначе отказ с причиной. Чистая функция — проверяется без сети. */
export const interpretResponse = (httpStatus: number, text: string, key: string): ParserApiCallResult => {
  let body: Record<string, unknown> | null = null;
  try {
    body = asObject(JSON.parse(text));
  } catch {
    body = null;
  }
  const apiCode = apiCodeOf(body);
  const message = (typeof body?.error === 'string' ? body.error : null) ?? (text === '' ? `HTTP ${httpStatus}` : text);
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, failure: classifyFailure(httpStatus, apiCode), httpStatus, apiCode, error: errorText(message, key) };
  }
  if (body === null) return { ok: false, failure: 'bad_response', httpStatus, apiCode: null, error: 'ответ не JSON-объект' };
  const success = successFlag(body);
  if (success === true) return { ok: true, httpStatus, body };
  if (apiCode !== null || success === false) {
    return { ok: false, failure: apiCode !== null ? classifyFailure(httpStatus, apiCode) : 'bad_response', httpStatus, apiCode, error: errorText(message, key) };
  }
  return { ok: false, failure: 'bad_response', httpStatus, apiCode: null, error: 'в ответе нет признака успеха' };
};

export const callParserApi = async (
  method: ParserApiMethod,
  params: Readonly<Record<string, string>>,
  key: string,
  deps: ISafeFetchDeps = {},
): Promise<ParserApiCallResult> => {
  const url = new URL(PARSER_API_METHODS[method], PARSER_API_BASE);
  url.searchParams.set('key', key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  try {
    const res = await safeFetch(url, POLICY, { headers: { accept: 'application/json' } }, deps);
    return interpretResponse(res.status, res.text, key);
  } catch (err) {
    const message = err instanceof NetworkPolicyError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, failure: 'network', httpStatus: null, apiCode: null, error: errorText(message, key) };
  }
};

export type ParserApiKeyVerdict = 'rejected' | 'unknown';

/**
 * Проверка ключа без расхода тарифа: поиск ГИР БО без параметров. Сервис считает только success = 1, а запрос
 * без ИНН успешным не бывает. 40301/40302/40303 — ключ не годится (не принят, подписка, адрес); иначе
 * подтвердить ключ нечем — подтвердит первый настоящий запрос. «Принят» не говорим никогда.
 */
export const checkParserApiKey = async (
  key: string,
  deps: ISafeFetchDeps = {},
): Promise<{ verdict: ParserApiKeyVerdict; httpStatus: number | null; apiCode: number | null; failure: ParserApiFailure | null; error: string | null }> => {
  const res = await callParserApi('bo_search', {}, key, deps);
  if (res.ok) return { verdict: 'unknown', httpStatus: res.httpStatus, apiCode: null, failure: null, error: null };
  const rejected = res.failure === 'key_rejected' || res.failure === 'subscription_expired' || res.failure === 'ip_rejected';
  return { verdict: rejected ? 'rejected' : 'unknown', httpStatus: res.httpStatus, apiCode: res.apiCode, failure: res.failure, error: res.error };
};

/**
 * Пути ключей ответа без значений — для пробы: карта полей сверяется с живым ответом, а в терминал не
 * попадают ни суммы, ни имена. Массив — один путь с [] по первому элементу.
 */
export const availablePaths = (value: unknown, prefix = '', out: Set<string> = new Set(), depth = 0): string[] => {
  if (depth > 6) return [...out];
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    if (value.length > 0) availablePaths(value[0], `${prefix}[]`, out, depth + 1);
  } else {
    const object = asObject(value);
    if (object) {
      for (const [name, child] of Object.entries(object)) {
        const path = prefix === '' ? name : `${prefix}.${name}`;
        out.add(path);
        availablePaths(child, path, out, depth + 1);
      }
    }
  }
  return [...out].sort();
};
