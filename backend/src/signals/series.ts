// signals@3: ряды по календарным месяцам — публикации и события за 24 месяца по месяц среза включительно.
// Чистые функции; «сейчас» — только явный срез. Месяц — по UTC, как и окно публикаций 90 дней: пост около
// полуночи по Москве может попасть в соседний месяц, и это сказано в тексте правила.
//
// Ряд — это IAggregate (value — сумма месяцев, ids — учтённые id, denominator — всё рассмотренное) плюс
// месяцы и счётчики того, что не вошло и почему. Инвариант: value = Σ месяцев, denominator = value + Σ
// excluded. id по месяцам не храним — они на итоге (drilldown показывает, из каких публикаций ряд).

import { aggregate, isoDate } from './intervals.js';
import type { IMonthlySeries, IWindow } from './types.js';

export const SERIES_MONTHS = 24;

/** Ключи месяцев «YYYY-MM» по возрастанию, последний — месяц среза. */
export const monthKeys = (cutoff: Date, months: number = SERIES_MONTHS): string[] => {
  const year = cutoff.getUTCFullYear();
  const month = cutoff.getUTCMonth();
  return Array.from({ length: months }, (_, i) => new Date(Date.UTC(year, month - (months - 1 - i), 1)).toISOString().slice(0, 7));
};

/** Месяц среза не закончился: дата среза раньше последнего дня месяца. */
export const isPartialMonth = (cutoff: Date): boolean => {
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0));
  return isoDate(cutoff) < isoDate(lastDay);
};

export interface ISeriesItem {
  id: number;
  /** Дата (YYYY-MM-DD или ISO-время); null — даты нет. */
  date: string | null;
  /** Дата грубее месяца (квартал, год): в месяц не раскладывается. */
  coarse?: boolean;
  /** Снимок реестра: его дата — дата сбора, а не публикации. */
  registry?: boolean;
}

export const monthlySeries = (items: readonly ISeriesItem[], cutoff: Date, rule: string, basis: IWindow['basis']): IMonthlySeries => {
  const keys = monthKeys(cutoff);
  const index = new Map(keys.map((k, i) => [k, i] as const));
  const counts = keys.map(() => 0);
  const excluded = { undated: 0, beforeWindow: 0, future: 0, coarse: 0, registry: 0 };
  const counted: number[] = [];
  const to = isoDate(cutoff);

  for (const item of items) {
    if (item.registry) excluded.registry += 1;
    else if (!item.date) excluded.undated += 1;
    else if (item.coarse) excluded.coarse += 1;
    else {
      const day = item.date.slice(0, 10);
      const slot = index.get(day.slice(0, 7));
      if (day > to) excluded.future += 1;
      else if (slot === undefined) excluded.beforeWindow += 1;
      else {
        counts[slot]! += 1;
        counted.push(item.id);
      }
    }
  }

  const window: IWindow = { from: `${keys[0]}-01`, to, basis };
  const base = aggregate(counted, rule, { window, denominator: items.length });
  return {
    ...base,
    ...(items.length === 0 ? { value: null, status: 'insufficient_data' as const } : {}),
    buckets: keys.map((month, i) => ({ month, value: counts[i]! })),
    excluded,
    partialLast: isPartialMonth(cutoff),
  };
};
