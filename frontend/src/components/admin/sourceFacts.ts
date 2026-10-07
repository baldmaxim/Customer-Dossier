// Короткие сведения об источнике для строки таблицы и карточки «Источников»: адрес и одна
// строка «24 817 публ. · 30.09, 11:58 · +3 новых». Полностью — в подсказке и в «Подробнее».

import type { ISourceRow } from '../../api/types';
import { formatCount, pluralize, type PluralForms } from '../../lib/format';
import { HISTORY_STOP_LABELS, SOURCE_HEALTH_STATE_LABELS, formatDateTime, formatShortDateTime } from '../../lib/labels';
import { SOURCE_HEALTH_STATE_TONE, toneOf, type StatusTone } from '../../lib/statusTone';
import { isSourceEnabled } from './useSourceActions';

const NEW_FORMS: PluralForms = ['новая', 'новые', 'новых'];

/** Адрес без протокола: «t.me/имя», «erzrf.ru». У ручных способов адреса нет. */
export const sourceAddress = (s: ISourceRow): string | null =>
  s.kind === 'telegram' ? `t.me/${s.key}` : s.kind === 'website' ? s.key : null;

/** Где открыть канал или сайт — сверить, что это тот самый. */
export const sourceHref = (s: ISourceRow): string | null => {
  const address = sourceAddress(s);
  return address ? `https://${address}` : null;
};

/** Короткая дата строки источника — общим форматтером словаря. */
export const shortDateTime = formatShortDateTime;

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

/**
 * Состояние источника словами и тоном — одно для строки таблицы и окна «Подробнее» (07.10.2026: строка решала «выключен»
 * по допуску, а окно показывало серверный healthState и вторым ярлыком старое поле health). Выключенный оператором —
 * нейтрально «выключен», а не поломка; включённый — по healthState сервера (source-health@1).
 */
export const sourceStateView = (source: ISourceRow): { enabled: boolean; label: string; tone: StatusTone; reason: string | null } => {
  const enabled = isSourceEnabled(source);
  if (!enabled) return { enabled, label: 'выключен', tone: 'neutral', reason: null };
  const state = source.healthState?.state ?? 'never_run';
  return { enabled, label: SOURCE_HEALTH_STATE_LABELS[state] ?? 'состояние неизвестно', tone: toneOf(SOURCE_HEALTH_STATE_TONE, state), reason: source.healthState?.reason ?? null };
};
