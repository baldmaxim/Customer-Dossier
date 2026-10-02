// Чтение снимков реестра для карточки (этап 20B).
//
// Карточка показывает последний снимок и то, что изменилось по сравнению с
// предыдущими. Атрибуция обязательна: это сведения реестра на дату, а не
// проверенный факт — сроки в проектной декларации ставит сам застройщик.

import type { DbExecutor } from '../db/pool.js';
import { diffPayloads, type IRegistryFieldChange, type IRegistryPayload } from './changes.js';

/** Сколько снимков читаем для истории изменений: карточка, а не архив. */
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

/**
 * Застройщик последнего снимка объекта и его группа — карточками портала. Застройщик — компания, к
 * которой снимок привязан публикацией (registry_records.company_id); группа — по связи «входит в
 * группу» из реестра или из наборов конвейера. Слитая карточка — её действующая.
 */
const loadRegistryCompanies = async (
  exec: DbExecutor,
  projectId: number,
): Promise<{ developerCompany: { id: number; name: string } | null; groupCompany: { id: number; name: string } | null }> => {
  const developer = (
    await exec.query<{ id: number; name: string }>(
      `SELECT c.id, c.name
       FROM registry_records r
       JOIN companies c0 ON c0.id = r.company_id
       JOIN companies c ON c.id = coalesce(c0.merged_into_id, c0.id)
       WHERE r.project_id = $1 AND r.record_type = 'object' AND r.company_id IS NOT NULL
       ORDER BY r.fetched_at DESC LIMIT 1`,
      [projectId],
    )
  ).rows[0] ?? null;
  if (!developer) return { developerCompany: null, groupCompany: null };
  const group = (
    await exec.query<{ id: number; name: string }>(
      `SELECT c.id, c.name
       FROM assertions a
       JOIN companies c ON c.id = a.object_company_id AND c.merged_into_id IS NULL
       WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group' AND a.subject_company_id = $1
         AND a.status <> 'rejected' AND a.polarity = 'positive'
         AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')
       ORDER BY (a.origin = 'registry') DESC, a.id DESC LIMIT 1`,
      [developer.id],
    )
  ).rows[0] ?? null;
  return { developerCompany: developer, groupCompany: group };
};

/** Снимки реестра по объекту. null — объект в реестре не собран. */
export const loadProjectRegistry = async (exec: DbExecutor, projectId: number): Promise<IRegistryView | null> => {
  const rows = (
    await exec.query<IRow>(`${SELECT} WHERE r.project_id = $1 AND r.record_type = 'object' ORDER BY r.fetched_at DESC LIMIT $2`, [
      projectId,
      REGISTRY_HISTORY_LIMIT,
    ])
  ).rows;
  return rows.length === 0 ? null : { ...build(rows), ...(await loadRegistryCompanies(exec, projectId)) };
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

/** Объекты компании по данным реестра: последний снимок каждого объекта. */
export interface IRegistryProjectRow {
  projectId: number;
  name: string;
  city: string | null;
  asOf: string | null;
  fetchedAt: string;
}

export const loadCompanyRegistryProjects = async (exec: DbExecutor, companyId: number, limit = 50): Promise<IRegistryProjectRow[]> =>
  (
    await exec.query<{ project_id: number; name: string; city: string | null; as_of: string | null; fetched_at: Date }>(
      `SELECT DISTINCT ON (r.project_id) r.project_id, p.name, p.city, r.as_of, r.fetched_at
       FROM registry_records r JOIN projects p ON p.id = r.project_id
       WHERE r.company_id = $1 AND r.record_type = 'object' AND r.project_id IS NOT NULL AND p.merged_into_id IS NULL
       ORDER BY r.project_id, r.fetched_at DESC
       LIMIT $2`,
      [companyId, limit],
    )
  ).rows.map(r => ({ projectId: r.project_id, name: r.name, city: r.city, asOf: r.as_of, fetchedAt: r.fetched_at.toISOString() }));

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
