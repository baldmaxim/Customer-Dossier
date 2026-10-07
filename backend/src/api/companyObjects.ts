// Объекты компании для вкладки «Объекты» (02.10.2026): участие и события самой компании, объекты
// застройщиков её группы и сводка ДОМ.РФ по каждому объекту.
//
// Группа → СЗ → объект. На ДОМ.РФ у каждого дома свой специализированный застройщик: «Река» —
// ООО «СЗ Развитие», группа «Донстрой». Реестр пишет роль застройщика у СЗ и связь «входит в
// группу» (registry/publish.ts). Карточка группы показывает объекты своих СЗ с пометкой «через …»:
// это роль участника группы, а не самой группы, и роль группе не приписывается.
//
// Сводка ДОМ.РФ — поля последнего снимка объекта по подписи; это сведения сайта на дату, а не
// проверенный факт (атрибуция — на экране). Состояние по событиям — запасной путь без реестра.

import { query } from '../db/pool.js';
import type { IRegistryPayload } from '../registry/changes.js';
import { labelsOf, slimRegistryPayloadSql } from '../registry/payloadSql.js';
import { hasPhoto } from '../registry/photos.js';
import { shareInFlight } from '../utils/shareInFlight.js';

/** Объектов на вкладке: карточка, а не каталог; что не вошло — честно числом. */
export const OBJECTS_LIMIT = 300;

export interface ICompanyObjectRole {
  role: string;
  isCurrent: boolean;
  origin: string;
}

export interface ICompanyObjectRegistry {
  externalRef: string;
  sourceTitle: string;
  asOf: string | null;
  fetchedAt: string;
  address: string | null;
  status: string | null;
  completion: string | null;
  keys: string | null;
  apartments: string | null;
  pricePerSqm: string | null;
  propertyClass: string | null;
  floors: string | null;
  sold: string | null;
  contractor: string | null;
  developer: string | null;
  group: string | null;
  /** Главное фото снято (ADR-012 п. 35): отдаётся GET /api/projects/:id/photo. */
  hasPhoto: boolean;
}

export interface ICompanyObject {
  projectId: number;
  name: string;
  city: string | null;
  level: string | null;
  /** participation — роль названа; event — объект только в событиях компании, роль не названа. */
  basis: 'participation' | 'event';
  roles: ICompanyObjectRole[];
  /** Объект участника группы: роль у него, а не у самой компании. */
  via: { companyId: number; name: string } | null;
  registry: ICompanyObjectRegistry | null;
  state: { state: string; validFrom: string | null } | null;
}

export interface ICompanyObjectsResponse {
  items: ICompanyObject[];
  /** Участники группы, чьи объекты показаны. */
  members: Array<{ companyId: number; name: string }>;
  coverage: { loaded: number; total: number; truncated: boolean };
}

/**
 * Участники группы: «входит в группу» к этой компании — из опубликованных наборов и из реестра
 * (у реестра свои утверждения с действующим подтверждающим доказательством, как в card_participations_v).
 */
const MEMBERS_SQL = `
  SELECT DISTINCT c.id AS "companyId", c.name
  FROM assertions a
  JOIN companies c ON c.id = a.subject_company_id AND c.merged_into_id IS NULL
  WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group'
    AND a.object_company_id = $1 AND a.subject_company_id <> $1
    AND a.status <> 'rejected' AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'claim', 'unknown')
    AND (
      (a.origin = 'registry' AND EXISTS (
        SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'))
      OR EXISTS (SELECT 1 FROM published_assertions_v pa WHERE pa.id = a.id)
    )
  ORDER BY c.name`;

