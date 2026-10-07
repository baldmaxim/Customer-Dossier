// Дом ДОМ.РФ — единица сведений реестра (07.10.2026, «одно сведение — один источник»).
//
// Один объект портала (ЖК) связан с десятками домов реестра: у каждого свой статус, срок сдачи, квартиры, продажи и
// генподрядчик. Раньше карточка объекта, паспорт и фото брали «последний снимок объекта» — тот дом, чья страница
// изменилась последней, а «Сроки и продажи» считали по домам: на одной карточке ЖК был «сдан», а в блоке — «строится».
// Теперь все читают отсюда: снимки по ключу дома (источник + номер записи), поля — по одной таблице подписей,
// объект — свод по своим домам (`summarizeObject`), фото — одним правилом (`photoHouse`).
//
// Это сведения сайта на дату, а не проверенный факт (ADR-012): подписи сайта — как есть, числа — разбором
// registry/values.ts (незнакомый формат — null, а не догадка).

import type { DbExecutor } from '../db/pool.js';
import type { IRegistryPayload } from './changes.js';
import { parseRegistryContractors, type IRegistryContractor } from './contractors.js';
import { labelsOf, slimRegistryPayloadSql } from './payloadSql.js';
import { hasPhoto } from './photos.js';
import { completionKey, parseCompletion, parseCount, parsePercent, parseRubles, parseSoldCount } from './values.js';

/**
 * Подписи снимка по приоритету — одна таблица на весь портал: у API и у страницы сайта подписи разные, и `field()`
 * берёт первую непустую. По ней же SQL отбирает поля (slimRegistryPayloadSql): новая подпись сразу попадает в выборку.
 */
export const HOUSE_LABELS = {
  status: ['Статус строительства'],
  completion: ['Сдача дома', 'Срок сдачи'],
  keys: ['Выдача ключей'],
  apartments: ['Количество квартир'],
  soldPercent: ['Продано квартир', 'Распроданность квартир'],
  soldCount: ['Продано квартир, количество'],
  price: ['Средняя цена за 1 м²', 'Средняя цена за м2'],
  propertyClass: ['Класс недвижимости'],
  floors: ['Количество этажей'],
  contractor: ['Генподрядчики', 'Генподрядчик'],
  developer: ['Застройщик'],
  group: ['Группа компаний'],
} as const;

export type HouseField = keyof typeof HOUSE_LABELS;

const FIELDS = Object.keys(HOUSE_LABELS) as HouseField[];

/** Все подписи таблицы — параметр отбора полей в SQL. */
export const HOUSE_LABEL_LIST: string[] = labelsOf(HOUSE_LABELS);

/** Первое непустое поле снимка с подписью этого поля (по приоритету). */
export const houseField = (payload: Pick<IRegistryPayload, 'fields'>, key: HouseField): string | null => {
  for (const label of HOUSE_LABELS[key]) {
    const found = payload.fields.find(f => f.label === label && f.value.trim() !== '');
    if (found) return found.value;
  }
  return null;
};

/** Сдан ли дом — по словам статуса сайта. */
export const DELIVERED_STATUS = /сдан|введ[её]н/i;
export const isDelivered = (status: string | null): boolean => status !== null && DELIVERED_STATUS.test(status);

export interface IHouseSnapshot {
  fetchedAt: string;
  /** Дата сведений по реестру, YYYY-MM-DD; null — не сообщена. */
  asOf: string | null;
  projectId: number | null;
  /** Застройщик, к которому снимок привязан публикацией (registry_records.company_id). */
  companyId: number | null;
  name: string;
  address: string | null;
  developer: IRegistryPayload['identity']['developer'];
  groupName: string | null;
  values: Record<HouseField, string | null>;
}

export interface IHouse {
  /** Ключ дома: источник + номер записи. Номер записи сам по себе ключом не является — у двух источников он свой. */
  key: string;
  sourceId: number;
  sourceTitle: string;
  externalRef: string;
  projectName: string | null;
  /** По возрастанию даты снимка; последний — текущие сведения дома. */
  snapshots: IHouseSnapshot[];
}

export const latestSnapshot = (house: IHouse): IHouseSnapshot => house.snapshots[house.snapshots.length - 1]!;

interface IHouseRow {
  sourceId: number;
  sourceTitle: string;
  externalRef: string;
  projectId: number | null;
  projectName: string | null;
  companyId: number | null;
  fetchedAt: Date;
  asOf: string | Date | null;
  payload: IRegistryPayload;
}

const COLUMNS = `r.source_id AS "sourceId", s.title AS "sourceTitle", r.external_ref AS "externalRef", r.project_id AS "projectId",
         p.name AS "projectName", r.company_id AS "companyId", r.fetched_at AS "fetchedAt", r.as_of AS "asOf",
         ${slimRegistryPayloadSql('r.payload', '$3')} AS payload`;

