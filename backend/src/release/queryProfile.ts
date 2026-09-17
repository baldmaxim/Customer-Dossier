// Профиль SQL-запросов шагов замера (этап 18, query-profile@1). Включается только флагом `release:bench -- --profile-queries`
// на тестовой цели: оборачивает query пула и выданных им клиентов в том же процессе, где работает API замера.
//
// Пишутся только нормализованный текст запроса (без параметров и литералов — значения не сохраняются), число вызовов и время.
// Цель — найти дорогие запросы и N+1 для последующего EXPLAIN пользователем, а не выставить оценку.

import type { Pool, PoolClient } from 'pg';

export const QUERY_PROFILE_VERSION = 'query-profile@1';
/** Один и тот же запрос больше этого числа раз на выборку — признак N+1. */
export const N_PLUS_ONE_THRESHOLD = 20;

export interface IQueryStat {
  sql: string;
  calls: number;
  totalMs: number;
  maxMs: number;
}

export interface IStepQueryProfile {
  version: typeof QUERY_PROFILE_VERSION;
  samples: number;
  queriesPerSample: number;
  msPerSample: number;
  top: IQueryStat[];
  suspectedNPlusOne: Array<{ sql: string; callsPerSample: number }>;
}

/** Текст запроса без литералов и лишних пробелов, первые 240 символов: одинаковые запросы с разными значениями совпадают. */
export const normalizeSql = (text: string): string =>
  text
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

export const summarizeProfile = (stats: ReadonlyMap<string, IQueryStat>, samples: number, topN = 5): IStepQueryProfile => {
  const list = [...stats.values()];
  const n = Math.max(1, samples);
  const round = (v: number): number => Math.round(v * 10) / 10;
  return {
    version: QUERY_PROFILE_VERSION,
    samples,
    queriesPerSample: round(list.reduce((s, q) => s + q.calls, 0) / n),
    msPerSample: round(list.reduce((s, q) => s + q.totalMs, 0) / n),
    top: [...list].sort((a, b) => b.totalMs - a.totalMs).slice(0, topN).map(q => ({ ...q, totalMs: round(q.totalMs), maxMs: round(q.maxMs) })),
    suspectedNPlusOne: list
      .filter(q => q.calls / n > N_PLUS_ONE_THRESHOLD)
      .map(q => ({ sql: q.sql, callsPerSample: round(q.calls / n) }))
      .sort((a, b) => b.callsPerSample - a.callsPerSample),
  };
};

export interface IQueryProfiler {
  begin: () => void;
  end: (samples: number) => IStepQueryProfile;
  uninstall: () => void;
}

type QueryFn = (...args: unknown[]) => unknown;

const textOf = (arg: unknown): string | null =>
  typeof arg === 'string' ? arg : arg && typeof arg === 'object' && typeof (arg as { text?: unknown }).text === 'string' ? (arg as { text: string }).text : null;

export const installQueryProfiler = (pool: Pool): IQueryProfiler => {
  let active: Map<string, IQueryStat> | null = null;
  const record = (sql: string | null, ms: number): void => {
    if (!active || sql === null) return;
    const key = normalizeSql(sql);
    const s = active.get(key) ?? { sql: key, calls: 0, totalMs: 0, maxMs: 0 };
    s.calls += 1;
    s.totalMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    active.set(key, s);
  };
  const wrap = (target: { query: QueryFn }): (() => void) => {
    const original = target.query;
    target.query = function wrapped(this: unknown, ...args: unknown[]): unknown {
      const started = performance.now();
      const result = original.apply(target, args);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(
          () => record(textOf(args[0]), performance.now() - started),
          () => record(textOf(args[0]), performance.now() - started),
        );
      }
      return result;
    };
    return () => {
      target.query = original;
    };
  };

  const restorePool = wrap(pool as unknown as { query: QueryFn });
  const wrappedClients = new WeakSet<PoolClient>();
  const onConnect = (client: PoolClient): void => {
    if (wrappedClients.has(client)) return;
    wrappedClients.add(client);
    wrap(client as unknown as { query: QueryFn });
  };
  pool.on('connect', onConnect);
  // Клиенты, уже созданные до установки, оборачиваются при выдаче.
  const onAcquire = (client: PoolClient): void => onConnect(client);
  pool.on('acquire', onAcquire);

  return {
    begin: () => {
      active = new Map();
    },
    end: samples => {
      const summary = summarizeProfile(active ?? new Map(), samples);
      active = null;
      return summary;
    },
    uninstall: () => {
      restorePool();
      pool.off('connect', onConnect);
      pool.off('acquire', onAcquire);
    },
  };
};