/** Связи с объектами: роли компании и участников группы, объекты из событий самой компании. */
const LINKS_SQL = `
  SELECT link.project_id AS "projectId", link.company_id AS "companyId", link.role, link.is_current AS "isCurrent",
         link.origin, link.basis, p.name, p.city, p.project_level AS "level"
  FROM (
    SELECT pp.project_id, pp.company_id, pp.role, pp.is_current, pp.origin, 'participation'::text AS basis
    FROM card_participations_v pp
    WHERE pp.company_id = ANY($1::bigint[])
    UNION ALL
    SELECT DISTINCT e.project_id, e.company_id, NULL::text, NULL::boolean, NULL::text, 'event'::text
    FROM card_events_v e
    WHERE e.company_id = $2 AND e.project_id IS NOT NULL AND e.status <> 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM card_participations_v pp WHERE pp.company_id = e.company_id AND pp.project_id = e.project_id)
  ) link
  JOIN projects p ON p.id = link.project_id AND p.merged_into_id IS NULL`;

/** Подписи снимка ДОМ.РФ, которые читает сводка объекта (по приоритету); по ним же SQL отбирает поля. */
const SUMMARY_LABELS = {
  status: ['Статус строительства'],
  completion: ['Сдача дома', 'Срок сдачи'],
  keys: ['Выдача ключей'],
  apartments: ['Количество квартир'],
  pricePerSqm: ['Средняя цена за 1 м²', 'Средняя цена за м2'],
  propertyClass: ['Класс недвижимости'],
  floors: ['Количество этажей'],
  sold: ['Распроданность квартир', 'Продано квартир'],
  contractor: ['Генподрядчики', 'Генподрядчик'],
  developer: ['Застройщик'],
  group: ['Группа компаний'],
} as const;

