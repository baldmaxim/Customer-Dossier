// Сроки и продажи заказчика по снимкам ДОМ.РФ (этап 24E, delivery@1): по каждому дому, а не по объекту портала.
//
// Один объект портала (ЖК) бывает связан с десятками домов реестра — у каждого свой срок сдачи, статус и продажи;
// поэтому счёт ведётся по записи реестра (источник + номер дома), а объект портала — подпись. Из последнего снимка
// дома: сдан ли, срок сдачи по декларации, прошёл ли срок у несданного дома, квартиры и продажи. Из ряда снимков —
// переносы срока сдачи и продажи между снимками (только где между первым и последним снимком не меньше 30 дней).
// Снимок пишется только при изменении страницы, поэтому ряд копится с начала наблюдения, и экран называет его дату.
//
// Слова — фактами реестра: «срок сдачи по декларации прошёл, статус — строится», а не «просрочка» и не «риск»
// (ADR-009). Незнакомый формат строки — «не распознано», а не догадка (registry/values.ts). Только чтение; сводка
// «Как дела у …» (25C) берёт этот же загрузчик.

import type { DbExecutor } from '../db/pool.js';
import { domRfObjectUrl } from '../ingest/registry/domrfCards.js';
import { CUSTOMER_SIDE_ROLES } from '../api/companyBuilders.js';
import { loadCompanyObjects, loadGroupMembers } from '../api/companyObjects.js';
import type { IRegistryPayload } from './changes.js';
import { completionEnd, completionKey, parseCompletion, parseCount, parsePercent, parseRubles, parseSoldCount, type ICompletion } from './values.js';

export const DELIVERY_VERSION = 'delivery@1';
/** Окно «сдано за последнее время», месяцев. */
export const DELIVERED_WINDOW_MONTHS = 24;
/** Продажи между снимками — только на промежутке не короче. */
const MIN_SALES_SPAN_DAYS = 30;
/** Домов в списке: карточка, а не каталог; что не вошло — числом. */
const HOUSES_LIMIT = 300;

export interface IHouseSnapshot {
  fetchedAt: string;
  asOf: string | null;
  status: string | null;
  completion: string | null;
  apartments: string | null;
  soldPercent: string | null;
  soldCount: string | null;
  price: string | null;
}

export interface IHouseInput {
  externalRef: string;
  name: string;
  projectId: number | null;
  projectName: string | null;
  /** По возрастанию даты снимка. */
  snapshots: IHouseSnapshot[];
}

export interface IDeliveryShift {
  externalRef: string;
  name: string;
  from: string;
  to: string;
  /** Дата снимка, где срок сменился. */
  at: string;
  /** later — срок сдвинут позже, earlier — раньше, unknown — не распознан. */
  direction: 'later' | 'earlier' | 'unknown';
}

export interface IDeliveryHouse {
  externalRef: string;
  name: string;
  projectId: number | null;
  projectName: string | null;
  status: string | null;
  delivered: boolean;
  completion: string | null;
  completionParsed: ICompletion | null;
  /** Срок сдачи по декларации прошёл, а дом не сдан (на дату снимка). */
  pastDue: boolean;
  apartments: number | null;
  soldShare: number | null;
  price: number | null;
  /** Дата сведений: дата страницы, иначе дата снимка. */
  date: string;
  url: string;
}

export interface ICompanyDelivery {
  format: typeof DELIVERY_VERSION;
  /** Первый снимок домов компании: с этой даты видны переносы и продажи между снимками. */
  observedSince: string | null;
  houses: number;
  inProgress: { count: number; apartments: number };
  delivered: { recent: number; recentApartments: number; older: number; windowFrom: string };
  pastDue: IDeliveryHouse[];
  shifts: IDeliveryShift[];
  sales: { apartments: number; share: number | null; counted: number; price: { min: number; max: number; counted: number } | null };
  /** Продажи между первым и последним снимком дома (≥ 30 дней). */
  dynamics: { houses: number; sold: number; fromDate: string; toDate: string } | null;
  unparsed: { completion: number; apartments: number };
  list: IDeliveryHouse[];
  truncated: boolean;
}

const day = (iso: string): string => iso.slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const DELIVERED = /сдан|введ[её]н/i;

const shareOf = (s: IHouseSnapshot): number | null => {
  const counted = parseSoldCount(s.soldCount);
  if (counted) return counted.sold / counted.total;
  return parsePercent(s.soldPercent);
};

