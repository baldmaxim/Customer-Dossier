// Сколько у компании объектов и публикаций — одно правило для каталога, поиска и карточки (07.10.2026, «одно сведение —
// один источник»). Раньше каталог считал по семье только текущие роли, поиск брал числа из снимка показателей (на дату
// расчёта и без семьи), плитка — из того же снимка (со снимками реестра среди «публикаций»), а вкладки — живые списки.
//
//  - объект компании — участие (card_participations_v, любое, в том числе прошлое) самой компании или участника её
//    семьи, плюс объект только из событий самой компании (роль не названа) — как вкладка «Объекты» (api/companyObjects.ts);
//  - публикация компании — пост, где она или участник семьи — сторона опубликованного утверждения, плюс живое
//    legacy-упоминание (api/legacyMentions.ts) — как вкладка «Публикации» (api/companyPublications.ts);
//  - семья — общее правило (companies/groupMembership.ts).
//
// Фрагменты — CTE с необязательным фильтром (SQL-выражение массива bigint[]): каталог считает по всей базе, поиск и
// карточка — по своим id. Фильтр стоит внутри MATERIALIZED, снаружи он бы не дошёл.

import { liveMentionSql } from '../api/legacyMentions.js';
import type { DbExecutor } from '../db/pool.js';
import { membershipCtes } from './groupMembership.js';

/** Участия живых объектов: `part_rows (company_id, project_id, role)`. */
export const partRowsCte = (companies?: string): string => `part_rows AS MATERIALIZED (
    SELECT pp.company_id, pp.project_id, pp.role
    FROM card_participations_v pp JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL${companies ? `
    WHERE pp.company_id = ANY(${companies})` : ''}
  )`;

/** Объекты из событий компании: `ev_rows (company_id, project_id)`. */
export const eventRowsCte = (companies?: string): string => `ev_rows AS MATERIALIZED (
    SELECT DISTINCT e.company_id, e.project_id
    FROM card_events_v e JOIN projects p ON p.id = e.project_id AND p.merged_into_id IS NULL
    WHERE e.project_id IS NOT NULL AND e.status <> 'rejected'${companies ? ` AND e.company_id = ANY(${companies})` : ''}
  )`;

/** Публикации, где компания — сторона опубликованного утверждения или живого legacy-упоминания: `touched (company_id, item_id)`. */
export const touchedCte = (companies?: string): string => `touched AS MATERIALIZED (
    SELECT x.company_id, pa.source_item_id AS item_id
    FROM published_assertions_v pa
    CROSS JOIN LATERAL (VALUES (pa.subject_company_id), (pa.object_company_id), (pa.counterparty_company_id)) x(company_id)
    WHERE x.company_id IS NOT NULL${companies ? ` AND x.company_id = ANY(${companies})
      AND (pa.subject_company_id = ANY(${companies}) OR pa.object_company_id = ANY(${companies}) OR pa.counterparty_company_id = ANY(${companies}))` : ''}
    UNION
    SELECT m.entity_id, r.source_item_id
    FROM mentions m JOIN document_revisions r ON r.legacy_document_id = m.document_id
    WHERE m.entity_kind = 'company' AND ${liveMentionSql('m')}${companies ? ` AND m.entity_id = ANY(${companies})` : ''}
  )`;

export interface ICompanyCounters {
  /** Объекты компании и её семьи (как вкладка «Объекты»). */
  objects: number;
  /** Публикации компании и её семьи (как вкладка «Публикации»). */
  publications: number;
  /** Последняя публикация: дата поста, без неё — момент наблюдения. */
  lastPublishedAt: string | null;
}

/** Семья компаний $1 — константой: проверка SQL (sql-sanity) видит запрос целиком. */
const FAMILY_OF_IDS = membershipCtes({ heads: '$1::bigint[]' });

/** Счётчики для набора компаний (поиск): каждая — вместе со своей семьёй. */
const COUNTERS_SQL = `
  WITH ${FAMILY_OF_IDS},
  fam AS MATERIALIZED (
    SELECT id AS head, id AS member FROM unnest($1::bigint[]) id
    UNION
    SELECT head, member FROM mem
  ),
  members AS MATERIALIZED (SELECT array_agg(DISTINCT member) AS ids FROM fam),
  ${partRowsCte('(SELECT ids FROM members)')},
  ${eventRowsCte('$1::bigint[]')},
  ${touchedCte('(SELECT ids FROM members)')},
  fam_objs AS (
    SELECT f.head, pr.project_id FROM fam f JOIN part_rows pr ON pr.company_id = f.member
    UNION
    SELECT er.company_id, er.project_id FROM ev_rows er
  ),
  fam_items AS (
    SELECT DISTINCT f.head, t.item_id FROM fam f JOIN touched t ON t.company_id = f.member
  )
  SELECT id AS "companyId",
         (SELECT count(DISTINCT o.project_id)::int FROM fam_objs o WHERE o.head = id) AS objects,
         (SELECT count(*)::int FROM fam_items i WHERE i.head = id) AS publications,
         (SELECT max(coalesce(si.published_at, si.first_observed_at)) FROM fam_items i JOIN source_items si ON si.id = i.item_id
           WHERE i.head = id) AS "lastAt"
  FROM unnest($1::bigint[]) id`;

/** Объекты и публикации компаний ids (каждая со своей семьёй) — тем же правилом, что каталог и вкладки карточки. */
export const loadCompanyCounters = async (exec: DbExecutor, ids: readonly number[]): Promise<Map<number, ICompanyCounters>> => {
  if (ids.length === 0) return new Map();
  const rows = (await exec.query<{ companyId: number; objects: number; publications: number; lastAt: Date | null }>(COUNTERS_SQL, [[...ids]])).rows;
  return new Map(rows.map(r => [r.companyId, { objects: r.objects, publications: r.publications, lastPublishedAt: r.lastAt?.toISOString() ?? null }]));
};
