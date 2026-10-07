// По какому реквизиту компания спрашивается у Контур.Фокуса и чья очередь по расписанию.
//
// Только реквизиты с верной контрольной суммой из реестра entity_identifiers (ADR-005). ИНН главнее
// ОГРН; два разных ИНН у одной карточки — это вопрос опознания, а не повод платить за оба: такая
// компания не спрашивается, экран говорит почему. Одна и та же пара реквизита у двух карточек
// (дубль до слияния) — один запрос.

import { IDS_CTE } from '../companies/identity.js';
import type { DbExecutor } from '../db/pool.js';
import type { IFocusIdentifier } from './client.js';

export type FocusTargetProblem = 'no_identifier' | 'several_identifiers';

export type CompanyFocusTarget = { ok: true; target: IFocusIdentifier } | { ok: false; problem: FocusTargetProblem };

export const pickTarget = (rows: ReadonlyArray<{ type: string; value: string }>): CompanyFocusTarget => {
  const inns = [...new Set(rows.filter(r => r.type === 'inn').map(r => r.value))];
  if (inns.length === 1) return { ok: true, target: { type: 'inn', value: inns[0]! } };
  if (inns.length > 1) return { ok: false, problem: 'several_identifiers' };
  const ogrns = [...new Set(rows.filter(r => r.type === 'ogrn' || r.type === 'ogrnip').map(r => r.value))];
  if (ogrns.length === 1) return { ok: true, target: { type: 'ogrn', value: ogrns[0]! } };
  return { ok: false, problem: ogrns.length > 1 ? 'several_identifiers' : 'no_identifier' };
};

export const companyFocusTarget = async (db: DbExecutor, companyId: number): Promise<CompanyFocusTarget> => {
  const rows = (
    await db.query<{ type: string; value: string }>(
      `SELECT identifier_type AS type, value FROM entity_identifiers
       WHERE company_id = $1 AND status = 'active' AND validation_status = 'checksum_valid'
         AND identifier_type IN ('inn', 'ogrn', 'ogrnip')`,
      [companyId],
    )
  ).rows;
  return pickTarget(rows);
};

/** Реквизит каждой живой компании — то же правило, что pickTarget, одним запросом (общий CTE companies/identity.ts). */
const TARGETS_SQL = `${IDS_CTE.trim()},
  targets AS (
    SELECT company_id, target_type AS kind, target_value AS value FROM ids
  )`;

/**
 * Роли — тем же способом, что очередь ДОМ.РФ: MATERIALIZED, иначе планировщик пересчитывает
 * card_participations_v на каждую компанию (01.10.2026 взятие из очереди падало по таймауту).
 */
const ROLES_SQL = `roles AS MATERIALIZED (
  SELECT company_id, array_agg(DISTINCT role ORDER BY role) AS roles FROM card_participations_v WHERE is_current GROUP BY company_id
)`;

/**
 * Чья очередь: срок проверки пришёл или не спрашивали никогда. Компании «на контроле» (ADR-016) — первыми,
 * затем заказчики и застройщики (портал про то, «как дела у Заказчика»), среди них — ни разу не спрошенные,
 * затем самые давние.
 */
export const dueFocusTargets = async (db: DbExecutor, limit: number): Promise<IFocusIdentifier[]> => {
  const rows = (
    await db.query<{ kind: 'inn' | 'ogrn'; value: string }>(
      `WITH ${TARGETS_SQL}, ${ROLES_SQL}
       SELECT t.kind, t.value
       FROM targets t
       LEFT JOIN roles r ON r.company_id = t.company_id
       LEFT JOIN company_watch w ON w.company_id = t.company_id AND w.removed_at IS NULL
       LEFT JOIN focus_checks f ON f.identifier_type = t.kind AND f.identifier = t.value
       WHERE t.kind IS NOT NULL AND (f.id IS NULL OR f.next_check_at <= now())
       GROUP BY t.kind, t.value
       ORDER BY bool_or(w.id IS NOT NULL) DESC,
                bool_or(coalesce(r.roles && ARRAY['customer', 'developer'], false)) DESC,
                (min(f.next_check_at) IS NULL) DESC, min(f.next_check_at), t.value
       LIMIT $1`,
      [limit],
    )
  ).rows;
  return rows.map(r => ({ type: r.kind, value: r.value }));
};

export interface IFocusCoverage {
  /** Компании, которые можно спросить: один реквизит с верной контрольной суммой. */
  companies: number;
  /** Разные реквизиты среди них — столько запросов на круг обновления (по два метода). */
  identifiers: number;
  found: number;
  notFound: number;
  /** Ждут запроса: срок пришёл или не спрашивали. */
  due: number;
  /** Последняя попытка не удалась, ждут повтора. */
  failing: number;
}

export const focusCoverage = async (db: DbExecutor): Promise<IFocusCoverage> => {
  const row = (
    await db.query<IFocusCoverage>(
      `WITH ${TARGETS_SQL},
       distinct_targets AS (SELECT DISTINCT kind, value FROM targets WHERE kind IS NOT NULL)
       SELECT (SELECT count(*) FROM targets WHERE kind IS NOT NULL)::int AS companies,
              count(*)::int AS identifiers,
              count(*) FILTER (WHERE f.outcome = 'found')::int AS found,
              count(*) FILTER (WHERE f.outcome = 'not_found')::int AS "notFound",
              count(*) FILTER (WHERE f.id IS NULL OR f.next_check_at <= now())::int AS due,
              count(*) FILTER (WHERE f.attempt_count > 0)::int AS failing
       FROM distinct_targets d
       LEFT JOIN focus_checks f ON f.identifier_type = d.kind AND f.identifier = d.value`,
    )
  ).rows[0];
  return row ?? { companies: 0, identifiers: 0, found: 0, notFound: 0, due: 0, failing: 0 };
};
