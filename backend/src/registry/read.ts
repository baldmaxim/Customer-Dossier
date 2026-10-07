// Чтение снимков реестра для карточки (этап 20B).
//
// Карточка показывает последний снимок и то, что изменилось по сравнению с
// предыдущими. Атрибуция обязательна: это сведения реестра на дату, а не
// проверенный факт — сроки в проектной декларации ставит сам застройщик.
//
// Объект портала — по домам (07.10.2026): у ЖК десятки домов реестра, и «последний снимок объекта» был страницей
// дома, изменившейся последней, а «изменения» сравнивали соседние дома. Теперь у объекта свод по домам
// (registry/houses.ts::summarizeObject — тот же, что у карточки на вкладке «Объекты») и сведения каждого дома с его
// собственной историей.

import { loadGroupHeads } from '../companies/groupMembership.js';
import type { DbExecutor } from '../db/pool.js';
import { diffPayloads, type IRegistryFieldChange, type IRegistryPayload } from './changes.js';
import { houseFacts, summarizeObject, toHouseSnapshot, type IHouse, type IObjectRegistrySummary } from './houses.js';
import { hasPhoto } from './photos.js';
import { completionKey, parseCompletion } from './values.js';

/** Сколько снимков дома читаем для истории изменений: карточка, а не архив. */
export const REGISTRY_HISTORY_LIMIT = 10;

export interface IRegistryChangeEntry {
  /** Дата сведений по реестру; null — реестр её не сообщил. */
  asOf: string | null;
  fetchedAt: string;
  changes: IRegistryFieldChange[];
}

export interface IRegistryView {
  source: { key: string; title: string };
  externalRef: string;
  asOf: string | null;
  fetchedAt: string;
  fields: Array<{ label: string; value: string }>;
  developer: { name: string; legalForm: string | null; inn: string | null; ogrn: string | null } | null;
  groupName: string | null;
  address: string | null;
  changes: IRegistryChangeEntry[];
  /** Сколько снимков прочитано и есть ли более ранние за пределами лимита. */
  coverage: { loaded: number; truncated: boolean };
  attribution: string;
  /** Главное фото объекта снято (ADR-012 п. 35) — только у снимка объекта. */
  hasPhoto?: boolean;
  /** Карточки портала застройщика (по снимку) и его группы (по связи «входит в группу»): ссылки, не новые сведения. */
  developerCompany?: { id: number; name: string } | null;
  groupCompany?: { id: number; name: string } | null;
}

interface IRow {
  external_ref: string;
  /** DATE приходит строкой 'YYYY-MM-DD': парсер типа переопределён в db/pool.ts,
   *  иначе дата уезжала бы на сутки по часовому поясу. Преобразовывать её нечем и незачем. */
  as_of: string | null;
  fetched_at: Date;
  payload: IRegistryPayload;
  source_key: string;
  source_title: string;
}

export const ATTRIBUTION =
  'Сведения реестра на указанную дату. Это проектная декларация застройщика, опубликованная в реестре, а не проверенный факт: сроки и характеристики указывает сам застройщик.';
export const BROWSER_ATTRIBUTION =
  'Текст видимой карточки наш.дом.рф на дату получения. Это опубликованные на сайте сведения об объекте, а не независимо проверенные факты.';

const build = (rows: readonly IRow[]): IRegistryView => {
  const latest = rows[0]!;
  const changes: IRegistryChangeEntry[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    const current = rows[i]!;
    const previous = rows[i + 1]!;
    const diff = diffPayloads(previous.payload, current.payload);
    if (diff.length > 0) changes.push({ asOf: current.as_of, fetchedAt: current.fetched_at.toISOString(), changes: diff });
  }
  return {
    source: { key: latest.source_key, title: latest.source_title },
    externalRef: latest.payload.identity.externalRef,
    asOf: latest.as_of,
    fetchedAt: latest.fetched_at.toISOString(),
    fields: latest.payload.fields.map(f => ({ label: f.label, value: f.value })),
    developer: latest.payload.identity.developer,
    groupName: latest.payload.identity.groupName,
    address: latest.payload.identity.address,
    changes,
    coverage: { loaded: rows.length, truncated: rows.length === REGISTRY_HISTORY_LIMIT },
    attribution: latest.payload.captureMethod === 'browser_page' ? BROWSER_ATTRIBUTION : ATTRIBUTION,
  };
};

