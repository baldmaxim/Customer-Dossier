// Даты публикаций сайтов (этап 05A). Правило записано, а не угадывается:
//
//  - ISO 8601 / RFC 2822 с зоной — exact;
//  - «12.09.2026 10:30», «2026-09-12 10:30», «12 сентября 2026, 10:30» без зоны — время
//    в зоне профиля источника (local_tz);
//  - «12.09.2026», «12 сентября 2026» — начало суток в зоне профиля (date_only);
//  - «12 сентября» без года — дата НЕ выставляется (no_year): год не подставляется;
//  - «сегодня», «вчера», «2 часа назад» — дата не выставляется (relative);
//  - остальное — unparsed. Сырой текст сохраняется всегда.

import type { PublishedAtPrecision } from '../../revisions/store.js';

export interface IParsedDate {
  date: Date | null;
  precision: PublishedAtPrecision;
  raw: string;
}

const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

/** Смещение зоны в минутах для даты (учитывает правила зоны, в т. ч. историю). */
const zoneOffsetMinutes = (utcGuess: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utcGuess);
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcGuess.getTime()) / 60_000);
};

/** Местное время зоны → момент UTC. */
export const zonedToUtc = (y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (guess.getUTCDate() !== d) return null; // 31 февраля
  const offset = zoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60_000);
};

export const parseSiteDate = (rawInput: string | null | undefined, timeZone: string): IParsedDate => {
  const raw = (rawInput ?? '').replace(/\s+/g, ' ').trim();
  if (raw === '') return { date: null, precision: 'unparsed', raw };
  const lower = raw.toLowerCase();

  if (/сегодня|вчера|позавчера|назад|только что/.test(lower)) return { date: null, precision: 'relative', raw };

  // ISO с зоной (Z или ±hh:mm) либо RFC 2822 со смещением/GMT.
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2}(\.\d+)?)?(z|[+-]\d{2}:?\d{2})$/i.test(raw) || /(gmt|utc|[+-]\d{4})$/i.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return { date: d, precision: 'exact', raw };
  }

  const time = /(\d{1,2}):(\d{2})/.exec(raw);
  const hour = time ? Number(time[1]) : 0;
  const minute = time ? Number(time[2]) : 0;
  const withTime = (y: number, mo: number, d: number): IParsedDate => {
    const date = zonedToUtc(y, mo, d, hour, minute, timeZone);
    return date ? { date, precision: time ? 'local_tz' : 'date_only', raw } : { date: null, precision: 'unparsed', raw };
  };

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2}))?/i.exec(raw);
  if (iso) return withTime(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dotted = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(raw);
  if (dotted) return withTime(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]));

  const worded = /(\d{1,2})\s+([а-яё]+)\.?(?:\s+(\d{4}))?/i.exec(lower);
  if (worded) {
    const month = MONTHS[(worded[2] ?? '').slice(0, 3)];
    if (month) {
      if (!worded[3]) return { date: null, precision: 'no_year', raw };
      return withTime(Number(worded[3]), month, Number(worded[1]));
    }
  }

  return { date: null, precision: 'unparsed', raw };
};
