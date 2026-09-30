// «С кем работает»: контрагенты компании одним компактным списком.
//
// В списке только связи между организациями с прямым утверждением:
//   contract         — прямой договор: обе стороны названы в одном предложении;
//   corporate        — корпоративная связь (доля, контроль, группа, бренд);
// Совместное участие видно в списке объектов, но не делает фирмы контрагентами.
//
// Схема связей (graph/*) отвечает на тот же вопрос обходом в глубину; здесь —
// только соседи первого шага, чтобы карточка отвечала «кто рядом» без схемы.

import { query } from '../db/pool.js';

export type PartnerKind = 'contract' | 'corporate';

export interface IPartnerLink {
  kind: PartnerKind;
  /** Роль контрагента; у договора — вид договора, у корпоративной связи — вид связи. */
  role: string | null;
  /** Роль самой компании в той же связи. */
  ownRole: string | null;
  projectId: number | null;
  projectName: string | null;
  /** Утверждение-основание прямой связи. */
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

interface IDirectRow extends IPartnerLink {
  companyId: number | null;
}

export const loadCompanyPartners = async (companyId: number, limit: number): Promise<IPartnerRow[]> => {
  const direct = await query<IDirectRow>(DIRECT_SQL, [companyId]);

  const byCompany = new Map<number, IPartnerLink[]>();
  const push = (id: number | null, link: IPartnerLink): void => {
    if (id === null || id === companyId) return;
    byCompany.set(id, [...(byCompany.get(id) ?? []), link]);
  };

  for (const row of direct) {
    const { companyId: other, ...link } = row;
    push(other, link);
  }
  if (byCompany.size === 0) return [];

  const names = await query<{ id: number; name: string; city: string | null }>(
    `SELECT id, name, city FROM companies WHERE id = ANY($1::bigint[]) AND merged_into_id IS NULL`,
    [[...byCompany.keys()]],
  );

  const weight = (links: IPartnerLink[]): number => links.filter(l => l.kind === 'contract').length;
  return names
    .map(c => ({ companyId: c.id, name: c.name, city: c.city, links: byCompany.get(c.id) ?? [] }))
    .sort((a, b) => weight(b.links) - weight(a.links) || b.links.length - a.links.length || a.name.localeCompare(b.name))
    .slice(0, limit);
};
