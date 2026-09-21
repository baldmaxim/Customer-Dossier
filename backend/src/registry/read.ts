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
}

interface IRow {
  external_ref: string;
  as_of: Date | null;
  fetched_at: Date;
  payload: IRegistryPayload;
  source_key: string;
  source_title: string;
}

const isoDate = (value: Date | null): string | null => (value === null ? null : value.toISOString().slice(0, 10));

export const ATTRIBUTION =
  'Сведения реестра на указанную дату. Это проектная декларация застройщика, опубликованная в реестре, а не проверенный факт: сроки и характеристики указывает сам застройщик.';

const build = (rows: readonly IRow[]): IRegistryView => {
  const latest = rows[0]!;
  const changes: IRegistryChangeEntry[] = [];
  for (let i = 0; i + 1 < rows.length; i += 1) {
    const current = rows[i]!;
    const previous = rows[i + 1]!;
    const diff = diffPayloads(previous.payload, current.payload);
    if (diff.length > 0) changes.push({ asOf: isoDate(current.as_of), fetchedAt: current.fetched_at.toISOString(), changes: diff });
  }
  return {
    source: { key: latest.source_key, title: latest.source_title },
    externalRef: latest.payload.identity.externalRef,
    asOf: isoDate(latest.as_of),
    fetchedAt: latest.fetched_at.toISOString(),
    fields: latest.payload.fields.map(f => ({ label: f.label, value: f.value })),
    developer: latest.payload.identity.developer,
    groupName: latest.payload.identity.groupName,
    address: latest.payload.identity.address,
    changes,
    coverage: { loaded: rows.length, truncated: rows.length === REGISTRY_HISTORY_LIMIT },
    attribution: ATTRIBUTION,
  };
};

const SELECT = `
  SELECT r.external_ref, r.as_of, r.fetched_at, r.payload, s.key AS source_key, s.title AS source_title
  FROM registry_records r JOIN sources s ON s.id = r.source_id
`;

/** Снимки реестра по объекту. null — объект в реестре не собран. */
export const loadProjectRegistry = async (exec: DbExecutor, projectId: number): Promise<IRegistryView | null> => {
  const rows = (
    await exec.query<IRow>(`${SELECT} WHERE r.project_id = $1 AND r.record_type = 'object' ORDER BY r.fetched_at DESC LIMIT $2`, [
      projectId,
      REGISTRY_HISTORY_LIMIT,
    ])
  ).rows;
  return rows.length === 0 ? null : build(rows);
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
    await exec.query<{ project_id: number; name: string; city: string | null; as_of: Date | null; fetched_at: Date }>(
      `SELECT DISTINCT ON (r.project_id) r.project_id, p.name, p.city, r.as_of, r.fetched_at
       FROM registry_records r JOIN projects p ON p.id = r.project_id
       WHERE r.company_id = $1 AND r.record_type = 'object' AND r.project_id IS NOT NULL AND p.merged_into_id IS NULL
       ORDER BY r.project_id, r.fetched_at DESC
       LIMIT $2`,
      [companyId, limit],
    )
  ).rows.map(r => ({ projectId: r.project_id, name: r.name, city: r.city, asOf: isoDate(r.as_of), fetchedAt: r.fetched_at.toISOString() }));
