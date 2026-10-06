// Обновление наборов parser-api.com по ИНН компании (этап 24A).
//
// Каждый запрос — место в лимите тарифа, поэтому:
//  - без ключа запросов нет вовсе;
//  - перед каждым запросом — резерв в лимите портала по сервису тарифа (сутки и месяц);
//  - ключ не принят или адрес не разрешён — проход останавливается, очередь не перебирается: следующий запрос
//    любого сервиса получил бы тот же отказ;
//  - лимит или подписка одного сервиса (свой лимит портала, 40302 / 40304 / 40305) — наборы этого сервиса дальше
//    не спрашиваются, остальные идут: тариф parser-api.com считается по сервисам (servicePauses.ts);
//  - неудача первого запроса набора — набор уходит на повтор с растущей паузой, снимка нет;
//  - неудача позже (детали, страница картотеки) — снимок того, что получено, с пометкой, чего нет (partial).

import type { ISafeFetchDeps } from '../net/safeFetch.js';
import { callParserApi, serviceOf, type ParserApiFailure } from './client.js';
import { DATASET_REFRESH_DAYS, DATASET_SERVICE, runDataset, type DatasetOutcome, type DatasetStep, type ParserApiDataset } from './datasets.js';
import { isServiceStop, pauseService, resumeService } from './servicePauses.js';
import { SCHEDULER_ACTOR, type IParserApiLimits, type IParserApiStore } from './store.js';

export type ParserApiStopReason = 'no_key' | 'daily_limit' | 'monthly_limit' | 'key_rejected' | 'subscription_expired' | 'ip_rejected';

const STOPPING: ReadonlySet<ParserApiFailure> = new Set(['key_rejected', 'subscription_expired', 'ip_rejected', 'daily_limit', 'monthly_limit']);

export type DatasetRefreshResult =
  | { status: 'checked'; outcome: DatasetOutcome; saved: boolean }
  | { status: 'failed'; error: string };

export type ParserApiRefreshResult =
  | {
      status: 'done';
      datasets: Partial<Record<ParserApiDataset, DatasetRefreshResult>>;
      /** Сервисы, исчерпанные в этом проходе (лимит, подписка): их наборы не спрашивались. */
      blocked: Record<string, ParserApiStopReason>;
    }
  | { status: 'stopped'; reason: ParserApiStopReason; detail: string; datasets: Partial<Record<ParserApiDataset, DatasetRefreshResult>> };

export interface IParserApiRefreshDeps {
  store: IParserApiStore;
  key: string | null;
  limits: IParserApiLimits;
  kadMaxPages: number;
  call?: typeof callParserApi;
  fetchDeps?: ISafeFetchDeps;
  now?: () => Date;
  /** Исчерпанные сервисы — общие для компаний одного прохода расписания. */
  blocked?: Map<string, ParserApiStopReason>;
}

/** Один запрос: резерв в лимите портала → запрос → итог в журнал; stop — дальше в этом проходе нельзя. */
export const parserApiStep = (inn: string, actor: string, key: string, deps: Omit<IParserApiRefreshDeps, 'key' | 'kadMaxPages'>): DatasetStep => {
  const { store, limits } = deps;
  const call = deps.call ?? callParserApi;
  return async (method, params, page) => {
    const service = serviceOf(method);
    const reserved = await store.reserve({ method, inn, page: page ?? null, actor }, limits);
    if (!reserved.ok) {
      const limit = reserved.reason === 'daily_limit' ? `за сутки ${reserved.usage.day} из ${limits.daily}` : `за месяц ${reserved.usage.month} из ${limits.monthly}`;
      pauseService(service, reserved.reason);
      return { ok: false, failure: reserved.reason, httpStatus: null, apiCode: null, error: `лимит портала ${service}: ${limit}`, stop: true };
    }
    const res = await call(method, params, key, deps.fetchDeps);
    await store.finish(
      reserved.id,
      res.ok
        ? { outcome: 'ok', httpStatus: res.httpStatus, apiCode: null, error: null }
        : { outcome: res.failure, httpStatus: res.httpStatus, apiCode: res.apiCode, error: res.error },
    );
    if (res.ok) {
      resumeService(service);
      return res;
    }
    if (isServiceStop(res.failure)) pauseService(service, res.failure);
    return { ...res, stop: STOPPING.has(res.failure) };
  };
};

export const refreshParserApiDatasets = async (
  inn: string,
  datasets: readonly ParserApiDataset[],
  actor: string,
  deps: IParserApiRefreshDeps,
): Promise<ParserApiRefreshResult> => {
  const { store, key } = deps;
  const results: Partial<Record<ParserApiDataset, DatasetRefreshResult>> = {};
  if (key === null) return { status: 'stopped', reason: 'no_key', detail: 'ключ parser-api.com не задан', datasets: results };

  const requestedBy = actor === SCHEDULER_ACTOR ? null : actor;
  const step = parserApiStep(inn, actor, key, deps);
  const blocked = deps.blocked ?? new Map<string, ParserApiStopReason>();

  for (const dataset of datasets) {
    const service = DATASET_SERVICE[dataset];
    const exhausted = blocked.get(service);
    if (exhausted) {
      // Срок проверки не сдвигаем: спросим, когда у сервиса освободится место.
      results[dataset] = { status: 'failed', error: `${service}: ${exhausted} — не запрашивалось` };
      continue;
    }
    // Сообщения ЕФРСБ неизменны: полученные прошлым снимком карточки не оплачиваются снова.
    const previous = dataset === 'bankruptcy' ? await store.latestRecord(inn, dataset) : null;
    const run = await runDataset(dataset, inn, step, { kadMaxPages: deps.kadMaxPages, now: deps.now?.() ?? new Date(), previous });
    if (run.status === 'done') {
      const saved = await store.saveRecord(inn, dataset, run.payload, run.complete);
      await store.markChecked(inn, dataset, run.outcome, requestedBy, DATASET_REFRESH_DAYS[dataset]);
      results[dataset] = { status: 'checked', outcome: run.outcome, saved };
    } else {
      // Свой лимит портала — не неудача набора: срок проверки не сдвигаем, спросим, когда освободится место.
      if (run.stop !== 'daily_limit' && run.stop !== 'monthly_limit') await store.markFailed(inn, dataset, run.error, requestedBy);
      results[dataset] = { status: 'failed', error: run.error };
    }
    if (run.stop && isServiceStop(run.stop)) blocked.set(service, run.stop as ParserApiStopReason);
    else if (run.stop) return { status: 'stopped', reason: run.stop as ParserApiStopReason, detail: run.status === 'failed' ? run.error : `${dataset}: ${run.stop}`, datasets: results };
  }
  return { status: 'done', datasets: results, blocked: Object.fromEntries(blocked) };
};