const FILTER = `r.record_type = 'object' AND (r.project_id = ANY($1::bigint[]) OR r.company_id = ANY($2::bigint[]))`;

/** Вся история снимков домов — из каждого только identity и подписи таблицы. */
const HISTORY_SQL = `
  SELECT ${COLUMNS}
  FROM registry_records r JOIN sources s ON s.id = r.source_id LEFT JOIN projects p ON p.id = r.project_id
  WHERE ${FILTER}
  ORDER BY r.source_id, r.external_ref, r.fetched_at, r.id`;

/** Последний снимок каждого дома: сначала id (DISTINCT ON считает выражения по каждой строке), потом поля только по нему. */
const LATEST_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (r.source_id, r.external_ref) r.id
    FROM registry_records r
    WHERE ${FILTER}
    ORDER BY r.source_id, r.external_ref, r.fetched_at DESC, r.id DESC
  )
  SELECT ${COLUMNS}
  FROM latest l JOIN registry_records r ON r.id = l.id JOIN sources s ON s.id = r.source_id LEFT JOIN projects p ON p.id = r.project_id
  ORDER BY r.source_id, r.external_ref`;

const dayOf = (value: string | Date | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);

/** Снимок записи реестра → снимок дома: поля по таблице подписей. */
export const toHouseSnapshot = (row: {
  fetchedAt: Date | string;
  asOf: string | Date | null;
  projectId: number | null;
  companyId: number | null;
  externalRef: string;
  payload: IRegistryPayload;
}): IHouseSnapshot => ({
  fetchedAt: row.fetchedAt instanceof Date ? row.fetchedAt.toISOString() : row.fetchedAt,
  asOf: dayOf(row.asOf),
  projectId: row.projectId,
  companyId: row.companyId,
  name: row.payload.identity?.name ?? row.externalRef,
  address: row.payload.identity?.address ?? null,
  developer: row.payload.identity?.developer ?? null,
  groupName: row.payload.identity?.groupName ?? null,
  values: Object.fromEntries(FIELDS.map(key => [key, houseField(row.payload, key)])) as Record<HouseField, string | null>,
});

/** Строки снимков (по дому и по возрастанию даты) → дома. */
export const groupHouses = <T extends IHouseRow>(rows: readonly T[]): IHouse[] => {
  const houses = new Map<string, IHouse>();
  for (const row of rows) {
    const key = `${row.sourceId}:${row.externalRef}`;
    const house = houses.get(key) ?? { key, sourceId: row.sourceId, sourceTitle: row.sourceTitle, externalRef: row.externalRef, projectName: null, snapshots: [] };
    houses.set(key, house);
    house.snapshots.push(toHouseSnapshot(row));
    house.projectName = row.projectName;
  }
  return [...houses.values()];
};

/** Дома объектов портала и застройщиков: latest — только последний снимок дома, history — весь ряд. */
export const loadHouses = async (
  exec: DbExecutor,
  filter: { projectIds?: readonly number[]; companyIds?: readonly number[] },
  mode: 'latest' | 'history',
): Promise<IHouse[]> => {
  const projectIds = [...(filter.projectIds ?? [])];
  const companyIds = [...(filter.companyIds ?? [])];
  if (projectIds.length === 0 && companyIds.length === 0) return [];
  const rows = (await exec.query<IHouseRow>(mode === 'latest' ? LATEST_SQL : HISTORY_SQL, [projectIds, companyIds, HOUSE_LABEL_LIST])).rows;
  return groupHouses(rows);
};

/** Последние снимки домов по объекту портала (дом — у объекта своего последнего снимка). */
export const housesByProject = (houses: readonly IHouse[]): Map<number, IHouse[]> => {
  const out = new Map<number, IHouse[]>();
  for (const house of houses) {
    const projectId = latestSnapshot(house).projectId;
    if (projectId === null) continue;
    out.set(projectId, [...(out.get(projectId) ?? []), house]);
  }
  return out;
};

export interface IHouseFacts {
  status: string | null;
  delivered: boolean;
  completion: string | null;
  apartments: number | null;
  /** Доля проданного: «N квартир из M», иначе процент. */
  soldShare: number | null;
  price: number | null;
}

/** Разобранные сведения последнего снимка дома — одно правило для свода объекта и «Сроков и продаж». */
export const houseFacts = (values: Record<HouseField, string | null>): IHouseFacts => {
  const counted = parseSoldCount(values.soldCount);
  return {
    status: values.status,
    delivered: isDelivered(values.status),
    completion: values.completion,
    apartments: parseCount(values.apartments) ?? counted?.total ?? null,
    soldShare: counted ? counted.sold / counted.total : parsePercent(values.soldPercent),
    price: parseRubles(values.price),
  };
};

/** Дом, чьё фото показывают у объекта: из домов со снятым фото — с самым свежим снимком. Одно правило для сетки и паспорта. */
export const photoHouse = (houses: readonly IHouse[]): IHouse | null =>
  [...houses]
    .filter(h => hasPhoto(h.externalRef))
    .sort((a, b) => latestSnapshot(b).fetchedAt.localeCompare(latestSnapshot(a).fetchedAt) || a.key.localeCompare(b.key))[0] ?? null;

export interface IObjectRegistrySummary {
  sourceTitle: string;
  houses: number;
  delivered: number;
  inProgress: number;
  /** Статус, общий у всех домов (подпись сайта); у домов разные — null, экран говорит «сдано N из M». */
  status: string | null;
  /** Срок сдачи строящихся домов (сданы все — всех домов): самый ранний и самый поздний, строками сайта. */
  completion: { from: string; to: string } | null;
  /** Общие у всех домов значения; разные — null. */
  keys: string | null;
  propertyClass: string | null;
  floors: string | null;
  developer: string | null;
  group: string | null;
  address: string | null;
  /** Квартиры — сумма распознанных по домам; сколько домов распознано. */
  apartments: number | null;
  apartmentsCounted: number;
  /** Строящиеся дома: доля проданного, взвешенная по квартирам, и цена за м² диапазоном (среднего нет). */
  soldShare: number | null;
  pricePerSqm: { min: number; max: number } | null;
  /** Генподрядчики всех домов, без повторов. */
  contractors: IRegistryContractor[];
  /** Самая свежая дата сведений (дата страницы, иначе дата снимка) и самый свежий снимок. */
  asOf: string;
  fetchedAt: string;
  /** Номер записи дома с фото (photoHouse); фото объекта — GET /api/projects/:id/photo. */
  photoRef: string | null;
  hasPhoto: boolean;
}

const common = (values: Array<string | null>): string | null => {
  const known = values.map(v => v?.trim() ?? '').filter(v => v !== '');
  return known.length === values.length && known.length > 0 && known.every(v => v === known[0]) ? known[0]! : null;
};

const byCompletion = (a: string, b: string): number => {
  const ka = parseCompletion(a);
  const kb = parseCompletion(b);
  return (ka ? completionKey(ka) : Number.MAX_SAFE_INTEGER) - (kb ? completionKey(kb) : Number.MAX_SAFE_INTEGER);
};

/** Свод объекта по его домам: последний снимок каждого. Пустой список — null (у объекта сведений ДОМ.РФ нет). */
export const summarizeObject = (houses: readonly IHouse[]): IObjectRegistrySummary | null => {
  if (houses.length === 0) return null;
  const latest = houses.map(latestSnapshot);
  const facts = latest.map(s => houseFacts(s.values));
  const building = facts.filter(f => !f.delivered);
  const completions = (building.length > 0 ? building : facts).map(f => f.completion).filter((c): c is string => Boolean(c)).sort(byCompletion);
  const apartments = facts.map(f => f.apartments).filter((n): n is number => n !== null);
  const sold = building.filter(f => f.soldShare !== null && f.apartments !== null && f.apartments > 0);
  const soldBase = sold.reduce((sum, f) => sum + f.apartments!, 0);
  const prices = building.map(f => f.price).filter((p): p is number => p !== null);
  const contractors = new Map<string, IRegistryContractor>();
  for (const s of latest) {
    for (const c of parseRegistryContractors(s.values.contractor)) {
      const key = c.inn ?? `name:${c.name.toLowerCase()}`;
      if (!contractors.has(key)) contractors.set(key, c);
    }
  }
  const photo = photoHouse(houses);
  const dates = latest.map(s => s.asOf ?? s.fetchedAt.slice(0, 10)).sort();
  const fetched = latest.map(s => s.fetchedAt).sort();
  return {
    sourceTitle: houses[0]!.sourceTitle,
    houses: houses.length,
    delivered: facts.length - building.length,
    inProgress: building.length,
    status: common(latest.map(s => s.values.status)),
    completion: completions.length > 0 ? { from: completions[0]!, to: completions[completions.length - 1]! } : null,
    keys: common(latest.map(s => s.values.keys)),
    propertyClass: common(latest.map(s => s.values.propertyClass)),
    floors: common(latest.map(s => s.values.floors)),
    developer: common(latest.map(s => s.developer?.name ?? s.values.developer)),
    group: common(latest.map(s => s.groupName ?? s.values.group)),
    address: common(latest.map(s => s.address)),
    apartments: apartments.length > 0 ? apartments.reduce((a, b) => a + b, 0) : null,
    apartmentsCounted: apartments.length,
    soldShare: soldBase > 0 ? sold.reduce((sum, f) => sum + f.soldShare! * f.apartments!, 0) / soldBase : null,
    pricePerSqm: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
    contractors: [...contractors.values()],
    asOf: dates[dates.length - 1]!,
    fetchedAt: fetched[fetched.length - 1]!,
    photoRef: photo?.externalRef ?? null,
    hasPhoto: photo !== null,
  };
};
