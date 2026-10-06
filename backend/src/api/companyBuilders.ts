// «Кто строит для компании» (этап 24D): генподрядчики и подрядчики на объектах, где компания — заказчик,
// застройщик или инвестор (сама или через СЗ своей группы).
//
// Два источника, и оба подписаны: строка «Генподрядчики» последнего снимка ДОМ.РФ (сведения сайта на дату,
// с ИНН) и роли генподрядчика/подрядчика из опубликованных разборов публикаций (card_participations_v).
// Генподрядчик из ДОМ.РФ находится среди юрлиц портала по ИНН с верной контрольной суммой; без ИНН — по
// точному нормализованному названию и только если такое юрлицо одно («совпало по названию»). Ничего не
// пишется: это чтение, канон и решения аналитика не меняются.

import { query } from '../db/pool.js';
import { normalizeName } from '../resolve/normalize.js';
import { parseRegistryContractors } from '../registry/contractors.js';
import { loadCompanyObjects, loadGroupMembers, type ICompanyObject } from './companyObjects.js';

/** Роли «стороны заказчика»: на таких объектах компания нанимает строителей, а не строит сама. */
export const CUSTOMER_SIDE_ROLES: ReadonlySet<string> = new Set(['customer', 'developer', 'investor']);
export const BUILDER_ROLES = ['general_contractor', 'contractor'] as const;
export type BuilderRole = (typeof BUILDER_ROLES)[number];
export type BuilderSource = 'registry' | 'publications';
export type BuilderMatch = 'identifier' | 'name' | 'participation';

export interface IBuilderObject {
  projectId: number;
  name: string;
  role: BuilderRole;
  sources: BuilderSource[];
  isCurrent: boolean;
  /** Дата сведений ДОМ.РФ (или дата снимка, если сайт даты не дал). */
  registryAsOf: string | null;
  /** Последняя публикация, где компания названа в этой роли. */
  lastPublication: string | null;
  /** Сколько записей участия из публикаций; null — только ДОМ.РФ. */
  mentions: number | null;
}

export interface ICompanyBuilder {
  key: string;
  name: string;
  inn: string | null;
  company: { id: number; name: string } | null;
  /** Как найдена карточка портала: по ИНН, по названию или она сама названа в публикации. */
  match: BuilderMatch | null;
  /** Названия, как их пишет ДОМ.РФ. */
  registryNames: string[];
  /** Сама компания или участник её группы: строит своими силами. */
  inGroup: boolean;
  roles: BuilderRole[];
  sources: BuilderSource[];
  objects: IBuilderObject[];
  lastSeen: string | null;
}

export interface ICompanyBuildersResponse {
  items: ICompanyBuilder[];
  objects: {
    /** Объекты, где компания (или СЗ группы) — заказчик, застройщик или инвестор. */
    customerSide: number;
    withRegistry: number;
    withRegistryContractor: number;
    /** Список объектов компании усечён (OBJECTS_LIMIT): сводка — по показанным. */
    truncated: boolean;
  };
}

export interface IPublicationBuilderRow {
  projectId: number;
  companyId: number;
  companyName: string;
  inn: string | null;
  role: BuilderRole;
  isCurrent: boolean;
  mentions: number;
  lastPublication: Date | string | null;
}

export interface IRegistryBuilderEntry {
  projectId: number;
  name: string;
  inn: string | null;
  asOf: string | null;
  company: { id: number; name: string } | null;
  match: 'identifier' | 'name' | null;
}

const iso = (value: Date | string | null): string | null => (value instanceof Date ? value.toISOString() : value);
const later = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a > b ? a : b);
const MATCH_RANK: Record<BuilderMatch, number> = { identifier: 0, name: 1, participation: 2 };

