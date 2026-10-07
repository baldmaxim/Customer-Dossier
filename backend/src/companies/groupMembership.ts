// Кто входит в группу — одно правило для всего портала (07.10.2026, «одно сведение — один источник»).
//
// Раньше правило жило в семи копиях с разными условиями: каталог учитывал страницу группы ДОМ.РФ, а вкладка «Объекты»,
// «Кто строит», «Сроки и продажи» и сайты — нет; поиск и паспорт объекта не проверяли модальность и «опубликовано»;
// «Новое» семьи не знало вовсе. Каталог клал СЗ внутрь группы, а карточка группы его объектов не показывала.
//
// Пара (участник, группа):
//  1. утверждение corporate_relation / member_of_group — положительное, не отклонено, модальность reported_fact / claim /
//     unknown; из реестра — с действующим подтверждающим доказательством, из конвейера — опубликованное;
//  2. СЗ, чья страница группы на ДОМ.РФ подтверждена как компания портала, и такая компания у страницы одна
//     (ADR-012 п. 33: группа — по подтверждённой странице, не по названию);
//  3. связь, подтверждённая оператором (company_relations, member_of_group, confirmed — POST /api/entities/relations).
//
// Фрагмент — CTE `reg_dev`, `group_heads`, `mem (member, head)`; фильтр по участникам или группам ставится внутрь
// обеих ветвей (MATERIALIZED не пропускает условие снаружи). Без DISTINCT ON над видами card_*/published_* и без оконных
// функций (урок миграции 047): DISTINCT ON здесь — по registry_records одной компании, а не по видам.

import type { DbExecutor } from '../db/pool.js';

/** Утверждение «входит в группу», которое портал считает действующим. */
const MEMBER_OF_GROUP = `a.predicate = 'corporate_relation' AND a.role = 'member_of_group' AND a.subject_company_id <> a.object_company_id
      AND a.status <> 'rejected' AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'claim', 'unknown')
      AND ((a.origin = 'registry' AND EXISTS (
              SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'))
        OR EXISTS (SELECT 1 FROM published_assertions_v pa WHERE pa.id = a.id))`;

/** Подтверждённые страницы групп ДОМ.РФ у компаний heads (массив bigint[]). */
const headRefs = (heads: string): string => `(SELECT l2.external_ref FROM domrf_company_links l2 JOIN companies c2 ON c2.id = l2.company_id
          WHERE l2.kind = 'group' AND l2.state = 'confirmed' AND coalesce(c2.merged_into_id, c2.id) = ANY(${heads}))`;

/**
 * CTE семьи. members / heads — SQL-выражения массива bigint[] (например `'$1::bigint[]'`): только пары этих участников
 * или этих групп. Без фильтра — вся семья (каталог).
 */
export const membershipCtes = (filter: { members?: string; heads?: string } = {}): string => {
  const { members, heads } = filter;
  return `
  reg_dev AS MATERIALIZED (
    SELECT DISTINCT ON (r.company_id) r.company_id, d.group_ref,
           coalesce(d.group_name, r.payload->'identity'->>'groupName') AS group_name
    FROM registry_records r
    JOIN domrf_cards d ON d.kind = 'developer' AND d.external_ref = r.external_ref
    JOIN companies c ON c.id = r.company_id AND c.merged_into_id IS NULL
    WHERE r.record_type = 'developer'${members ? ` AND r.company_id = ANY(${members})` : ''}${heads ? ` AND d.group_ref IN ${headRefs(heads)}` : ''}
    ORDER BY r.company_id, r.fetched_at DESC
  ),
  group_heads AS MATERIALIZED (
    SELECT l.external_ref AS group_ref, min(coalesce(c.merged_into_id, c.id)) AS head,
           count(DISTINCT coalesce(c.merged_into_id, c.id)) AS n
    FROM domrf_company_links l JOIN companies c ON c.id = l.company_id
    WHERE l.kind = 'group' AND l.state = 'confirmed'${members ? ' AND l.external_ref IN (SELECT group_ref FROM reg_dev)' : ''}${heads ? ` AND l.external_ref IN ${headRefs(heads)}` : ''}
    GROUP BY l.external_ref
  ),
  mem AS MATERIALIZED (
    SELECT a.subject_company_id AS member, a.object_company_id AS head
    FROM assertions a
    WHERE ${MEMBER_OF_GROUP}${members ? ` AND a.subject_company_id = ANY(${members})` : ''}${heads ? ` AND a.object_company_id = ANY(${heads})` : ''}
    UNION
    SELECT rd.company_id, gh.head FROM reg_dev rd JOIN group_heads gh ON gh.group_ref = rd.group_ref AND gh.n = 1
    WHERE rd.company_id <> gh.head${heads ? ` AND gh.head = ANY(${heads})` : ''}
    UNION
    SELECT r.from_company_id, r.to_company_id FROM company_relations r
    WHERE r.relation_type = 'member_of_group' AND r.status = 'confirmed' AND r.from_company_id <> r.to_company_id${members ? ` AND r.from_company_id = ANY(${members})` : ''}${heads ? ` AND r.to_company_id = ANY(${heads})` : ''}
  )`;
};

/** Фрагменты с фильтром параметром $1 (массив id) — константами: проверка SQL (sql-sanity) видит запрос целиком. */
const BY_HEADS = membershipCtes({ heads: '$1::bigint[]' });
const BY_MEMBERS = membershipCtes({ members: '$1::bigint[]' });

export interface IMembership {
  member: number;
  head: number;
  /** Название второй стороны пары: участника (loadGroupMembers) или группы (loadGroupHeads). */
  name: string;
}

/** Участники групп heads — живые карточки, по названию. */
export const loadGroupMembers = async (exec: DbExecutor, heads: readonly number[]): Promise<IMembership[]> =>
  heads.length === 0
    ? []
    : (
        await exec.query<IMembership>(
          `WITH ${BY_HEADS}
           SELECT DISTINCT m.member, m.head, c.name
           FROM mem m JOIN companies c ON c.id = m.member AND c.merged_into_id IS NULL
           WHERE m.member <> ALL($1::bigint[])
           ORDER BY c.name, member`,
          [[...heads]],
        )
      ).rows;

/** Группы, в которые входят компании members, — живые карточки, по названию. */
export const loadGroupHeads = async (exec: DbExecutor, members: readonly number[]): Promise<IMembership[]> =>
  members.length === 0
    ? []
    : (
        await exec.query<IMembership>(
          `WITH ${BY_MEMBERS}
           SELECT DISTINCT m.member, m.head, c.name
           FROM mem m JOIN companies c ON c.id = m.head AND c.merged_into_id IS NULL
           ORDER BY c.name, head`,
          [[...members]],
        )
      ).rows;