/** Последний снимок объекта: сначала id (DISTINCT ON считает выражения по каждой строке), потом поля только по нему. */
const REGISTRY_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (r.project_id) r.id
    FROM registry_records r
    WHERE r.record_type = 'object' AND r.project_id = ANY($1::bigint[])
    ORDER BY r.project_id, r.fetched_at DESC
  )
  SELECT r.project_id AS "projectId", r.external_ref AS "externalRef", r.as_of AS "asOf",
         r.fetched_at AS "fetchedAt", ${slimRegistryPayloadSql('r.payload', '$2')} AS payload, s.title AS "sourceTitle"
  FROM latest l JOIN registry_records r ON r.id = l.id JOIN sources s ON s.id = r.source_id`;

/** Состояние по событиям — всего объекта (без корпуса). */
const STATE_SQL = `
  SELECT project_id AS "projectId", state, valid_from AS "validFrom"
  FROM project_current_state_v
  WHERE project_id = ANY($1::bigint[]) AND scope_building IS NULL`;

interface ILinkRow {
  projectId: number;
  companyId: number;
  role: string | null;
  isCurrent: boolean | null;
  origin: string | null;
  basis: 'participation' | 'event';
  name: string;
  city: string | null;
  level: string | null;
}

/** Первое непустое поле снимка с одной из подписей: у API и у страницы сайта подписи разные. */
const field = (payload: IRegistryPayload, ...labels: string[]): string | null => {
  for (const label of labels) {
    const found = payload.fields.find(f => f.label === label && f.value.trim() !== '');
    if (found) return found.value;
  }
  return null;
};

export const registrySummary = (
  row: { externalRef: string; sourceTitle: string; asOf: string | null; fetchedAt: Date | string; payload: IRegistryPayload },
): ICompanyObjectRegistry => {
  const { payload } = row;
  return {
    externalRef: row.externalRef,
    sourceTitle: row.sourceTitle,
    asOf: row.asOf,
    fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : row.fetchedAt,
    address: payload.identity.address,
    status: field(payload, ...SUMMARY_LABELS.status),
    completion: field(payload, ...SUMMARY_LABELS.completion),
    keys: field(payload, ...SUMMARY_LABELS.keys),
    apartments: field(payload, ...SUMMARY_LABELS.apartments),
    pricePerSqm: field(payload, ...SUMMARY_LABELS.pricePerSqm),
    propertyClass: field(payload, ...SUMMARY_LABELS.propertyClass),
    floors: field(payload, ...SUMMARY_LABELS.floors),
    sold: field(payload, ...SUMMARY_LABELS.sold),
    contractor: field(payload, ...SUMMARY_LABELS.contractor),
    developer: payload.identity.developer?.name ?? field(payload, ...SUMMARY_LABELS.developer),
    group: payload.identity.groupName ?? field(payload, ...SUMMARY_LABELS.group),
    hasPhoto: hasPhoto(row.externalRef),
  };
};

/**
 * Порядок: свои роли раньше ролей участников группы, объекты с ролью раньше «только в событиях»,
 * со сведениями ДОМ.РФ — раньше остальных, текущее участие — раньше прошлого, дальше по имени.
 */
const rank = (o: ICompanyObject): number[] => [
  o.via ? 1 : 0,
  o.basis === 'event' ? 1 : 0,
  o.registry ? 0 : 1,
  o.roles.some(r => r.isCurrent) ? 0 : 1,
];

/**
 * Все участники группы компании — для объектов и для пометки «строит своими силами» (24D).
 * Одновременные вызовы одной компании делят расчёт (shareInFlight): результат только читать.
 */
export const loadGroupMembers = shareInFlight(
  (companyId: number): Promise<Array<{ companyId: number; name: string }>> =>
    query<{ companyId: number; name: string }>(MEMBERS_SQL, [companyId]),
);

/**
 * Объекты компании. Карточка запрашивает их четырьмя блоками сразу («Объекты», «Кто строит», «Сроки и продажи»,
 * «Сайт компании») — одновременные вызовы делят один расчёт (shareInFlight): результат только читать.
 */
export const loadCompanyObjects = shareInFlight(async (companyId: number): Promise<ICompanyObjectsResponse> => {
  const members = await loadGroupMembers(companyId);
  const memberName = new Map(members.map(m => [m.companyId, m.name]));
  const links = await query<ILinkRow>(LINKS_SQL, [[companyId, ...members.map(m => m.companyId)], companyId]);

  const byProject = new Map<number, ICompanyObject>();
  for (const link of links) {
    const own = link.companyId === companyId;
    const current = byProject.get(link.projectId);
    const object: ICompanyObject = current ?? {
      projectId: link.projectId,
      name: link.name,
      city: link.city,
      level: link.level,
      basis: link.basis,
      roles: [],
      via: own ? null : { companyId: link.companyId, name: memberName.get(link.companyId) ?? '' },
      registry: null,
      state: null,
    };
    // Своя роль важнее роли участника группы: тогда объект — свой, без «через».
    if (own && object.via && link.basis === 'participation') {
      object.via = null;
      object.roles = [];
    }
    byProject.set(link.projectId, object);
    // Роли объекта — либо свои, либо (если своих нет) участника группы; смешивать нельзя.
    if (own !== (object.via === null)) continue;
    if (link.basis === 'participation') object.basis = 'participation';
    if (!link.role) continue;
    const known = object.roles.find(r => r.role === link.role);
    if (!known) object.roles.push({ role: link.role, isCurrent: Boolean(link.isCurrent), origin: link.origin ?? 'unknown' });
    else if (link.isCurrent) known.isCurrent = true;
  }

  const ids = [...byProject.keys()];
  if (ids.length > 0) {
    // Сводка ДОМ.РФ и состояние по событиям друг от друга не зависят — параллельно.
    const [registry, states] = await Promise.all([
      query<{ projectId: number; externalRef: string; asOf: string | null; fetchedAt: Date; payload: IRegistryPayload; sourceTitle: string }>(
        REGISTRY_SQL,
        [ids, labelsOf(SUMMARY_LABELS)],
      ),
      query<{ projectId: number; state: string; validFrom: string | null }>(STATE_SQL, [ids]),
    ]);
    for (const row of registry) {
      const object = byProject.get(row.projectId);
      if (object) object.registry = registrySummary(row);
    }
    for (const row of states) {
      const object = byProject.get(row.projectId);
      if (object) object.state = { state: row.state, validFrom: row.validFrom };
    }
  }

  const sorted = [...byProject.values()].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return a.name.localeCompare(b.name, 'ru');
  });
  const items = sorted.slice(0, OBJECTS_LIMIT);
  return {
    items,
    members: members.filter(m => items.some(o => o.via?.companyId === m.companyId)),
    coverage: { loaded: items.length, total: sorted.length, truncated: sorted.length > items.length },
  };
});
