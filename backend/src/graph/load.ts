// Загрузка узлов и рёбер схемы из PostgreSQL (без отдельной графовой базы). Только чтение.

import type { DbExecutor } from '../db/pool.js';
import type { GraphEdgeType, IGraphEdge, IGraphLoader, IGraphNode, NodeKey } from './graph.js';

const split = (keys: readonly NodeKey[]): { companies: number[]; projects: number[] } => ({
  companies: keys.filter(k => k.startsWith('c:')).map(k => Number(k.slice(2))),
  projects: keys.filter(k => k.startsWith('p:')).map(k => Number(k.slice(2))),
});

interface IAssertionEdgeRow {
  id: number;
  predicate: string;
  role: string | null;
  status: string;
  polarity: string;
  modality: string;
  subjectCompanyId: number;
  objectCompanyId: number | null;
  objectProjectId: number | null;
  contextProjectId: number | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  supports: number;
  contradicts: number;
}

export const graphLoader = (exec: DbExecutor): IGraphLoader => ({
  nodes: async keys => {
    const { companies, projects } = split(keys);
    const companyRows = (
      await exec.query<{ id: number; name: string; entityType: string; legalForm: string | null; identifiers: string[] }>(
        `SELECT c.id, c.name, c.entity_type AS "entityType", c.legal_form AS "legalForm",
                coalesce((SELECT array_agg(i.identifier_type || ' ' || i.value ORDER BY i.id) FROM entity_identifiers i
                          WHERE i.company_id = c.id AND i.status = 'active'), '{}') AS identifiers
         FROM companies c WHERE c.id = ANY($1::bigint[]) AND c.merged_into_id IS NULL`,
        [companies],
      )
    ).rows;
    const projectRows = (
      await exec.query<{ id: number; name: string; level: string; levelLabel: string | null; city: string | null }>(
        `SELECT id, name, project_level AS level, level_label AS "levelLabel", city
         FROM projects WHERE id = ANY($1::bigint[]) AND merged_into_id IS NULL`,
        [projects],
      )
    ).rows;
    const nodes: IGraphNode[] = [
      ...companyRows.map(c => ({
        key: `c:${c.id}` as NodeKey,
        kind: 'company' as const,
        id: c.id,
        label: c.name,
        subtype: c.entityType,
        details: [c.legalForm, ...c.identifiers].filter((d): d is string => Boolean(d)),
        depth: 0,
        seed: false,
      })),
      ...projectRows.map(p => ({
        key: `p:${p.id}` as NodeKey,
        kind: 'project' as const,
        id: p.id,
        label: p.name,
        subtype: p.level,
        details: [p.levelLabel, p.city].filter((d): d is string => Boolean(d)),
        depth: 0,
        seed: false,
      })),
    ];
    return nodes;
  },

  edges: async (keys, types) => {
    const { companies, projects } = split(keys);
    const edges: IGraphEdge[] = [];
    const predicates = [
      ...(types.includes('participation') ? ['participates_in_project'] : []),
      ...(types.includes('contract') ? ['contract'] : []),
      ...(types.includes('corporate') ? ['corporate_relation'] : []),
    ];
    if (predicates.length > 0) {
      const rows = (
        await exec.query<IAssertionEdgeRow>(
          `SELECT a.id, a.predicate, a.role, a.status::text AS status, a.polarity, a.modality::text AS modality,
                  a.subject_company_id AS "subjectCompanyId", a.object_company_id AS "objectCompanyId",
                  a.object_project_id AS "objectProjectId", a.context_project_id AS "contextProjectId",
                  a.scope_building AS "scopeBuilding", a.work_package AS "workPackage", a.work_package_label AS "workPackageLabel",
                  a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo", a.period_precision AS "periodPrecision",
                  (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports') AS supports,
                  (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'contradicts') AS contradicts
           FROM assertions a
           JOIN companies sc ON sc.id = a.subject_company_id AND sc.merged_into_id IS NULL
           WHERE a.predicate = ANY($3::text[])
             AND (a.subject_company_id = ANY($1::bigint[]) OR a.object_company_id = ANY($1::bigint[])
                  OR a.object_project_id = ANY($2::bigint[]) OR a.context_project_id = ANY($2::bigint[]))
             AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')
           ORDER BY a.id
           LIMIT 2000`,
          [companies, projects, predicates],
        )
      ).rows;
      for (const r of rows) {
        const type: GraphEdgeType = r.predicate === 'participates_in_project' ? 'participation' : r.predicate === 'contract' ? 'contract' : 'corporate';
        const to: NodeKey | null = type === 'participation' ? (r.objectProjectId ? `p:${r.objectProjectId}` : null) : r.objectCompanyId ? `c:${r.objectCompanyId}` : null;
        if (!to) continue;
        edges.push({
          key: `a:${r.id}`,
          type,
          from: `c:${r.subjectCompanyId}`,
          to,
          assertionId: r.id,
          role: r.role,
          building: r.scopeBuilding,
          workPackage: r.workPackage ?? r.workPackageLabel,
          validFrom: r.validFrom,
          validTo: r.validTo,
          periodPrecision: r.periodPrecision,
          status: r.status,
          polarity: r.polarity,
          modality: r.modality,
          supports: r.supports,
          contradicts: r.contradicts,
          contextProjectId: r.contextProjectId,
          details: [],
        });
      }
    }

    if (types.includes('hierarchy') && projects.length > 0) {
      const rows = (
        await exec.query<{ id: number; parentId: number }>(
          `SELECT id, parent_project_id AS "parentId" FROM projects
           WHERE parent_project_id IS NOT NULL AND merged_into_id IS NULL
             AND (id = ANY($1::bigint[]) OR parent_project_id = ANY($1::bigint[]))`,
          [projects],
        )
      ).rows;
      for (const r of rows) {
        edges.push({
          key: `h:${r.id}`,
          type: 'hierarchy',
          from: `p:${r.id}`,
          to: `p:${r.parentId}`,
          assertionId: null,
          role: null,
          building: null,
          workPackage: null,
          validFrom: null,
          validTo: null,
          periodPrecision: 'unknown',
          status: 'structure',
          polarity: 'positive',
          modality: 'unknown',
          supports: 0,
          contradicts: 0,
          contextProjectId: null,
          details: ['входит в объект'],
        });
      }
    }

    if (types.includes('co_mentioned') && companies.length > 0) {
      const rows = (
        await exec.query<{ a: number; b: number; revisions: number[] }>(
          `SELECT least(x.subject_company_id, y.subject_company_id) AS a, greatest(x.subject_company_id, y.subject_company_id) AS b,
                  array_agg(DISTINCT ex.revision_id ORDER BY ex.revision_id) AS revisions
           FROM assertions x
           JOIN evidence ex ON ex.assertion_id = x.id AND ex.status = 'active'
           JOIN evidence ey ON ey.revision_id = ex.revision_id AND ey.status = 'active'
           JOIN assertions y ON y.id = ey.assertion_id AND y.predicate = 'company_mentioned' AND y.subject_company_id <> x.subject_company_id
           WHERE x.predicate = 'company_mentioned' AND x.subject_company_id = ANY($1::bigint[])
           GROUP BY 1, 2
           LIMIT 500`,
          [companies],
        )
      ).rows;
      for (const r of rows) {
        edges.push({
          key: `m:${r.a}:${r.b}`,
          type: 'co_mentioned',
          from: `c:${r.a}`,
          to: `c:${r.b}`,
          assertionId: null,
          role: null,
          building: null,
          workPackage: null,
          validFrom: null,
          validTo: null,
          periodPrecision: 'unknown',
          status: 'mention',
          polarity: 'positive',
          modality: 'unknown',
          supports: r.revisions.length,
          contradicts: 0,
          contextProjectId: null,
          details: [`упомянуты вместе в редакциях: ${r.revisions.map(id => `#${id}`).join(', ')}`],
        });
      }
    }
    return edges;
  },
});