/** Склейка двух источников в список строителей. Чистая функция — проверяется без базы. */
export const buildBuilders = (
  objects: ReadonlyArray<Pick<ICompanyObject, 'projectId' | 'name'>>,
  registry: ReadonlyArray<IRegistryBuilderEntry>,
  publications: ReadonlyArray<IPublicationBuilderRow>,
  groupIds: ReadonlySet<number>,
): ICompanyBuilder[] => {
  const objectName = new Map(objects.map(o => [o.projectId, o.name]));
  const byKey = new Map<string, ICompanyBuilder>();

  const upsert = (
    key: string,
    seed: () => ICompanyBuilder,
    object: { projectId: number; role: BuilderRole; source: BuilderSource; isCurrent: boolean; registryAsOf?: string | null; lastPublication?: string | null; mentions?: number },
  ): ICompanyBuilder => {
    const builder = byKey.get(key) ?? seed();
    byKey.set(key, builder);
    if (!builder.roles.includes(object.role)) builder.roles.push(object.role);
    if (!builder.sources.includes(object.source)) builder.sources.push(object.source);
    let row = builder.objects.find(o => o.projectId === object.projectId && o.role === object.role);
    if (!row) {
      row = {
        projectId: object.projectId,
        name: objectName.get(object.projectId) ?? '',
        role: object.role,
        sources: [],
        isCurrent: false,
        registryAsOf: null,
        lastPublication: null,
        mentions: null,
      };
      builder.objects.push(row);
    }
    if (!row.sources.includes(object.source)) row.sources.push(object.source);
    row.isCurrent ||= object.isCurrent;
    row.registryAsOf = later(row.registryAsOf, object.registryAsOf ?? null);
    row.lastPublication = later(row.lastPublication, object.lastPublication ?? null);
    if (object.mentions !== undefined) row.mentions = (row.mentions ?? 0) + object.mentions;
    builder.lastSeen = later(builder.lastSeen, later(object.registryAsOf ?? null, object.lastPublication ?? null));
    return builder;
  };

  const blank = (key: string, name: string, inn: string | null, company: ICompanyBuilder['company'], match: BuilderMatch | null) =>
    (): ICompanyBuilder => ({
      key,
      name,
      inn,
      company,
      match,
      registryNames: [],
      inGroup: company !== null && groupIds.has(company.id),
      roles: [],
      sources: [],
      objects: [],
      lastSeen: null,
    });

  for (const entry of registry) {
    const key = entry.company ? `company:${entry.company.id}` : entry.inn ? `inn:${entry.inn}` : `name:${entry.name.toLowerCase()}`;
    const builder = upsert(key, blank(key, entry.company?.name ?? entry.name, entry.inn, entry.company, entry.match), {
      projectId: entry.projectId,
      role: 'general_contractor',
      source: 'registry',
      isCurrent: true,
      registryAsOf: entry.asOf,
    });
    if (!builder.registryNames.includes(entry.name)) builder.registryNames.push(entry.name);
    builder.inn ??= entry.inn;
    if (entry.match && (builder.match === null || MATCH_RANK[entry.match] < MATCH_RANK[builder.match])) builder.match = entry.match;
  }

  for (const row of publications) {
    const key = `company:${row.companyId}`;
    const company = { id: row.companyId, name: row.companyName };
    const builder = upsert(key, blank(key, row.companyName, row.inn, company, 'participation'), {
      projectId: row.projectId,
      role: row.role,
      source: 'publications',
      isCurrent: row.isCurrent,
      lastPublication: iso(row.lastPublication),
      mentions: row.mentions,
    });
    builder.inn ??= row.inn;
  }

  const items = [...byKey.values()];
  for (const builder of items) {
    builder.objects.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    // Генподрядчик раньше подрядчика: порядок ролей — как в BUILDER_ROLES.
    builder.roles.sort((a, b) => BUILDER_ROLES.indexOf(a) - BUILDER_ROLES.indexOf(b));
  }
  const objectCount = (b: ICompanyBuilder) => new Set(b.objects.map(o => o.projectId)).size;
  return items.sort(
    (a, b) =>
      Number(b.roles.includes('general_contractor')) - Number(a.roles.includes('general_contractor')) ||
      objectCount(b) - objectCount(a) ||
      Number(b.sources.includes('registry')) - Number(a.sources.includes('registry')) ||
      (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') ||
      a.name.localeCompare(b.name, 'ru'),
  );
};

const PUBLICATIONS_SQL = `
  SELECT pp.project_id AS "projectId", pp.company_id AS "companyId", c.name AS "companyName",
         (SELECT ei.value FROM entity_identifiers ei
           WHERE ei.company_id = c.id AND ei.identifier_type = 'inn' AND ei.status = 'active'
             AND ei.validation_status = 'checksum_valid'
           ORDER BY ei.id LIMIT 1) AS inn,
         pp.role, bool_or(pp.is_current) AS "isCurrent", count(*)::int AS mentions,
         max(d.published_at) AS "lastPublication"
  FROM card_participations_v pp
  JOIN companies c ON c.id = pp.company_id AND c.merged_into_id IS NULL
  LEFT JOIN raw_documents d ON d.id = pp.evidence_document_id
  WHERE pp.project_id = ANY($1::bigint[]) AND pp.role = ANY($2::text[])
  GROUP BY pp.project_id, pp.company_id, c.id, c.name, pp.role`;

/** Юрлица портала по ИНН: одна карточка на ИНН — ссылка, несколько (дубль до слияния) — без ссылки. */
const BY_INN_SQL = `
  SELECT ei.value AS inn, c.id, c.name
  FROM entity_identifiers ei
  JOIN companies c ON c.id = ei.company_id AND c.merged_into_id IS NULL
  WHERE ei.identifier_type = 'inn' AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
    AND ei.value = ANY($1::text[])`;

/** Юрлица портала (с реквизитом) по точному нормализованному названию. */
const BY_NAME_SQL = `
  SELECT DISTINCT a.alias_norm AS norm, c.id, c.name
  FROM entity_aliases a
  JOIN companies c ON c.id = a.entity_id AND c.merged_into_id IS NULL
  WHERE a.entity_kind = 'company' AND a.alias_norm = ANY($1::text[])
    AND EXISTS (
      SELECT 1 FROM entity_identifiers ei
      WHERE ei.company_id = c.id AND ei.status = 'active' AND ei.validation_status = 'checksum_valid')`;

/** Только однозначное: ровно одна карточка на ключ. */
const unique = <K>(rows: ReadonlyArray<{ key: K; id: number; name: string }>): Map<K, { id: number; name: string }> => {
  const grouped = new Map<K, Map<number, string>>();
  for (const row of rows) {
    const ids = grouped.get(row.key) ?? new Map<number, string>();
    ids.set(row.id, row.name);
    grouped.set(row.key, ids);
  }
  const out = new Map<K, { id: number; name: string }>();
  for (const [key, ids] of grouped) {
    const first = ids.size === 1 ? [...ids][0] : undefined;
    if (first) out.set(key, { id: first[0], name: first[1] });
  }
  return out;
};

export const loadCompanyBuilders = async (companyId: number): Promise<ICompanyBuildersResponse> => {
  const [objects, members] = await Promise.all([loadCompanyObjects(companyId), loadGroupMembers(companyId)]);
  const customerSide = objects.items.filter(
    o => o.basis === 'participation' && o.roles.some(r => CUSTOMER_SIDE_ROLES.has(r.role)),
  );
  const groupIds = new Set([companyId, ...members.map(m => m.companyId)]);

  const parsed = customerSide.flatMap(o =>
    parseRegistryContractors(o.registry?.contractor).map(c => ({
      projectId: o.projectId,
      ...c,
      asOf: o.registry?.asOf ?? o.registry?.fetchedAt ?? null,
    })),
  );
  const inns = [...new Set(parsed.flatMap(c => (c.inn ? [c.inn] : [])))];
  const norms = [...new Set(parsed.filter(c => !c.inn).map(c => normalizeName(c.name).norm).filter(n => n !== ''))];

  const [byInnRows, byNameRows, publications] = await Promise.all([
    inns.length > 0 ? query<{ inn: string; id: number; name: string }>(BY_INN_SQL, [inns]) : Promise.resolve([]),
    norms.length > 0 ? query<{ norm: string; id: number; name: string }>(BY_NAME_SQL, [norms]) : Promise.resolve([]),
    customerSide.length > 0
      ? query<IPublicationBuilderRow>(PUBLICATIONS_SQL, [customerSide.map(o => o.projectId), [...BUILDER_ROLES]])
      : Promise.resolve([]),
  ]);
  const byInn = unique(byInnRows.map(r => ({ key: r.inn, id: r.id, name: r.name })));
  const byName = unique(byNameRows.map(r => ({ key: r.norm, id: r.id, name: r.name })));

  const registry: IRegistryBuilderEntry[] = parsed.map(c => {
    const viaInn = c.inn ? byInn.get(c.inn) : undefined;
    const viaName = c.inn ? undefined : byName.get(normalizeName(c.name).norm);
    return {
      projectId: c.projectId,
      name: c.name,
      inn: c.inn,
      asOf: c.asOf,
      company: viaInn ?? viaName ?? null,
      match: viaInn ? 'identifier' : viaName ? 'name' : null,
    };
  });

  return {
    items: buildBuilders(customerSide, registry, publications, groupIds),
    objects: {
      customerSide: customerSide.length,
      withRegistry: customerSide.filter(o => o.registry).length,
      withRegistryContractor: customerSide.filter(o => parseRegistryContractors(o.registry?.contractor).length > 0).length,
      truncated: objects.coverage.truncated,
    },
  };
};
