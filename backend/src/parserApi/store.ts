// Запись parser-api.com (миграция 044): резерв лимита, журнал, снимки наборов, сроки проверки.
//
// Лимит резервируется ДО каждого запроса: строка журнала pending под блокировкой сервиса занимает место, и
// расписание с кнопкой «Обновить» вместе не выйдут за предел. Лимит — на каждый сервис тарифа отдельно (arbitr,
// fssp, fedresurs, nalog_bo, nalog_pb — так считает parser-api.com). Оплачиваемым считается только ответ
// success = 1 (так считает сервис); неудача место освобождает. Сутки — скользящие 24 часа, месяц — календарный
// по Москве: у сервиса месяц — срок оплаты, поэтому точный отказ (40304 / 40305) всё равно придёт от него.

import { execute, getPool, query, queryOne, withTransaction } from '../db/pool.js';
import { payloadHash } from '../snapshot/canonical.js';
import { isParserApiMethod, methodsOfService, PARSER_API_SERVICES, serviceOf, type ParserApiFailure, type ParserApiMethod } from './client.js';
import type { DatasetOutcome, IDatasetPayload, ParserApiDataset } from './datasets.js';
import { latestParserApiRecord } from './read.js';

export const SCHEDULER_ACTOR = 'scheduler';

export type ParserApiJournalOutcome = 'ok' | ParserApiFailure;

export interface IParserApiLimits {
  daily: number;
  monthly: number;
}

export interface IParserApiUsage {
  /** Оплачиваемые и ещё не завершённые запросы за 24 часа. */
  day: number;
  /** То же с начала календарного месяца (Москва). */
  month: number;
}

/** Расход по сервисам тарифа: у каждого сервиса портала строка, нулевая — если запросов не было. */
export type ParserApiUsageByService = Record<string, IParserApiUsage>;

export type ReserveResult =
  | { ok: true; id: number }
  | { ok: false; reason: 'daily_limit' | 'monthly_limit'; service: string; usage: IParserApiUsage };

export interface IJournalFinish {
  outcome: ParserApiJournalOutcome;
  httpStatus: number | null;
  apiCode: number | null;
  error: string | null;
}

/** Хранилище за интерфейсом: логика прохода (parserApi/refresh.ts) проверяется без базы. */
export interface IParserApiStore {
  usage(): Promise<ParserApiUsageByService>;
  /** Место в лимите сервиса этого метода. */
  reserve(entry: { method: ParserApiMethod | 'key_check'; inn: string | null; page: number | null; actor: string }, limits: IParserApiLimits): Promise<ReserveResult>;
  finish(id: number, result: IJournalFinish): Promise<void>;
  /** true — набор новый и записан; false — такой же, как последний. */
  saveRecord(inn: string, dataset: ParserApiDataset, payload: IDatasetPayload, complete: boolean): Promise<boolean>;
  markChecked(inn: string, dataset: ParserApiDataset, outcome: DatasetOutcome, requestedBy: string | null, refreshDays: number): Promise<void>;
  markFailed(inn: string, dataset: ParserApiDataset, error: string, requestedBy: string | null): Promise<void>;
  /** Какие из CaseId (строчными) уже получены. */
  knownCaseCards(caseIds: readonly string[]): Promise<Set<string>>;
  /** true — карточка записана; false — она уже была (дело спросили параллельно). */
  saveCaseCard(caseId: string, body: Record<string, unknown>, requestedBy: string): Promise<boolean>;
  /** Последний снимок набора: из картотеки выбираются дела для карточек, Федресурс переносит полученные сообщения. */
  latestRecord(inn: string, dataset: ParserApiDataset): Promise<IDatasetPayload | null>;
}

/** Что занимает место в лимите: оплаченное и ещё не завершённое (упавший процесс — тоже, с запасом). */
const USAGE_COLUMNS = `
  count(*) FILTER (WHERE requested_at > now() - interval '24 hours')::int AS day,
  count(*) FILTER (WHERE requested_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow')::int AS month`;
const USAGE_FROM = `
  FROM parser_api_requests
  WHERE (billable OR outcome = 'pending')
    AND requested_at >= least(now() - interval '24 hours', date_trunc('month', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow')`;
const USAGE_BY_METHOD_SQL = `SELECT method, ${USAGE_COLUMNS} ${USAGE_FROM} GROUP BY method`;
const SERVICE_USAGE_SQL = `SELECT ${USAGE_COLUMNS} ${USAGE_FROM} AND method = ANY($1::text[])`;

/** Расход по методам → по сервисам; сервисы без запросов — нулями. */
export const usageByService = (rows: ReadonlyArray<{ method: string } & IParserApiUsage>): ParserApiUsageByService => {
  const usage: ParserApiUsageByService = Object.fromEntries(PARSER_API_SERVICES.map(s => [s, { day: 0, month: 0 }]));
  for (const row of rows) {
    const service = isParserApiMethod(row.method) || row.method === 'key_check' ? serviceOf(row.method) : null;
    if (service === null) continue;
    const entry = (usage[service] ??= { day: 0, month: 0 });
    entry.day += row.day;
    entry.month += row.month;
  }
  return usage;
};