/** Чистая функция: дома с рядами снимков → сводка сроков и продаж. now — дата расчёта окна «за 24 месяца». */
export const summarizeDelivery = (houses: readonly IHouseInput[], now: Date): ICompanyDelivery => {
  const windowFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - DELIVERED_WINDOW_MONTHS, now.getUTCDate())).toISOString().slice(0, 10);
  const list: IDeliveryHouse[] = [];
  const shifts: IDeliveryShift[] = [];
  let unparsedCompletion = 0;
  let unparsedApartments = 0;
  let dynamicsSold = 0;
  let dynamicsHouses = 0;
  let dynamicsFrom: string | null = null;
  let dynamicsTo: string | null = null;
  let observedSince: string | null = null;

  for (const house of houses) {
    const first = house.snapshots[0];
    const latest = house.snapshots[house.snapshots.length - 1];
    if (!first || !latest) continue;
    if (!observedSince || day(first.fetchedAt) < observedSince) observedSince = day(first.fetchedAt);

    for (let i = 1; i < house.snapshots.length; i += 1) {
      const before = house.snapshots[i - 1]!.completion;
      const after = house.snapshots[i]!.completion;
      if (!before || !after || before === after) continue;
      const a = parseCompletion(before);
      const b = parseCompletion(after);
      // «31.03.2028» → «I кв. 2028» — тот же срок другим форматом (API и страница пишут по-разному), не перенос.
      if (a && b && completionKey(a) === completionKey(b)) continue;
      shifts.push({
        externalRef: house.externalRef,
        name: house.name,
        from: before,
        to: after,
        at: day(house.snapshots[i]!.fetchedAt),
        direction: a && b ? (completionKey(b) > completionKey(a) ? 'later' : completionKey(b) < completionKey(a) ? 'earlier' : 'unknown') : 'unknown',
      });
    }

    const firstSold = parseSoldCount(first.soldCount);
    const latestSold = parseSoldCount(latest.soldCount);
    if (house.snapshots.length > 1 && firstSold && latestSold && daysBetween(first.fetchedAt, latest.fetchedAt) >= MIN_SALES_SPAN_DAYS) {
      dynamicsSold += latestSold.sold - firstSold.sold;
      dynamicsHouses += 1;
      if (!dynamicsFrom || day(first.fetchedAt) < dynamicsFrom) dynamicsFrom = day(first.fetchedAt);
      if (!dynamicsTo || day(latest.fetchedAt) > dynamicsTo) dynamicsTo = day(latest.fetchedAt);
    }

    const date = day(latest.asOf ?? latest.fetchedAt);
    const delivered = latest.status !== null && DELIVERED.test(latest.status);
    const parsed = parseCompletion(latest.completion);
    if (latest.completion && !parsed) unparsedCompletion += 1;
    const apartments = parseCount(latest.apartments) ?? parseSoldCount(latest.soldCount)?.total ?? null;
    if (latest.apartments && apartments === null) unparsedApartments += 1;
    list.push({
      externalRef: house.externalRef,
      name: house.name,
      projectId: house.projectId,
      projectName: house.projectName,
      status: latest.status,
      delivered,
      completion: latest.completion,
      completionParsed: parsed,
      pastDue: !delivered && parsed !== null && completionEnd(parsed) < date,
      apartments,
      soldShare: shareOf(latest),
      price: parseRubles(latest.price),
      date,
      url: domRfObjectUrl(house.externalRef),
    });
  }

  const inProgress = list.filter(h => !h.delivered);
  const delivered = list.filter(h => h.delivered);
  const recent = delivered.filter(h => h.completionParsed !== null && completionEnd(h.completionParsed) >= windowFrom);
  const sold = inProgress.filter(h => h.soldShare !== null && h.apartments !== null && h.apartments > 0);
  const soldBase = sold.reduce((a, h) => a + h.apartments!, 0);
  const prices = inProgress.map(h => h.price).filter((p): p is number => p !== null);
  const byCompletion = (a: IDeliveryHouse, b: IDeliveryHouse): number =>
    (a.completionParsed ? completionKey(a.completionParsed) : Number.MAX_SAFE_INTEGER) - (b.completionParsed ? completionKey(b.completionParsed) : Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name, 'ru');
  // Порядок списка: срок прошёл, строится по сроку, сданные — свежие сверху.
  const ordered = [
    ...inProgress.filter(h => h.pastDue).sort(byCompletion),
    ...inProgress.filter(h => !h.pastDue).sort(byCompletion),
    ...delivered.sort((a, b) => -byCompletion(a, b)),
  ];

  return {
    format: DELIVERY_VERSION,
    observedSince,
    houses: list.length,
    inProgress: { count: inProgress.length, apartments: inProgress.reduce((a, h) => a + (h.apartments ?? 0), 0) },
    delivered: { recent: recent.length, recentApartments: recent.reduce((a, h) => a + (h.apartments ?? 0), 0), older: delivered.length - recent.length, windowFrom },
    pastDue: inProgress.filter(h => h.pastDue).sort(byCompletion),
    shifts: shifts.sort((a, b) => b.at.localeCompare(a.at)),
    sales: {
      apartments: soldBase,
      share: soldBase > 0 ? sold.reduce((a, h) => a + h.soldShare! * h.apartments!, 0) / soldBase : null,
      counted: sold.length,
      price: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices), counted: prices.length } : null,
    },
    dynamics: dynamicsHouses > 0 && dynamicsFrom && dynamicsTo ? { houses: dynamicsHouses, sold: dynamicsSold, fromDate: dynamicsFrom, toDate: dynamicsTo } : null,
    unparsed: { completion: unparsedCompletion, apartments: unparsedApartments },
    list: ordered.slice(0, HOUSES_LIMIT),
    truncated: ordered.length > HOUSES_LIMIT,
  };
};

