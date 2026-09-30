// Числа для людей. Даты и деньги — в labels.ts (formatDate, formatPostDate, formatDateTime,
// formatMoney): здесь их не дублируем.

const COUNT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const PLURAL = new Intl.PluralRules('ru-RU');

/**
 * Счётчик с разделителем тысяч: 24817 → «24 817». Разделитель — неразрывный пробел
 * (так форматирует ru-RU), поэтому число не рвётся на две строки и не читается как два.
 */
export const formatCount = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : COUNT.format(value);

/** Формы слова: [одна, две, пять] — «компания», «компании», «компаний». */
export type PluralForms = readonly [one: string, few: string, many: string];

export const pluralize = (value: number, forms: PluralForms): string => {
  const rule = PLURAL.select(Math.abs(value));
  if (rule === 'one') return forms[0];
  if (rule === 'few') return forms[1];
  return forms[2];
};

/** «24 817 компаний», «1 объект», «3 публикации». */
export const formatCountWord = (value: number, forms: PluralForms): string =>
  `${formatCount(value)} ${pluralize(value, forms)}`;

/** Длительность словами: «0,8 с», «42 с», «3 мин 05 с», «1 ч 12 мин». */
export const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${(ms / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} с`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} с`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  // Ровные минуты — без «00 с»: это длительность, а не показания часов.
  if (min < 60) return sec === 0 ? `${min} мин` : `${min} мин ${sec} с`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
};
