// Клиент API Контур.Фокуса (ADR-015): https://focus-api.kontur.ru/api3/<метод>?key=…&inn=…
//
// Сеть — только через net/safeFetch: один разрешённый хост, без перенаправлений (ключ стоит в адресе
// запроса и не должен уехать по редиректу), лимиты времени и размера. Ключ не попадает ни в лог, ни
// в текст ошибки: адрес запроса не печатается, тело ответа обрезается и ключ в нём замазывается.
//
// Клиент не решает, что делать с отказом: 401/403 на req — ключ не принят, на egrDetails — метод не
// входит в тариф; это различает focus/refresh.ts.

import { NetworkPolicyError, safeFetch, type ISafeFetchDeps, type ISourceNetworkPolicy } from '../net/safeFetch.js';

export const FOCUS_HOST = 'focus-api.kontur.ru';
export const FOCUS_API_BASE = `https://${FOCUS_HOST}/api3/`;

export const FOCUS_METHODS = ['req', 'egrDetails'] as const;
export type FocusMethod = (typeof FOCUS_METHODS)[number];

export type FocusIdentifierType = 'inn' | 'ogrn';

export interface IFocusIdentifier {
  type: FocusIdentifierType;
  value: string;
}

export interface IFocusItem {
  inn: string | null;
  ogrn: string | null;
  payload: Record<string, unknown>;
}

/** forbidden — 401/403; что это значит для метода, решает вызывающий. */
export type FocusCallFailure = 'forbidden' | 'quota_exhausted' | 'rate_limited' | 'bad_response' | 'http_error' | 'network';

export type FocusCallResult =
  | { ok: true; httpStatus: number; items: IFocusItem[] }
  | { ok: false; failure: FocusCallFailure; httpStatus: number | null; error: string };

const FOCUS_POLICY: ISourceNetworkPolicy = {
  allowedHosts: [FOCUS_HOST],
  allowSubdomains: false,
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRedirects: 0,
};

const ERROR_BODY_CHARS = 200;

/** Короткий текст ответа для журнала: без переводов строк и без ключа, даже если сервер его повторил. */
const errorText = (body: string, key: string): string =>
  (key === '' ? body : body.split(key).join('***')).replace(/\s+/g, ' ').trim().slice(0, ERROR_BODY_CHARS);

const failureOf = (status: number): FocusCallFailure => {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 402) return 'quota_exhausted';
  if (status === 429) return 'rate_limited';
  return 'http_error';
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asIdentifier = (value: unknown): string | null => (typeof value === 'string' && /^[0-9]{10,15}$/.test(value) ? value : null);

/** Ответ методов по компаниям — массив объектов, по одному на найденную. Неизвестную компанию Фокус не возвращает. */
export const parseFocusItems = (text: string): IFocusItem[] | null => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const items: IFocusItem[] = [];
  for (const element of data) {
    const payload = asObject(element);
    if (!payload) return null;
    items.push({ inn: asIdentifier(payload.inn), ogrn: asIdentifier(payload.ogrn), payload });
  }
  return items;
};

const request = async (
  path: string,
  params: Record<string, string>,
  key: string,
  deps: ISafeFetchDeps,
): Promise<{ ok: true; status: number; text: string } | { ok: false; failure: FocusCallFailure; httpStatus: number | null; error: string }> => {
  const url = new URL(path, FOCUS_API_BASE);
  url.searchParams.set('key', key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  try {
    const res = await safeFetch(url, FOCUS_POLICY, { headers: { accept: 'application/json' } }, deps);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, text: res.text };
    return { ok: false, failure: failureOf(res.status), httpStatus: res.status, error: errorText(res.text, key) || `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof NetworkPolicyError ? err.message : err instanceof Error ? err.message : String(err);
    return { ok: false, failure: 'network', httpStatus: null, error: errorText(message, key) };
  }
};

/** Один метод по одному реквизиту. Пустой список — Фокус компанию не знает. */
export const callFocus = async (
  method: FocusMethod,
  identifier: IFocusIdentifier,
  key: string,
  deps: ISafeFetchDeps = {},
): Promise<FocusCallResult> => {
  const res = await request(method, { [identifier.type]: identifier.value }, key, deps);
  if (!res.ok) return res;
  const items = parseFocusItems(res.text);
  if (items === null) return { ok: false, failure: 'bad_response', httpStatus: res.status, error: 'ответ не похож на список компаний' };
  return { ok: true, httpStatus: res.status, items };
};

export type FocusKeyVerdict = 'accepted' | 'rejected' | 'unknown';

/**
 * Проверка ключа методом stat (статистика расхода): реквизитов не передаёт и, по описанию API,
 * запросов тарифа не тратит. Неверный ключ stat отвергает не 403, а 400 «Param 'key' not specified or
 * invalid» (проверено 02.10.2026 с сервера): других параметров у stat нет, так что 400 — тоже отказ.
 * Сеть или сбой Фокуса — unknown: ключ сохраняется, проверим проходом.
 */
export const checkFocusKey = async (
  key: string,
  deps: ISafeFetchDeps = {},
): Promise<{ verdict: FocusKeyVerdict; httpStatus: number | null; failure: FocusCallFailure | null; error: string | null }> => {
  const res = await request('stat', {}, key, deps);
  if (res.ok) return { verdict: 'accepted', httpStatus: res.status, failure: null, error: null };
  const rejected = res.failure === 'forbidden' || res.httpStatus === 400;
  return { verdict: rejected ? 'rejected' : 'unknown', httpStatus: res.httpStatus, failure: rejected ? 'forbidden' : res.failure, error: res.error };
};