const field = (payload: IRegistryPayload, ...labels: string[]): string | null => {
  for (const label of labels) {
    const found = payload.fields.find(f => f.label === label && f.value.trim() !== '');
    if (found) return found.value;
  }
  return null;
};

const HOUSES_SQL = `
  SELECT r.external_ref AS "externalRef", r.project_id AS "projectId", p.name AS "projectName",
         r.fetched_at AS "fetchedAt", r.as_of AS "asOf", r.payload
  FROM registry_records r
  LEFT JOIN projects p ON p.id = r.project_id
  WHERE r.record_type = 'object' AND (r.project_id = ANY($1::bigint[]) OR r.company_id = ANY($2::bigint[]))
  ORDER BY r.source_id, r.external_ref, r.fetched_at, r.id`;

/** Дома компании: объекты, где она или СЗ её группы — заказчик, застройщик или инвестор, и дома, чей застройщик — она. */
export const loadCompanyDelivery = async (db: DbExecutor, companyId: number, now: Date = new Date()): Promise<ICompanyDelivery> => {
  const [objects, members] = await Promise.all([loadCompanyObjects(companyId), loadGroupMembers(companyId)]);
  const projectIds = objects.items
    .filter(o => o.basis === 'participation' && o.roles.some(r => CUSTOMER_SIDE_ROLES.has(r.role)))
    .map(o => o.projectId);
  const companyIds = [companyId, ...members.map(m => m.companyId)];
  const rows = (
    await db.query<{ externalRef: string; projectId: number | null; projectName: string | null; fetchedAt: Date; asOf: string | Date | null; payload: IRegistryPayload }>(
      HOUSES_SQL,
      [projectIds, companyIds],
    )
  ).rows;

  const houses = new Map<string, IHouseInput>();
  for (const row of rows) {
    const house = houses.get(row.externalRef) ?? {
      externalRef: row.externalRef,
      name: row.payload.identity?.name ?? row.externalRef,
      projectId: row.projectId,
      projectName: row.projectName,
      snapshots: [],
    };
    houses.set(row.externalRef, house);
    const asOf = row.asOf instanceof Date ? row.asOf.toISOString().slice(0, 10) : row.asOf;
    house.snapshots.push({
      fetchedAt: row.fetchedAt.toISOString(),
      asOf,
      status: field(row.payload, 'Статус строительства'),
      completion: field(row.payload, 'Сдача дома', 'Срок сдачи'),
      apartments: field(row.payload, 'Количество квартир'),
      soldPercent: field(row.payload, 'Продано квартир', 'Распроданность квартир'),
      soldCount: field(row.payload, 'Продано квартир, количество'),
      price: field(row.payload, 'Средняя цена за 1 м²', 'Средняя цена за м2'),
    });
  }
  return summarizeDelivery([...houses.values()], now);
};
