// Пересчёт снимка сигналов на явный срез.
//
//  - журнал пересчёта пишется до расчёта (running) отдельной транзакцией;
//  - снимки всех компаний и переключение на новый пересчёт (succeeded) — одна транзакция;
//  - ошибка откатывает снимки и помечает пересчёт failed: карточка продолжает читать прошлый успешный снимок
//    и показывает, что он устарел;
//  - два пересчёта одновременно не идут (advisory lock), зависший running старше часа считается проваленным.

import { getPool, withTransaction } from '../db/pool.js';
import { loadCompanyInputs } from './load.js';
import { computeCompanySignals } from './rules.js';
import { SIGNAL_RULES_VERSION, type ICompanySignals } from './types.js';

const LOCK_KEY = 707_001;
const BATCH = 200;
const KEEP_SUCCEEDED = 3;

export interface IRefreshOptions {
  cutoff?: Date;
  requestedBy?: string;
  /** Точка сбоя для тестов: внутри транзакции записи снимков, перед переключением. */
  beforeCommit?: () => Promise<void>;
}

export type RefreshResult =
  | { outcome: 'succeeded'; refreshId: number; companies: number; cutoff: string; durationMs: number }
  | { outcome: 'failed'; refreshId: number; error: string }
  | { outcome: 'already_running' };

export const refreshSignals = async (options: IRefreshOptions = {}): Promise<RefreshResult> => {
  const pool = getPool();
  const lock = await pool.connect();
  try {
    const locked = (await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])).rows[0]!.ok;
    if (!locked) return { outcome: 'already_running' };
    try {
      await pool.query(
        `UPDATE signal_refreshes SET status = 'failed', error = 'пересчёт прерван (процесс завершился)', finished_at = now()
         WHERE status = 'running' AND started_at < now() - interval '1 hour'`,
      );
      const cutoff = options.cutoff ?? new Date();
      const startedAt = Date.now();
      const refreshId = (
        await pool.query<{ id: number }>(
          'INSERT INTO signal_refreshes (rules_version, cutoff_at, requested_by) VALUES ($1, $2, $3) RETURNING id',
          [SIGNAL_RULES_VERSION, cutoff, options.requestedBy ?? 'system'],
        )
      ).rows[0]!.id;

      try {
        const companies = await withTransaction(async client => {
          const ids = (
            await client.query<{ id: number }>('SELECT id FROM companies WHERE merged_into_id IS NULL AND created_at <= $1 ORDER BY id', [cutoff])
          ).rows.map(r => r.id);
          for (let i = 0; i < ids.length; i += BATCH) {
            const inputs = await loadCompanyInputs(client, ids.slice(i, i + BATCH), cutoff);
            for (const input of inputs) await writeSnapshot(client, refreshId, computeCompanySignals(input, cutoff));
          }
          if (options.beforeCommit) await options.beforeCommit();
          await client.query(
            `UPDATE signal_refreshes SET status = 'succeeded', companies = $2, finished_at = now() WHERE id = $1`,
            [refreshId, ids.length],
          );
          // Производные снимки старых пересчётов не нужны: журнал остаётся, строки снимков — только у последних.
          await client.query(
            `DELETE FROM company_signal_snapshots WHERE refresh_id IN (
               SELECT id FROM signal_refreshes WHERE status = 'succeeded' AND id <> $1
               ORDER BY finished_at DESC, id DESC OFFSET $2)`,
            [refreshId, KEEP_SUCCEEDED - 1],
          );
          return ids.length;
        });
        return { outcome: 'succeeded', refreshId, companies, cutoff: cutoff.toISOString(), durationMs: Date.now() - startedAt };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await pool.query(`UPDATE signal_refreshes SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [refreshId, error.slice(0, 2000)]);
        return { outcome: 'failed', refreshId, error };
      }
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    lock.release();
  }
};

const writeSnapshot = async (
  client: import('pg').PoolClient,
  refreshId: number,
  s: ICompanySignals,
): Promise<void> => {
  await client.query(
    `INSERT INTO company_signal_snapshots
       (refresh_id, company_id, payload, identity_status, projects, events_dated_12m, events_undated, publications, families, roles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      refreshId,
      s.companyId,
      JSON.stringify(s),
      s.identity.status,
      s.experience.projects.value,
      s.media.eventsDated12m.value ?? 0,
      s.media.eventsUndated.value ?? 0,
      s.media.publications.value,
      s.media.families.value,
      Object.keys(s.experience.byRole).sort(),
    ],
  );
};

export interface IRefreshState {
  active: { id: number; rulesVersion: string; cutoffAt: string; finishedAt: string } | null;
  lastFailure: { id: number; error: string | null; finishedAt: string } | null;
  running: boolean;
  stale: boolean;
  staleReasons: string[];
}

/** Какой снимок читается и почему он может быть устаревшим. */
export const refreshState = async (): Promise<IRefreshState> => {
  const pool = getPool();
  const active = (
    await pool.query<{ id: number; rules_version: string; cutoff_at: Date; finished_at: Date }>('SELECT id, rules_version, cutoff_at, finished_at FROM signal_active_refresh_v')
  ).rows[0];
  const failure = (
    await pool.query<{ id: number; error: string | null; finished_at: Date }>(
      `SELECT id, error, finished_at FROM signal_refreshes WHERE status = 'failed' AND ($1::bigint IS NULL OR id > $1)
       ORDER BY id DESC LIMIT 1`,
      [active?.id ?? null],
    )
  ).rows[0];
  const running = (await pool.query(`SELECT 1 FROM signal_refreshes WHERE status = 'running'`)).rowCount! > 0;

  const staleReasons: string[] = [];
  if (!active) staleReasons.push('сигналы ещё не рассчитывались');
  if (failure) staleReasons.push('последний пересчёт завершился ошибкой — показан предыдущий успешный снимок');
  if (active && active.rules_version !== SIGNAL_RULES_VERSION) staleReasons.push(`снимок рассчитан по правилам ${active.rules_version}`);
  if (active) {
    const changed = (
      await pool.query<{ changed: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM assertions WHERE updated_at > $1)
             OR EXISTS (SELECT 1 FROM evidence WHERE created_at > $1 OR status_changed_at > $1)
             OR EXISTS (SELECT 1 FROM review_decisions WHERE decided_at > $1)
             OR EXISTS (SELECT 1 FROM entity_identifiers WHERE created_at > $1) AS changed`,
        [active.cutoff_at],
      )
    ).rows[0]!.changed;
    if (changed) staleReasons.push('после среза появились новые утверждения, доказательства или решения');
  }
  return {
    active: active
      ? { id: active.id, rulesVersion: active.rules_version, cutoffAt: active.cutoff_at.toISOString(), finishedAt: active.finished_at.toISOString() }
      : null,
    lastFailure: failure ? { id: failure.id, error: failure.error, finishedAt: failure.finished_at.toISOString() } : null,
    running,
    stale: staleReasons.length > 0,
    staleReasons,
  };
};
