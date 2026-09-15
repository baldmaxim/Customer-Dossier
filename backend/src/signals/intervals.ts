// Даты и окна сигналов. «Сейчас» — только явный срез (cutoff), никогда не системные часы внутри правил.

import type { EventDateStatus, IAggregate, IWindow } from './types.js';

export const IDS_LIMIT = 200;

const DAY = 86_400_000;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Окно [cutoff − days, cutoff] по датам (включительно). */
export const windowDays = (cutoff: Date, days: number, basis: IWindow['basis']): IWindow => ({
  from: isoDate(new Date(cutoff.getTime() - days * DAY)),
  to: isoDate(cutoff),
  basis,
});

/** Окно в месяцах назад от среза: 12 месяцев — та же дата год назад. */
export const windowMonths = (cutoff: Date, months: number, basis: IWindow['basis']): IWindow => {
  const from = new Date(cutoff);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from: isoDate(from), to: isoDate(cutoff), basis };
};

/**
 * Положение события относительно окна:
 *  - undated — даты нет: в окно не входит никогда (не «сегодня»);
 *  - future — начало позже среза;
 *  - in_window — интервал целиком в окне;
 *  - boundary — интервал пересекает границу окна (месяц, квартал или год частично вне окна) — входит с меткой неопределённости;
 *  - before_window — целиком раньше окна.
 */
export const dateStatus = (validFrom: string | null, validTo: string | null, window: IWindow): EventDateStatus => {
  if (!validFrom) return 'undated';
  const to = validTo ?? validFrom;
  if (validFrom > window.to) return 'future';
  if (to < window.from) return 'before_window';
  if (validFrom >= window.from && to <= window.to) return 'in_window';
  return 'boundary';
};

export type Overlap = 'overlaps' | 'no_overlap' | 'unknown';

/**
 * Пересечение периода участия и события. Открытый конец участия — продолжается;
 * неизвестное начало участия — «неизвестно», если событие не позже известного конца.
 * Пересечение — контекст, а не причинность.
 */
export const overlap = (
  participation: { validFrom: string | null; validTo: string | null },
  event: { validFrom: string | null; validTo: string | null },
): Overlap => {
  if (!event.validFrom) return 'unknown';
  const eventTo = event.validTo ?? event.validFrom;
  if (participation.validTo && event.validFrom > participation.validTo) return 'no_overlap';
  if (!participation.validFrom) return 'unknown';
  if (eventTo < participation.validFrom) return 'no_overlap';
  return 'overlaps';
};

export const aggregate = (
  ids: readonly number[],
  rule: string,
  options: { window?: IWindow | null; denominator?: number | null; insufficientWhenZero?: boolean } = {},
): IAggregate => {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  const insufficient = options.insufficientWhenZero === true && unique.length === 0;
  return {
    value: insufficient ? null : unique.length,
    status: insufficient ? 'insufficient_data' : 'ok',
    rule,
    window: options.window ?? null,
    denominator: options.denominator ?? null,
    ids: unique.slice(0, IDS_LIMIT),
    idsTruncated: unique.length > IDS_LIMIT,
  };
};

/** Доля: при нулевом знаменателе — insufficient_data и null, не 0 % и не 100 %. */
export const share = (numeratorIds: readonly number[], denominator: number, rule: string): IAggregate => {
  const base = aggregate(numeratorIds, rule, { denominator });
  if (denominator === 0) return { ...base, value: null, status: 'insufficient_data' };
  return { ...base, value: Math.round((base.ids.length / denominator) * 1000) / 1000 };
};
