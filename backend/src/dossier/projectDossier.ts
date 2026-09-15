// Досье объекта (этап 08A): иерархия, состояние с датой, участники в выбранный период с ролью и работами,
// документированные договоры отдельно от совместного участия, события объекта. Только чтение.

import type { DbExecutor } from '../db/pool.js';
import { overlap, type Overlap } from '../signals/intervals.js';
import { loadProjectFacts, type IFact } from './facts.js';
import { loadProjectState } from './load.js';
import { dateText, eventText, factStatement, roleText, type IStatement } from './statements.js';

export interface IProjectDossier {
  project: {
    id: number;
    name: string;
    kind: string;
    city: string | null;
    level: string;
    levelLabel: string | null;
    parent: { id: number; name: string } | null;
    children: Array<{ id: number; name: string; level: string; levelLabel: string | null }>;
    mergedIntoId: number | null;
  };
  period: { from: string | null; to: string | null };
  state: {
    current: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>;
    history: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string; assertionId: number }>;
  };
  participants: Array<{
    companyId: number;
    companyName: string;
    role: string | null;
    building: string | null;
    workPackage: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    inPeriod: Overlap | 'no_period_selected';
    statement: IStatement;
  }>;
  notCounted: IStatement[];
  contracts: IStatement[];
  coParticipationNote: string;
  events: IStatement[];
  cases: Array<{ id: number; title: string; status: string }>;
}

const FACT = new Set(['reported_fact', 'unknown']);

export const loadProjectDossier = async (
  exec: DbExecutor,
  projectId: number,
  period: { from: string | null; to: string | null },
): Promise<IProjectDossier | null> => {
  const project = (
    await exec.query<{ id: number; name: string; kind: string; city: string | null; level: string; levelLabel: string | null; parentId: number | null; parentName: string | null; mergedIntoId: number | null }>(
      `SELECT p.id, p.name, p.kind, p.city, p.project_level AS level, p.level_label AS "levelLabel",
              p.parent_project_id AS "parentId", pp.name AS "parentName", p.merged_into_id AS "mergedIntoId"
       FROM projects p LEFT JOIN projects pp ON pp.id = p.parent_project_id WHERE p.id = $1`,
      [projectId],
    )
  ).rows[0];
  if (!project) return null;

  const children = (
    await exec.query<{ id: number; name: string; level: string; levelLabel: string | null }>(
      `SELECT id, name, project_level AS level, level_label AS "levelLabel" FROM projects
       WHERE parent_project_id = $1 AND merged_into_id IS NULL ORDER BY project_level, level_label, id`,
      [projectId],
    )
  ).rows;
  const history = (
    await exec.query<{ building: string | null; state: string; validFrom: string; periodPrecision: string; assertionId: number }>(
      `SELECT scope_building AS building, state, valid_from::text AS "validFrom", period_precision AS "periodPrecision", assertion_id AS "assertionId"
       FROM project_state_history_v WHERE project_id = $1 ORDER BY coalesce(scope_building, ''), valid_from, recorded_at`,
      [projectId],
    )
  ).rows;
  const facts = await loadProjectFacts(exec, projectId);
  const cases = (
    await exec.query<{ id: number; title: string; status: string }>(
      'SELECT id, title, status FROM dossier_cases WHERE project_id = $1 ORDER BY id DESC LIMIT 50',
      [projectId],
    )
  ).rows;

  const hasPeriod = period.from !== null || period.to !== null;
  const window = { validFrom: period.from ?? '0001-01-01', validTo: period.to ?? '9999-12-31' };
  const participation = facts.filter(f => f.predicate === 'participates_in_project' && f.objectProjectId === projectId && f.subjectCompanyId !== null);
  const counted = (f: IFact): boolean => f.polarity === 'positive' && FACT.has(f.modality) && f.status !== 'rejected';

  return {
    project: {
      id: project.id,
      name: project.name,
      kind: project.kind,
      city: project.city,
      level: project.level,
      levelLabel: project.levelLabel,
      parent: project.parentId !== null ? { id: project.parentId, name: project.parentName ?? `#${project.parentId}` } : null,
      children,
      mergedIntoId: project.mergedIntoId,
    },
    period,
    state: { current: await loadProjectState(exec, projectId), history },
    participants: participation.filter(counted).map(f => ({
      companyId: f.subjectCompanyId!,
      companyName: f.subjectCompanyName ?? `#${f.subjectCompanyId}`,
      role: f.role,
      building: f.scopeBuilding,
      workPackage: f.workPackage ?? f.workPackageLabel,
      validFrom: f.validFrom,
      validTo: f.validTo,
      periodPrecision: f.periodPrecision,
      // Период участия против выбранного периода: пересечение, нет, или неизвестно (дат участия нет).
      inPeriod: hasPeriod ? overlap(f, window) : 'no_period_selected',
      statement: factStatement(
        'participant',
        f,
        `${f.subjectCompanyName} — ${roleText(f.role)}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}${f.workPackage ?? f.workPackageLabel ? `; работы: ${f.workPackage ?? f.workPackageLabel}` : ''}${f.validFrom ? `; с ${dateText(f.validFrom, f.periodPrecision)}` : '; период не указан'}`,
      ),
    })),
    notCounted: participation
      .filter(f => !counted(f))
      .map(f =>
        factStatement(
          'participant_not_counted',
          f,
          `${f.subjectCompanyName}: ${f.polarity === 'negative' ? `не ${roleText(f.role)}` : `${roleText(f.role)} (${f.modality === 'planned' ? 'план' : f.modality === 'possible' ? 'возможно, не подтверждено' : f.modality === 'claim' ? 'заявление' : f.status})`}`,
        ),
      ),
    contracts: facts
      .filter(f => f.predicate === 'contract' && f.contextProjectId === projectId)
      .map(f => factStatement('contract', f, `${f.subjectCompanyName} → ${f.objectCompanyName}: ${roleText(f.role)}${f.modality === 'planned' ? ' (план)' : ''}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}`)),
    coParticipationNote: 'Совместное участие компаний на объекте не означает договора между ними: договоры показаны отдельно и только при прямом основании.',
    events: facts
      .filter(f => f.predicate === 'event' && f.polarity === 'positive' && ['reported_fact', 'claim', 'unknown'].includes(f.modality))
      .map(f => factStatement('project_event', f, `${eventText(f.eventType)}${f.scopeBuilding ? `, ${f.scopeBuilding}` : ''}; ${dateText(f.validFrom, f.periodPrecision)}${f.subjectCompanyName ? `; названа компания ${f.subjectCompanyName}` : ''}`)),
    cases,
  };
};
