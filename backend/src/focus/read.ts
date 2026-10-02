// Сведения Контур.Фокуса для карточки компании (ADR-015).
//
// Показываются с датой проверки и атрибуцией: это записи ЕГРЮЛ/ЕГРИП в изложении сервиса на дату,
// а не оценка компании и не утверждение портала. Изменения — разница соседних снимков на чтении,
// отдельной таблицы изменений нет (как у реестра, этап 20B).

import { env } from '../config/env.js';
import type { DbExecutor } from '../db/pool.js';
import { focusApiKey } from '../settings/focusKey.js';
import type { FocusMethod, IFocusIdentifier } from './client.js';
import {
  diffFields,
  focusHrefOf,
  mapMethod,
  orderFields,
  summaryOf,
  type IFocusField,
  type IFocusFieldChange,
  type IFocusSummary,
} from './map.js';
import { companyFocusTarget, type FocusTargetProblem } from './targets.js';

/** Сколько снимков читаем для истории изменений (оба метода вместе): карточка, а не архив. */
export const FOCUS_HISTORY_LIMIT = 20;

/** Ответы req и egrDetails одного обновления приходят с разницей в секунды — это одно изменение. */
const SAME_REFRESH_MS = 5 * 60_000;

export const FOCUS_ATTRIBUTION =
  'Сведения ЕГРЮЛ/ЕГРИП по данным Контур.Фокуса на дату проверки. Это записи государственного реестра в изложении сервиса, а не оценка компании.';

export interface IFocusChangeEntry {
  fetchedAt: string;
  changes: IFocusFieldChange[];
}

export interface IFocusView {
  /** Ключ задан: портал может спрашивать Фокус. */
  configured: boolean;
  /** Обновление по расписанию включено (FOCUS_ENABLED), раз в refreshDays дней. */
  scheduled: boolean;
  refreshDays: number;
  identifier: IFocusIdentifier | null;
  problem: FocusTargetProblem | null;
  check: {
    outcome: 'found' | 'not_found' | null;
    checkedAt: string | null;
    nextCheckAt: string;
    attemptCount: number;
    lastError: string | null;
  } | null;
  /** Время последнего изменившегося ответа; сведения подтверждены на check.checkedAt. */
  fetchedAt: string | null;
  fields: IFocusField[];
  summary: IFocusSummary | null;
  focusHref: string | null;
  changes: IFocusChangeEntry[];
  coverage: { loaded: number; truncated: boolean };
  attribution: string;
}

interface IRecordRow {
  method: FocusMethod;
  payload: Record<string, unknown>;
  fetched_at: Date;
}

interface ICheckRow {
  outcome: 'found' | 'not_found' | null;
  checked_at: Date | null;
  next_check_at: Date;
  attempt_count: number;
  last_error: string | null;
}

const changesOf = (rows: readonly IRecordRow[]): IFocusChangeEntry[] => {
  const raw: Array<{ at: Date; changes: IFocusFieldChange[] }> = [];
  for (const method of ['req', 'egrDetails'] as const) {
    const own = rows.filter(r => r.method === method);
    for (let i = 0; i + 1 < own.length; i += 1) {
      const diff = diffFields(mapMethod(method, own[i + 1]!.payload), mapMethod(method, own[i]!.payload));
      if (diff.length > 0) raw.push({ at: own[i]!.fetched_at, changes: diff });
    }
  }
  raw.sort((a, b) => b.at.getTime() - a.at.getTime());
  const merged: Array<{ at: Date; changes: IFocusFieldChange[] }> = [];
  for (const entry of raw) {
    const last = merged[merged.length - 1];
    if (last && last.at.getTime() - entry.at.getTime() < SAME_REFRESH_MS) last.changes = [...last.changes, ...entry.changes];
    else merged.push({ at: entry.at, changes: entry.changes });
  }
  return merged.map(e => ({ fetchedAt: e.at.toISOString(), changes: e.changes }));
};

export const buildFocusFields = (rows: readonly IRecordRow[]): { fields: IFocusField[]; focusHref: string | null; fetchedAt: Date | null } => {
  const latest = (method: FocusMethod): IRecordRow | undefined => rows.find(r => r.method === method);
  const req = latest('req');
  const egr = latest('egrDetails');
  const fields = orderFields([...(req ? mapMethod('req', req.payload) : []), ...(egr ? mapMethod('egrDetails', egr.payload) : [])]);
  const focusHref = (req && focusHrefOf(req.payload)) ?? (egr && focusHrefOf(egr.payload)) ?? null;
  const times = [req, egr].filter((r): r is IRecordRow => r !== undefined).map(r => r.fetched_at.getTime());
  return { fields, focusHref, fetchedAt: times.length > 0 ? new Date(Math.max(...times)) : null };
};

export const loadCompanyFocus = async (db: DbExecutor, companyId: number): Promise<IFocusView> => {
  const base = {
    configured: focusApiKey() !== null,
    scheduled: env.FOCUS_ENABLED,
    refreshDays: env.FOCUS_REFRESH_DAYS,
    attribution: FOCUS_ATTRIBUTION,
  };
  const empty = { check: null, fetchedAt: null, fields: [], summary: null, focusHref: null, changes: [], coverage: { loaded: 0, truncated: false } };
  const resolved = await companyFocusTarget(db, companyId);
  if (!resolved.ok) return { ...base, ...empty, identifier: null, problem: resolved.problem };
  const { target } = resolved;

  const check = (
    await db.query<ICheckRow>(
      `SELECT outcome, checked_at, next_check_at, attempt_count, last_error FROM focus_checks
       WHERE identifier_type = $1 AND identifier = $2`,
      [target.type, target.value],
    )
  ).rows[0];
  const rows = (
    await db.query<IRecordRow>(
      `SELECT method, payload, fetched_at FROM focus_records WHERE identifier_type = $1 AND identifier = $2
       ORDER BY fetched_at DESC, id DESC LIMIT $3`,
      [target.type, target.value, FOCUS_HISTORY_LIMIT],
    )
  ).rows;

  const { fields, focusHref, fetchedAt } = buildFocusFields(rows);
  return {
    ...base,
    identifier: target,
    problem: null,
    check: check
      ? {
          outcome: check.outcome,
          checkedAt: check.checked_at?.toISOString() ?? null,
          nextCheckAt: check.next_check_at.toISOString(),
          attemptCount: check.attempt_count,
          lastError: check.last_error,
        }
      : null,
    fetchedAt: fetchedAt?.toISOString() ?? null,
    fields,
    summary: fields.length > 0 ? summaryOf(fields) : null,
    focusHref,
    changes: changesOf(rows),
    coverage: { loaded: rows.length, truncated: rows.length === FOCUS_HISTORY_LIMIT },
    attribution: FOCUS_ATTRIBUTION,
  };
};
