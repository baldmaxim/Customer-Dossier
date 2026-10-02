// Обновление сведений компании из Контур.Фокуса (ADR-015): req (реквизиты, статус, руководитель,
// адрес), затем egrDetails (виды деятельности, капитал, учредители).
//
// Каждый запрос — деньги тарифа, поэтому:
//  - без ключа запросов нет вовсе; лимит за скользящие сутки проверяется до первого запроса компании;
//  - Фокус не знает компанию по req — egrDetails не спрашивается;
//  - ключ не принят, тариф исчерпан, слишком часто — проход останавливается, а не перебирает очередь;
//  - 401/403 на egrDetails — метод не входит в тариф: дальше в этом проходе он не спрашивается,
//    сведения req сохраняются;
//  - сбой сети или Фокуса — компания уходит на повтор с растущей паузой (store.markFailed).

import { callFocus, FOCUS_METHODS, type FocusMethod, type IFocusIdentifier, type IFocusItem } from './client.js';
import type { ISafeFetchDeps } from '../net/safeFetch.js';
import { SCHEDULER_ACTOR, type FocusJournalOutcome, type IFocusStore } from './store.js';

export type FocusStopReason = 'no_key' | 'limit' | 'key_rejected' | 'quota_exhausted' | 'rate_limited';

export type FocusRefreshResult =
  | { status: 'found' | 'not_found'; saved: number; skippedMethods: FocusMethod[] }
  | { status: 'stopped'; reason: FocusStopReason; detail: string }
  | { status: 'failed'; error: string };

/** Состояние одного прохода: методы, которых нет в тарифе, второй раз не спрашиваются. */
export interface IFocusPassState {
  forbiddenMethods: Set<FocusMethod>;
}

export const newPassState = (): IFocusPassState => ({ forbiddenMethods: new Set() });

export interface IFocusRefreshDeps {
  store: IFocusStore;
  key: string | null;
  dailyLimit: number;
  refreshDays: number;
  call?: typeof callFocus;
  fetchDeps?: ISafeFetchDeps;
  state?: IFocusPassState;
}

/** Элемент ответа именно про эту компанию: Фокус отвечает списком. */
const pickItem = (items: readonly IFocusItem[], target: IFocusIdentifier): IFocusItem | null =>
  items.find(item => item[target.type] === target.value) ?? null;

const STOPPING: ReadonlySet<FocusJournalOutcome> = new Set(['key_rejected', 'quota_exhausted', 'rate_limited']);

export const refreshFocusTarget = async (target: IFocusIdentifier, actor: string, deps: IFocusRefreshDeps): Promise<FocusRefreshResult> => {
  const { store, key, dailyLimit, refreshDays } = deps;
  const call = deps.call ?? callFocus;
  const state = deps.state ?? newPassState();
  if (key === null) return { status: 'stopped', reason: 'no_key', detail: 'ключ Контур.Фокуса не задан' };

  const methods = FOCUS_METHODS.filter(m => !state.forbiddenMethods.has(m));
  const used = await store.usedLastDay();
  if (used + methods.length > dailyLimit) {
    return { status: 'stopped', reason: 'limit', detail: `за сутки ушло ${used} запросов из ${dailyLimit}` };
  }

  const requestedBy = actor === SCHEDULER_ACTOR ? null : actor;
  const skippedMethods: FocusMethod[] = [...state.forbiddenMethods];
  let saved = 0;
  for (const method of methods) {
    const res = await call(method, target, key, deps.fetchDeps);
    if (!res.ok) {
      const outcome: FocusJournalOutcome = res.failure === 'forbidden' ? (method === 'req' ? 'key_rejected' : 'method_forbidden') : res.failure;
      await store.journal({ method, identifiersCount: 1, httpStatus: res.httpStatus, outcome, error: res.error, actor });
      if (outcome === 'method_forbidden') {
        state.forbiddenMethods.add(method);
        skippedMethods.push(method);
        continue;
      }
      if (STOPPING.has(outcome)) return { status: 'stopped', reason: outcome as FocusStopReason, detail: res.error };
      const error = `${method}: ${res.error}`;
      await store.markFailed(target, error, requestedBy);
      return { status: 'failed', error };
    }
    await store.journal({ method, identifiersCount: 1, httpStatus: res.httpStatus, outcome: 'ok', error: null, actor });
    const item = pickItem(res.items, target);
    if (!item) {
      if (method === 'req') {
        await store.markChecked(target, 'not_found', requestedBy, refreshDays);
        return { status: 'not_found', saved, skippedMethods };
      }
      continue;
    }
    if (await store.saveRecord(target, method, item)) saved += 1;
  }
  await store.markChecked(target, 'found', requestedBy, refreshDays);
  return { status: 'found', saved, skippedMethods };
};