const SELECT = `
  SELECT r.external_ref, r.as_of, r.fetched_at, r.payload, s.key AS source_key, s.title AS source_title
  FROM registry_records r JOIN sources s ON s.id = r.source_id
`;

type ICompanyRef = { id: number; name: string };

/** Карточки портала по id снимков (registry_records.company_id); слитая карточка — её действующая. */
const loadCompanyRefs = async (exec: DbExecutor, ids: readonly number[]): Promise<Map<number, ICompanyRef>> => {
  if (ids.length === 0) return new Map();
  const rows = (
    await exec.query<{ sourceId: number; id: number; name: string }>(
      `SELECT c0.id AS "sourceId", c.id, c.name
       FROM companies c0 JOIN companies c ON c.id = coalesce(c0.merged_into_id, c0.id)
       WHERE c0.id = ANY($1::bigint[])`,
      [[...ids]],
    )
  ).rows;
  return new Map(rows.map(r => [r.sourceId, { id: r.id, name: r.name }]));
};

/** Группа застройщика — общим правилом портала (companies/groupMembership.ts), тем же, что каталог и карточка. */
const loadGroupCompany = async (exec: DbExecutor, developerId: number): Promise<ICompanyRef | null> => {
  const heads = await loadGroupHeads(exec, [developerId]);
  return heads.length === 1 ? { id: heads[0]!.head, name: heads[0]!.name } : null;
};

/** Дом объекта на странице объекта: сведения последнего снимка, своя история и карточка его застройщика. */
export interface IProjectRegistryHouse extends IRegistryView {
  name: string;
  status: string | null;
  completion: string | null;
  delivered: boolean;
}

export interface IProjectRegistry {
  /** Свод по домам — тот же, что у карточки объекта на вкладке «Объекты» компании. */
  summary: IObjectRegistrySummary;
  /** Дома: строящиеся по сроку сдачи, затем сданные. */
  houses: IProjectRegistryHouse[];
  /** Застройщик и группа — если у всех домов одна карточка застройщика. */
  developerCompany: ICompanyRef | null;
  groupCompany: ICompanyRef | null;
  attribution: string;
}

interface IHouseRow extends IRow {
  source_id: number;
  company_id: number | null;
}

/** Дом без распознанного срока — после домов со сроком. */
const completionRank = (completion: string | null): number => {
  const parsed = parseCompletion(completion);
  return parsed ? completionKey(parsed) : Number.MAX_SAFE_INTEGER;
};

/** Снимки реестра по объекту — по домам. null — объект в реестре не собран. */
export const loadProjectRegistry = async (exec: DbExecutor, projectId: number): Promise<IProjectRegistry | null> => {
  const rows = (
    await exec.query<IHouseRow>(
      `SELECT r.source_id, r.external_ref, r.as_of, r.fetched_at, r.payload, r.company_id, s.key AS source_key, s.title AS source_title
       FROM (
         SELECT r.*, row_number() OVER (PARTITION BY r.source_id, r.external_ref ORDER BY r.fetched_at DESC, r.id DESC) AS n
         FROM registry_records r WHERE r.project_id = $1 AND r.record_type = 'object'
       ) r JOIN sources s ON s.id = r.source_id
       WHERE r.n <= $2
       ORDER BY r.source_id, r.external_ref, r.fetched_at DESC, r.id DESC`,
      [projectId, REGISTRY_HISTORY_LIMIT],
    )
  ).rows;
  if (rows.length === 0) return null;

  const byHouse = new Map<string, IHouseRow[]>();
  for (const row of rows) {
    const key = `${row.source_id}:${row.external_ref}`;
    byHouse.set(key, [...(byHouse.get(key) ?? []), row]);
  }
  const companies = await loadCompanyRefs(exec, [...new Set(rows.flatMap(r => (r.company_id !== null ? [r.company_id] : [])))]);

  const houses: IHouse[] = [];
  const views: IProjectRegistryHouse[] = [];
  for (const [key, desc] of byHouse) {
    const latest = desc[0]!;
    const snapshots = [...desc].reverse().map(r =>
      toHouseSnapshot({ fetchedAt: r.fetched_at, asOf: r.as_of, projectId, companyId: r.company_id, externalRef: r.external_ref, payload: r.payload }),
    );
    houses.push({ key, sourceId: latest.source_id, sourceTitle: latest.source_title, externalRef: latest.external_ref, projectName: null, snapshots });
    const facts = houseFacts(snapshots[snapshots.length - 1]!.values);
    const developerRow = desc.find(r => r.company_id !== null);
    views.push({
      ...build(desc),
      name: latest.payload.identity?.name ?? latest.external_ref,
      status: facts.status,
      completion: facts.completion,
      delivered: facts.delivered,
      hasPhoto: hasPhoto(latest.external_ref),
      developerCompany: developerRow ? (companies.get(developerRow.company_id!) ?? null) : null,
      groupCompany: null,
    });
  }
  views.sort((a, b) => Number(a.delivered) - Number(b.delivered) || completionRank(a.completion) - completionRank(b.completion) || a.name.localeCompare(b.name, 'ru'));

  const developers = new Map(views.flatMap(v => (v.developerCompany ? [[v.developerCompany.id, v.developerCompany] as const] : [])));
  const developerCompany = developers.size === 1 && views.every(v => v.developerCompany) ? [...developers.values()][0]! : null;
  const groupCompany = developerCompany ? await loadGroupCompany(exec, developerCompany.id) : null;
  return {
    summary: summarizeObject(houses)!,
    houses: views.map(v => ({ ...v, groupCompany: v.developerCompany && developerCompany && v.developerCompany.id === developerCompany.id ? groupCompany : null })),
    developerCompany,
    groupCompany,
    attribution: views[0]!.attribution,
  };
};

