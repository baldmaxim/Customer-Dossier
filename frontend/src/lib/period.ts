// Даты сведений — с той точностью, которую подтверждает цитата (ADR-008). «С марта 2024» сервер
// хранит как 2024-03-01 с точностью «месяц»: печатать «01.03.2024» значит выдумать день.

import { formatDate } from './labels';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** «01.03.2024» · «03.2024» · «1 кв. 2024» · «2024» — по точности; без даты — пустая строка. */
export const formatPreciseDate = (iso: string | null | undefined, precision: string | null | undefined = 'day'): string => {
  if (!iso) return '';
  const match = ISO_DAY.exec(iso);
  if (!match) return formatDate(iso);
  const year = match[1] ?? '';
  const month = match[2] ?? '';
  const day = match[3] ?? '';
  switch (precision) {
    case 'year':
      return year;
    case 'quarter':
      return `${Math.floor((Number(month) - 1) / 3) + 1} кв. ${year}`;
    case 'month':
      return `${month}.${year}`;
    default:
      return `${day}.${month}.${year}`;
  }
};

/** «с 03.2024 по 12.2025», «с 03.2024», «по 12.2025»; периода нет — пустая строка (подпись решает вызывающий). */
export const formatPeriod = (
  from: string | null | undefined,
  to: string | null | undefined,
  precision: string | null | undefined = 'day',
): string => {
  const start = formatPreciseDate(from, precision);
  const end = formatPreciseDate(to, precision);
  if (start && end) return `с ${start} по ${end}`;
  if (start) return `с ${start}`;
  if (end) return `по ${end}`;
  return '';
};
