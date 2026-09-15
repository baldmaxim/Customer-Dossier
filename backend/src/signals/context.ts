// Текущий контекст выбранного объекта для компании: её участие (роль, корпус, пакет, период) и события
// объекта с пометкой пересечения периодов. Пересечение — контекст, а не причинность; событие объекта
// не приписывается участнику, а участник, пришедший позже, не наследует прежние события.

import type { DbExecutor } from '../db/pool.js';
import { overlap, type Overlap } from './intervals.js';
import { reviewLevel } from './rules.js';
import { SIGNAL_RULES_VERSION, type ReviewLevel } from './types.js';

interface IRow {
  id: number;
  predicate: string;
  role: string | null;
  eventType: string | null;
  status: string;
  origin: string;
  polarity: string;
  modality: string;
  subjectCompanyId: number | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
}

export interface IProjectContext {
  rulesVersion: string;
  cutoff: string;
  companyId: number;
  projectId: number;
  participations: Array<{
    assertionId: number;
    role: string | null;
    building: string | null;
    workPackage: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    modality: string;
    polarity: string;
    review: ReviewLevel;
    counted: boolean;
  }>;
  projectEvents: Array<{
    assertionId: number;
    type: string | null;
    building: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    review: ReviewLevel;
    /** Пересечение с учтёнными периодами участия компании. */
    overlap: Overlap;
    /** true — тот же корпус, false — разные корпуса, null — корпус не указан у одной из сторон. */
    sameBuilding: boolean | null;
    namesCompany: boolean;
  }>;
  currentState: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>;
  note: string;
}

const COLUMNS = `a.id, a.predicate, a.role, a.event_type AS "eventType", a.status::text AS status, a.origin, a.polarity,
  a.modality::text AS modality, a.subject_company_id AS "subjectCompanyId", a.scope_building AS "scopeBuilding",
  a.work_package AS "workPackage", a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo",
  a.period_precision AS "periodPrecision"`;

const ACTIVE = `EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports' AND e.created_at <= $3)`;

const combine = (values: Overlap[]): Overlap =>
  values.includes('overlaps') ? 'overlaps' : values.length > 0 && values.every(v => v === 'no_overlap') ? 'no_overlap' : 'unknown';

export const loadProjectContext = async (exec: DbExecutor, companyId: number, projectId: number, cutoff: Date): Promise<IProjectContext> => {
  const participations = (
    await exec.query<IRow>(
      `SELECT ${COLUMNS} FROM assertions a
       WHERE a.predicate = 'participates_in_project' AND a.subject_company_id = $1 AND a.object_project_id = $2
         AND a.created_at <= $3 AND ${ACTIVE}
       ORDER BY a.valid_from NULLS FIRST, a.id`,
      [companyId, projectId, cutoff],
    )
  ).rows;
  const events = (
    await exec.query<IRow>(
      `SELECT ${COLUMNS} FROM assertions a
       WHERE a.predicate = 'event' AND $2 IN (a.object_project_id, a.subject_project_id)
         AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'claim', 'unknown')
         AND a.created_at <= $3 AND ${ACTIVE} AND $1::bigint IS NOT NULL
       ORDER BY a.valid_from NULLS FIRST, a.id`,
      [companyId, projectId, cutoff],
    )
  ).rows;
  const state = (
    await exec.query<{ scope_building: string | null; state: string; valid_from: string; period_precision: string }>(
      `SELECT scope_building, state, valid_from::text, period_precision FROM project_current_state_v WHERE project_id = $1 ORDER BY coalesce(scope_building, '')`,
      [projectId],
    )
  ).rows;

  const counted = participations.filter(p => p.polarity === 'positive' && ['reported_fact', 'unknown'].includes(p.modality) && p.status !== 'rejected');

  return {
    rulesVersion: SIGNAL_RULES_VERSION,
    cutoff: cutoff.toISOString(),
    companyId,
    projectId,
    participations: participations.map(p => ({
      assertionId: p.id,
      role: p.role,
      building: p.scopeBuilding,
      workPackage: p.workPackage,
      validFrom: p.validFrom,
      validTo: p.validTo,
      periodPrecision: p.periodPrecision,
      modality: p.modality,
      polarity: p.polarity,
      review: reviewLevel(p),
      counted: counted.includes(p),
    })),
    projectEvents: events.map(e => {
      const buildings = counted.map(p => (p.scopeBuilding && e.scopeBuilding ? p.scopeBuilding === e.scopeBuilding : null));
      return {
        assertionId: e.id,
        type: e.eventType,
        building: e.scopeBuilding,
        validFrom: e.validFrom,
        validTo: e.validTo,
        periodPrecision: e.periodPrecision,
        review: reviewLevel(e),
        overlap: combine(counted.map(p => overlap(p, e))),
        sameBuilding: buildings.includes(true) ? true : buildings.length > 0 && buildings.every(b => b === false) ? false : null,
        namesCompany: e.subjectCompanyId === companyId,
      };
    }),
    currentState: state.map(s => ({ building: s.scope_building, state: s.state, validFrom: s.valid_from, periodPrecision: s.period_precision })),
    note: 'События объекта — контекст участия, а не вина участника. Пересечение периодов не доказывает причинность.',
  };
};
