// Короткие сведения об источнике для строки таблицы и карточки «Источников»: адрес и одна
// строка «24 817 публ. · 30.09, 11:58 · +3 новых». Полностью — в подсказке и в «Подробнее».

import type { ISourceRow } from '../../api/types';
import { formatCount, pluralize, type PluralForms } from '../../lib/format';
import { HISTORY_STOP_LABELS, formatDateTime } from '../../lib/labels';

const NEW_FORMS: PluralForms = ['новая', 'новые', 'новых'];

/** Адрес без протокола: «t.me/имя», «erzrf.ru». У ручных способов адреса нет. */
export const sourceAddress = (s: ISourceRow): string | null =>
  s.kind === 'telegram' ? `t.me/${s.key}` : s.kind === 'website' ? s.key : null;

/** Где открыть канал или сайт — сверить, что это тот самый. */
export const sourceHref = (s: ISourceRow): string | null => {
  const address = sourceAddress(s);
  return address ? `https://${address}` : null;
};

/** «30.09, 11:58»; не в текущем году — «30.09.25, 11:58». */
export const shortDateTime = (iso: string | null | undefined, now: Date = new Date()): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' as const }),
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Новых в последнем проходе: сохранённые записи, у старых проходов — «новых из увиденных». */
const lastNew = (s: ISourceRow): number | null => s.lastSaved ?? s.lastItemsNew ?? null;

/** Одна строка: сколько собрано, когда был последний сбор, сколько в нём нового (ноль не пишем). */
export const sourceStatsLine = (s: ISourceRow): string => {
  const fresh = lastNew(s);
  return [
    s.items !== undefined ? `${formatCount(s.items)} публ.` : null,
    s.lastAttemptAt ? shortDateTime(s.lastAttemptAt) : null,
    s.lastAttemptAt && fresh ? `+${formatCount(fresh)} ${pluralize(fresh, NEW_FORMS)}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
};

/** То же полными словами — подсказка по наведению на строку сведений. */
export const sourceStatsTitle = (s: ISourceRow): string => {
  const fresh = lastNew(s);
  return [
    s.items !== undefined ? `публикаций ${formatCount(s.items)}` : null,
    s.lastAttemptAt ? `последний сбор ${formatDateTime(s.lastAttemptAt)}` : null,
    s.lastAttemptAt && fresh !== null ? `новых в нём ${formatCount(fresh)}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
};

/** Где сбор истории, если задан срок: «история догружается», «собрано за весь срок». */
export const historyNote = (s: ISourceRow): string | null => {
  if (s.historyDays === null || s.historyDays === undefined) return null;
  const stop = typeof s.lastCoverage?.stopReason === 'string' ? s.lastCoverage.stopReason : null;
  return stop ? (HISTORY_STOP_LABELS[stop] ?? null) : null;
};
