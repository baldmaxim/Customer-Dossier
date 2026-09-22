// «С кем работает»: контрагенты компании одним компактным списком.
//
// Три разных основания не смешиваются в одно «связана с» (ADR-008):
//   contract         — прямой договор: обе стороны названы в одном предложении;
//   corporate        — корпоративная связь (доля, контроль, группа, бренд);
//   co_participation — обе компании работают на одном объекте. Это НЕ договор
//                      и не доказательство отношений между ними: заказчик и
//                      субподрядчик могут не знать друг о друге.
//
// Схема связей (graph/*) отвечает на тот же вопрос обходом в глубину; здесь —
// только соседи первого шага, чтобы карточка отвечала «кто рядом» без схемы.

import { query } from '../db/pool.js';

export type PartnerKind = 'contract' | 'corporate' | 'co_participation';

export interface IPartnerLink {
  kind: PartnerKind;
  /** Роль контрагента; у договора — вид договора, у корпоративной связи — вид связи. */
  role: string | null;
  /** Роль самой компании в той же связи. */
  ownRole: string | null;
  projectId: number | null;
  projectName: string | null;
  /** Утверждение-основание. У совместного участия основания нет — это производная. */
  assertionId: number | null;
  modality: string | null;
  status: string | null;
}

export interface IPartnerRow {
  companyId: number;
  name: string;
  city: string | null;
  links: IPartnerLink[];
}

/**
 * Договоры и корпоративные связи. Только положительные и только состоявшееся или
 * заявленное: план и слух контрагентом не делают.
 */
const DIRECT_SQL = `
  SELECT CASE WHEN pa.predicate = 'contract' THEN 'contract' ELSE 'corporate' END AS kind,
         CASE WHEN pa.subject_company_id = $1::bigint THEN pa.object_company_id
              ELSE pa.subject_company_id END AS "companyId",
         CASE WHEN pa.subject_company_id = $1::bigint THEN pa.counterparty_role ELSE pa.role END AS role,
         CASE WHEN pa.subject_company_id = $1::bigint THEN pa.role ELSE pa.counterparty_role END AS "ownRole",
         coalesce(pa.object_project_id, pa.context_project_id) AS "projectId",
         p.name AS "projectName",
         pa.id AS "assertionId",
         pa.modality::text AS modality,
         pa.status::text AS status
  FROM published_assertions_distinct_v pa
  LEFT JOIN projects p ON p.id = coalesce(pa.object_project_id, pa.context_project_id)
  WHERE pa.predicate IN ('contract', 'corporate_relation')
    AND pa.polarity = 'positive'
    AND pa.modality IN ('reported_fact', 'claim', 'unknown')
    AND (pa.subject_company_id = $1::bigint OR pa.object_company_id = $1::bigint)
    AND pa.subject_company_id IS NOT NULL AND pa.object_company_id IS NOT NULL
    AND pa.subject_company_id <> pa.object_company_id`;

/** Совместное участие на объекте: производная проекция, своего утверждения у неё нет. */
const CO_SQL = `
  SELECT cp.company_b_id AS "companyId", cp.role_b AS role, cp.role_a AS "ownRole",
         cp.project_id AS "projectId", p.name AS "projectName"
  FROM co_participations_v cp
  JOIN projects p ON p.id = cp.project_id
  WHERE cp.company_a_id = $1::bigint
  UNION ALL
  SELECT cp.company_a_id, cp.role_a, cp.role_b, cp.project_id, p.name
  FROM co_participations_v cp
  JOIN projects p ON p.id = cp.project_id
  WHERE cp.company_b_id = $1::bigint`;

interface IDirectRow extends IPartnerLink {
  companyId: number | null;
}

interface ICoRow {
  companyId: number;
  role: string | null;
  ownRole: string | null;
  projectId: number;
  projectName: string;
}

export const loadCompanyPartners = async (companyId: number, limit: number): Promise<IPartnerRow[]> => {
  const [direct, co] = await Promise.all([
    query<IDirectRow>(DIRECT_SQL, [companyId]),
    query<ICoRow>(CO_SQL, [companyId]),
  ]);

  const byCompany = new Map<number, IPartnerLink[]>();
  const push = (id: number | null, link: IPartnerLink): void => {
    if (id === null || id === companyId) return;
    byCompany.set(id, [...(byCompany.get(id) ?? []), link]);
  };

  for (const row of direct) {
    const { companyId: other, ...link } = row;
    push(other, link);
  }
  for (const row of co) {
    push(row.companyId, {
      kind: 'co_participation',
      role: row.role,
      ownRole: row.ownRole,
      projectId: row.projectId,
      projectName: row.projectName,
      assertionId: null,
      modality: null,
      status: null,
    });
  }
  if (byCompany.size === 0) return [];

  const names = await query<{ id: number; name: string; city: string | null }>(
    `SELECT id, name, city FROM companies WHERE id = ANY($1::bigint[]) AND merged_into_id IS NULL`,
    [[...byCompany.keys()]],
  );

  // Договор весомее совместного участия, поэтому сортируем по числу прямых оснований,
  // а не по общему числу строк: десять объектов рядом не делают контрагента ближе.
  const weight = (links: IPartnerLink[]): number => links.filter(l => l.kind !== 'co_participation').length;
  return names
    .map(c => ({ companyId: c.id, name: c.name, city: c.city, links: byCompany.get(c.id) ?? [] }))
    .sort((a, b) => weight(b.links) - weight(a.links) || b.links.length - a.links.length || a.name.localeCompare(b.name))
    .slice(0, limit);
};
