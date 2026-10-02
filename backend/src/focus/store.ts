// Запись ответов Контур.Фокуса (миграция 040): снимки, сроки проверки, журнал запросов.
//
// Снимок — новая строка только при изменившемся ответе (hash payload); строки не правятся. Журнал
// считает расход тарифа: лимит FOCUS_DAILY_LIMIT — по успешным запросам за скользящие сутки.

import { execute, queryOne, withTransaction } from '../db/pool.js';
import { payloadHash } from '../snapshot/canonical.js';
import type { FocusMethod, IFocusIdentifier, IFocusItem } from './client.js';

/** Актор прохода по расписанию; ручное обновление подписывается логином. */
export const SCHEDULER_ACTOR = 'scheduler';

export type FocusJournalOutcome =
  | 'ok'
  | 'key_rejected'
  | 'method_forbidden'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'bad_response'
  | 'http_error'
  | 'network';

export interface IFocusJournalEntry {
  method: FocusMethod | 'stat';
  identifiersCount: number;
  httpStatus: number | null;
  outcome: FocusJournalOutcome;
  error: string | null;
  actor: string;
}

/** Хранилище за интерфейсом: логика обновления (focus/refresh.ts) проверяется без базы. */
export interface IFocusStore {
  usedLastDay(): Promise<number>;
  journal(entry: IFocusJournalEntry): Promise<void>;
  /** true — ответ новый и записан; false — такой же, как последний. */
  saveRecord(target: IFocusIdentifier, method: FocusMethod, item: IFocusItem): Promise<boolean>;
  /** requestedBy — логин ручного запроса; null — по расписанию. */
  markChecked(target: IFocusIdentifier, outcome: 'found' | 'not_found', requestedBy: string | null, refreshDays: number): Promise<void>;
  markFailed(target: IFocusIdentifier, error: string, requestedBy: string | null): Promise<void>;
}

/** Пауза до повтора после неудачи: час за каждую неудачу подряд, не больше суток. */
const MAX_BACKOFF_HOURS = 24;

export const pgFocusStore: IFocusStore = {
  usedLastDay: async () => {
    const row = await queryOne<{ used: number }>(
      `SELECT coalesce(sum(identifiers_count), 0)::int AS used FROM focus_requests
       WHERE outcome = 'ok' AND requested_at > now() - interval '24 hours'`,
    );
    return row?.used ?? 0;
  },

  journal: async entry => {
    await execute(
      `INSERT INTO focus_requests (method, identifiers_count, http_status, outcome, error, actor) VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.method, entry.identifiersCount, entry.httpStatus, entry.outcome, entry.error, entry.actor],
    );
  },

  saveRecord: async (target, method, item) =>
    withTransaction(async client => {
      // Расписание и кнопка могут ответить одновременно: без блокировки два одинаковых снимка.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`focus:${target.type}:${target.value}:${method}`]);
      const hash = payloadHash(item.payload);
      const latest = await client.query<{ payload_hash: string }>(
        `SELECT payload_hash FROM focus_records WHERE identifier_type = $1 AND identifier = $2 AND method = $3
         ORDER BY fetched_at DESC, id DESC LIMIT 1`,
        [target.type, target.value, method],
      );
      if (latest.rows[0]?.payload_hash === hash) return false;
      await client.query(
        `INSERT INTO focus_records (identifier_type, identifier, method, inn, ogrn, payload, payload_hash)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [target.type, target.value, method, item.inn, item.ogrn, JSON.stringify(item.payload), hash],
      );
      return true;
    }),

  markChecked: async (target, outcome, requestedBy, refreshDays) => {
    await execute(
      `INSERT INTO focus_checks (identifier_type, identifier, outcome, checked_at, next_check_at, attempt_count, last_error, requested_by)
       VALUES ($1, $2, $3, now(), now() + $4::int * interval '1 day', 0, NULL, $5)
       ON CONFLICT (identifier_type, identifier) DO UPDATE SET
         outcome = EXCLUDED.outcome, checked_at = now(), next_check_at = EXCLUDED.next_check_at, attempt_count = 0,
         last_error = NULL, requested_by = coalesce(EXCLUDED.requested_by, focus_checks.requested_by), updated_at = now()`,
      [target.type, target.value, outcome, refreshDays, requestedBy],
    );
  },

  markFailed: async (target, error, requestedBy) => {
    await execute(
      `INSERT INTO focus_checks (identifier_type, identifier, next_check_at, attempt_count, last_error, requested_by)
       VALUES ($1, $2, now() + interval '1 hour', 1, $3, $4)
       ON CONFLICT (identifier_type, identifier) DO UPDATE SET
         attempt_count = focus_checks.attempt_count + 1, last_error = EXCLUDED.last_error,
         next_check_at = now() + least(focus_checks.attempt_count + 1, $5::int) * interval '1 hour',
         requested_by = coalesce(EXCLUDED.requested_by, focus_checks.requested_by), updated_at = now()`,
      [target.type, target.value, error, requestedBy, MAX_BACKOFF_HOURS],
    );
  },
};