/** Снимки реестра по компании: её собственная карточка застройщика. */
export const loadCompanyRegistry = async (exec: DbExecutor, companyId: number): Promise<IRegistryView | null> => {
  const rows = (
    await exec.query<IRow>(`${SELECT} WHERE r.company_id = $1 AND r.record_type = 'developer' ORDER BY r.fetched_at DESC LIMIT $2`, [
      companyId,
      REGISTRY_HISTORY_LIMIT,
    ])
  ).rows;
  return rows.length === 0 ? null : build(rows);
};

/** Объект со сведениями реестра, который может быть тем же, что и объект без них. */
export interface IRegistryLookalike {
  projectId: number;
  name: string;
  city: string | null;
  /** merge_queue — пара ждёт решения в «Проверке»; name — одно название начинается с другого. */
  reason: 'merge_queue' | 'name';
}

/** Ключ имени короче — совпадение начала ничего не значит («ЖК» и «ЖК Символ»). */
const LOOKALIKE_MIN_KEY = 4;

/**
 * У объекта из публикаций нет снимка реестра, а у похожего объекта он есть: «Символ Донстроя» из
 * текста и «Символ» с ДОМ.РФ — разные карточки, пока оператор их не слил. Только подсказка со
 * ссылкой: сведения чужой карточки не подставляются (резолвер не склеил их из-за неизвестного города).
 */
export const loadRegistryLookalikes = async (exec: DbExecutor, projectId: number, limit = 5): Promise<IRegistryLookalike[]> =>
  (
    await exec.query<IRegistryLookalike>(
      `WITH me AS (SELECT id, name_key FROM projects WHERE id = $1),
       queued AS (
         SELECT CASE WHEN m.source_entity_id = $1 THEN m.target_entity_id ELSE m.source_entity_id END AS id
         FROM merge_queue m
         WHERE m.entity_kind = 'project' AND m.status = 'pending' AND $1 IN (m.source_entity_id, m.target_entity_id)
       )
       SELECT p.id AS "projectId", p.name, p.city,
              CASE WHEN p.id IN (SELECT id FROM queued) THEN 'merge_queue' ELSE 'name' END AS reason
       FROM projects p, me
       WHERE p.id <> me.id AND p.merged_into_id IS NULL
         AND EXISTS (SELECT 1 FROM registry_records r WHERE r.project_id = p.id AND r.record_type = 'object')
         AND (
           p.id IN (SELECT id FROM queued)
           OR (length(p.name_key) >= $3 AND length(me.name_key) >= $3
               AND (me.name_key LIKE p.name_key || '%' OR p.name_key LIKE me.name_key || '%'))
         )
       ORDER BY (p.id IN (SELECT id FROM queued)) DESC, abs(length(p.name_key) - length(me.name_key)), p.id
       LIMIT $2`,
      [projectId, limit, LOOKALIKE_MIN_KEY],
    )
  ).rows;
