// Сводка портфеля по сведениям ДОМ.РФ — из уже загруженного списка объектов карточки (вкладка «Объекты»),
// без запроса и без модели. Каждое число — со знаменателем: по скольким объектам со сведениями посчитано
// и сколько не распознано (registryValues: незнакомый формат — null, в сумму не входит). Суммируются только
// квартиры; распроданность — взвешенная по квартирам (Σ квартир × доля / Σ квартир) по объектам, где
// разобраны оба значения; цена — диапазон, среднего нет: средняя цена разных классов и городов ничего
// не значит. Объекты застройщиков группы («через СЗ») входят и считаются отдельно (viaGroup).

import type { ICompanyObject, ICompanyObjectsResponse } from '../../api/types';
import { parseCompletion, parseCount, parsePercent, parseRubles } from '../../lib/registryValues';

export interface IPortfolio {
  /** Объектов у карточки всего (включая не вошедшие в выборку). */
  total: number;
  /** Со сведениями ДОМ.РФ в выборке. */
  withRegistry: number;
  /** Из них — объекты застройщиков группы. */
  viaGroup: number;
  /** Выборка объектов урезана сервером: числа — по загруженным. */
  truncated: boolean;
  /** Даты сведений (asOf, иначе дата получения): самая ранняя и поздняя, YYYY-MM-DD. */
  asOf: { from: string; to: string } | null;
  statuses: Array<{ label: string; count: number }>;
  completion: { byYear: Array<{ year: number; count: number }>; unparsed: number; missing: number };
  apartments: { sum: number; counted: number; unparsed: number };
  sold: { share: number | null; counted: number };
  price: { min: number; max: number; counted: number } | null;
}

const NO_STATUS = 'статус не указан';

const dayOf = (value: string): string => value.slice(0, 10);

export const summarizePortfolio = (data: Pick<ICompanyObjectsResponse, 'items' | 'coverage'>): IPortfolio => {
  const registered = data.items.filter((o): o is ICompanyObject & { registry: NonNullable<ICompanyObject['registry']> } => o.registry !== null);
  const statuses = new Map<string, number>();
  const years = new Map<number, number>();
  let completionUnparsed = 0;
  let completionMissing = 0;
  let apartmentsSum = 0;
  let apartmentsCounted = 0;
  let apartmentsUnparsed = 0;
  let soldWeighted = 0;
  let soldBase = 0;
  let soldCounted = 0;
  const prices: number[] = [];
  const dates: string[] = [];

  for (const o of registered) {
    const r = o.registry;
    const status = r.status?.trim() || NO_STATUS;
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    dates.push(dayOf(r.asOf ?? r.fetchedAt));

    if (!r.completion) completionMissing += 1;
    else {
      const c = parseCompletion(r.completion);
      if (c) years.set(c.year, (years.get(c.year) ?? 0) + 1);
      else completionUnparsed += 1;
    }

    const apartments = parseCount(r.apartments);
    if (apartments !== null) {
      apartmentsSum += apartments;
      apartmentsCounted += 1;
    } else if (r.apartments) apartmentsUnparsed += 1;

    const sold = parsePercent(r.sold);
    if (sold !== null && apartments !== null && apartments > 0) {
      soldWeighted += sold * apartments;
      soldBase += apartments;
      soldCounted += 1;
    }

    const price = parseRubles(r.pricePerSqm);
    if (price !== null) prices.push(price);
  }

  dates.sort();
  return {
    total: data.coverage.total,
    withRegistry: registered.length,
    viaGroup: registered.filter(o => o.via !== null).length,
    truncated: data.coverage.truncated,
    asOf: dates.length > 0 ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    statuses: [...statuses.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    completion: {
      byYear: [...years.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
      unparsed: completionUnparsed,
      missing: completionMissing,
    },
    apartments: { sum: apartmentsSum, counted: apartmentsCounted, unparsed: apartmentsUnparsed },
    sold: { share: soldBase > 0 ? soldWeighted / soldBase : null, counted: soldCounted },
    price: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices), counted: prices.length } : null,
  };
};