/** Пауза до повтора после неудачи: час за каждую неудачу подряд, не больше суток. */
const MAX_BACKOFF_HOURS = 24;

export const pgParserApiStore: IParserApiStore = {
  usage: async () => usageByService(await query<{ method: string } & IParserApiUsage>(USAGE_BY_METHOD_SQL)),

  reserve: async (entry, limits) =>
    withTransaction(async client => {
      const service = serviceOf(entry.method);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`parser-api:budget:${service}`]);
      const usage = (await client.query<IParserApiUsage>(SERVICE_USAGE_SQL, [methodsOfService(service)])).rows[0] ?? { day: 0, month: 0 };
      if (usage.day + 1 > limits.daily) return { ok: false, reason: 'daily_limit', service, usage } as const;
      if (usage.month + 1 > limits.monthly) return { ok: false, reason: 'monthly_limit', service, usage } as const;
      const row = await client.query<{ id: number }>(
        `INSERT INTO parser_api_requests (method, inn, page, outcome, actor) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
        [entry.method, entry.inn, entry.page, entry.actor],
      );
      return { ok: true, id: row.rows[0]!.id } as const;
    }),

  finish: async (id, result) => {
    await execute(
      `UPDATE parser_api_requests
       SET outcome = $2, http_status = $3, api_code = $4, error = $5, billable = ($2 = 'ok'), finished_at = now()
       WHERE id = $1`,
      [id, result.outcome, result.httpStatus, result.apiCode, result.error],
    );
  },

  saveRecord: async (inn, dataset, payload, complete) =>
    withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`parser-api:${inn}:${dataset}`]);
      const hash = payloadHash(payload);
      const latest = await client.query<{ payload_hash: string }>(
        `SELECT payload_hash FROM parser_api_records WHERE inn = $1 AND dataset = $2 ORDER BY fetched_at DESC, id DESC LIMIT 1`,
        [inn, dataset],
      );
      if (latest.rows[0]?.payload_hash === hash) return false;
      await client.query(
        `INSERT INTO parser_api_records (inn, dataset, payload, payload_hash, complete) VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [inn, dataset, JSON.stringify(payload), hash, complete],
      );
      return true;
    }),

  markChecked: async (inn, dataset, outcome, requestedBy, refreshDays) => {
    await execute(
      `INSERT INTO parser_api_checks (inn, dataset, outcome, checked_at, next_check_at, attempt_count, last_error, requested_by)
       VALUES ($1, $2, $3, now(), now() + $4::int * interval '1 day', 0, NULL, $5)
       ON CONFLICT (inn, dataset) DO UPDATE SET
         outcome = EXCLUDED.outcome, checked_at = now(), next_check_at = EXCLUDED.next_check_at, attempt_count = 0,
         last_error = NULL, requested_by = coalesce(EXCLUDED.requested_by, parser_api_checks.requested_by), updated_at = now()`,
      [inn, dataset, outcome, refreshDays, requestedBy],
    );
  },

  markFailed: async (inn, dataset, error, requestedBy) => {
    await execute(
      `INSERT INTO parser_api_checks (inn, dataset, next_check_at, attempt_count, last_error, requested_by)
       VALUES ($1, $2, now() + interval '1 hour', 1, $3, $4)
       ON CONFLICT (inn, dataset) DO UPDATE SET
         attempt_count = parser_api_checks.attempt_count + 1, last_error = EXCLUDED.last_error,
         next_check_at = now() + least(parser_api_checks.attempt_count + 1, $5::int) * interval '1 hour',
         requested_by = coalesce(EXCLUDED.requested_by, parser_api_checks.requested_by), updated_at = now()`,
      [inn, dataset, error, requestedBy, MAX_BACKOFF_HOURS],
    );
  },

  knownCaseCards: async caseIds => {
    if (caseIds.length === 0) return new Set();
    const rows = await query<{ case_id: string }>(`SELECT case_id FROM parser_api_case_cards WHERE case_id = ANY($1::text[])`, [[...caseIds]]);
    return new Set(rows.map(r => r.case_id));
  },

  saveCaseCard: async (caseId, body, requestedBy) => {
    const row = await queryOne<{ id: number }>(
      `INSERT INTO parser_api_case_cards (case_id, payload, requested_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (case_id) DO NOTHING RETURNING id`,
      [caseId, JSON.stringify(body), requestedBy],
    );
    return row !== null;
  },

  latestRecord: async (inn, dataset) => (await latestParserApiRecord(getPool(), inn, dataset))?.payload ?? null,
};
