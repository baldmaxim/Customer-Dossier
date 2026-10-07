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
//
// Дома, подписи полей и разбор сведений дома — общие с карточкой объекта (registry/houses.ts), перенос срока — одно
// правило с «Новым» и историей паспорта (values.ts::completionChange). С 07.10.2026 блок заменяет и прежний «Объекты по
// данным ДОМ.РФ» (свод на клиенте по одному снимку на объект): статусы и сроки по годам — здесь же.

import type { DbExecutor } from '../db/pool.js';
import { domRfObjectUrl } from '../ingest/registry/domrfCards.js';
import { CUSTOMER_SIDE_ROLES } from '../api/companyBuilders.js';
import { loadCompanyObjects, loadGroupMembers } from '../api/companyObjects.js';
import { houseFacts, latestSnapshot, loadHouses } from './houses.js';
import { completionChange, completionEnd, completionKey, parseCompletion, parseSoldCount, type ICompletion } from './values.js';

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
  /** Ключ дома (источник + номер записи); без ключа — номер записи. */
  key?: string;
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
  /** Статусы домов словами сайта, по числу домов. */
  statuses: Array<{ label: string; count: number }>;
  /** Срок сдачи строящихся домов по годам (распознанные). */
  completionByYear: Array<{ year: number; count: number }>;
  list: IDeliveryHouse[];
  truncated: boolean;
}

const day = (iso: string): string => iso.slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
/** Снимок для «Сроков и продаж» → поля дома по таблице подписей (houses.ts::houseFacts). */
const factsOf = (s: IHouseSnapshot) =>
  houseFacts({
    status: s.status,
    completion: s.completion,
    apartments: s.apartments,
    soldPercent: s.soldPercent,
    soldCount: s.soldCount,
    price: s.price,
    keys: null,
    propertyClass: null,
    floors: null,
    contractor: null,
    developer: null,
    group: null,
  });

/** Значения по числу вхождений: больше — раньше, при равенстве — по значению. */
const countBy = <T extends string | number>(values: readonly T[]): Array<[T, number]> => {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ru'));
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
      // «31.03.2028» → «I кв. 2028» — тот же срок другим форматом, не перенос (одно правило с «Новым»).
      const change = completionChange(before, after);
      if (!change) continue;
      shifts.push({ externalRef: house.externalRef, name: house.name, from: before!, to: after!, at: day(house.snapshots[i]!.fetchedAt), direction: change.direction });
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
    const facts = factsOf(latest);
    const delivered = facts.delivered;
    const parsed = parseCompletion(latest.completion);
    if (latest.completion && !parsed) unparsedCompletion += 1;
    const apartments = facts.apartments;
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
      soldShare: facts.soldShare,
      price: facts.price,
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
    statuses: countBy(list.map(h => h.status?.trim() || 'статус не указан')).map(([label, count]) => ({ label, count })),
    completionByYear: countBy(inProgress.flatMap(h => (h.completionParsed ? [h.completionParsed.year] : [])))
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    list: ordered.slice(0, HOUSES_LIMIT),
    truncated: ordered.length > HOUSES_LIMIT,
  };
};

/** Дома компании: объекты, где она или СЗ её группы — заказчик, застройщик или инвестор, и дома, чей застройщик — она. */
export const loadCompanyDelivery = async (db: DbExecutor, companyId: number, now: Date = new Date()): Promise<ICompanyDelivery> => {
  const [objects, members] = await Promise.all([loadCompanyObjects(companyId), loadGroupMembers(companyId)]);
  const projectIds = objects.items
    .filter(o => o.basis === 'participation' && o.roles.some(r => CUSTOMER_SIDE_ROLES.has(r.role)))
    .map(o => o.projectId);
  const companyIds = [companyId, ...members.map(m => m.companyId)];
  const houses = await loadHouses(db, { projectIds, companyIds }, 'history');
  return summarizeDelivery(
    houses.map(h => {
      const latest = latestSnapshot(h);
      return {
        key: h.key,
        externalRef: h.externalRef,
        name: latest.name,
        projectId: latest.projectId,
        projectName: h.projectName,
        snapshots: h.snapshots.map(snap => ({
          fetchedAt: snap.fetchedAt,
          asOf: snap.asOf,
          status: snap.values.status,
          completion: snap.values.completion,
          apartments: snap.values.apartments,
          soldPercent: snap.values.soldPercent,
          soldCount: snap.values.soldCount,
          price: snap.values.price,
        })),
      };
    }),
    now,
  );
};
