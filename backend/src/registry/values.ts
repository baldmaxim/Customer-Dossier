// Разбор строк ДОМ.РФ в числа на сервере (этап 24E): «472», «45 %», «120 квартир из 472», «933 425 ₽», «IV кв. 2027».
//
// Единственный разбор строк ДОМ.РФ (07.10.2026: копия на экране, frontend/src/lib/registryValues.ts, удалена — свод
// объекта, сроки и продажи считаются на сервере, registry/houses.ts и registry/delivery.ts). Правило одно: незнакомый
// формат — null, а не догадка; в сумму такое значение не входит, экран говорит «не распознано: N».

/** Пробелы-разделители разрядов: обычный, неразрывный, узкий неразрывный. */
const SPACES = /[\s  ]+/g;

const toNumber = (digits: string): number | null => {
  const value = Number(digits.replace(SPACES, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

/** «472», «1 024» → число; «472 кв.», «около 500» — null. */
export const parseCount = (raw: string | null | undefined): number | null => {
  const s = raw?.trim();
  if (!s || !/^\d{1,3}(?:[\s  ]?\d{3})*$/.test(s)) return null;
  return toNumber(s);
};

/** «45 %», «45,3%» → 0.45; вне 0..100 % — null. */
export const parsePercent = (raw: string | null | undefined): number | null => {
  const m = raw?.trim() ? /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(raw.trim()) : null;
  if (!m) return null;
  const value = toNumber(m[1]!);
  return value !== null && value >= 0 && value <= 100 ? value / 100 : null;
};

/** «120 квартир из 472» → { sold: 120, total: 472 }; часть больше целого — null. */
export const parseSoldCount = (raw: string | null | undefined): { sold: number; total: number } | null => {
  const m = raw?.trim() ? /^(\d[\d\s  ]*)\s+квартир\S*\s+из\s+(\d[\d\s  ]*)$/i.exec(raw.trim()) : null;
  if (!m) return null;
  const sold = toNumber(m[1]!);
  const total = toNumber(m[2]!);
  return sold !== null && total !== null && total > 0 && sold <= total ? { sold, total } : null;
};

/** «933 425 ₽», «1 554 843 руб.» → рубли; «от 300 000 ₽» — null. */
export const parseRubles = (raw: string | null | undefined): number | null => {
  const s = raw?.trim();
  const m = s ? /^(\d{1,3}(?:[\s  ]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)?$/i.exec(s) : null;
  if (!m) return null;
  const value = toNumber(m[1]!);
  return value !== null && value > 0 ? value : null;
};

export interface ICompletion {
  year: number;
  /** 1..4; null — срок назван только годом. */
  quarter: number | null;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

/** Срок сдачи: «IV кв. 2027», «4 квартал 2026», «30.09.2028», «2027 г.» → год и квартал; «Сдан» — null. */
export const parseCompletion = (raw: string | null | undefined): ICompletion | null => {
  const s = raw?.trim().replace(SPACES, ' ');
  if (!s) return null;
  const quarter = /^(IV|I{1,3}|[1-4])\s*(?:-?й\s*)?(?:кв\.?|квартал)\s*(\d{4})(?:\s*г\.?)?$/i.exec(s);
  if (quarter) {
    const q = ROMAN[quarter[1]!.toUpperCase()] ?? Number(quarter[1]);
    return { year: Number(quarter[2]), quarter: q };
  }
  const date = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (date) {
    const month = Number(date[2]);
    return month >= 1 && month <= 12 ? { year: Number(date[3]), quarter: Math.ceil(month / 3) } : null;
  }
  const year = /^(\d{4})(?:\s*г\.?)?$/.exec(s);
  return year ? { year: Number(year[1]), quarter: null } : null;
};

/** Последний день срока: конец квартала, а если назван только год — 31 декабря. YYYY-MM-DD. */
export const completionEnd = (c: ICompletion): string => {
  const month = c.quarter === null ? 12 : c.quarter * 3;
  return new Date(Date.UTC(c.year, month, 0)).toISOString().slice(0, 10);
};

/** Сравнимый ключ срока: год × 4 + квартал (год без квартала — как IV квартал). */
export const completionKey = (c: ICompletion): number => c.year * 4 + (c.quarter ?? 4);

/**
 * Сменился ли срок сдачи между двумя строками снимка — одно правило для «Сроков и продаж», «Нового» и истории изменений
 * паспорта. Нет одной из строк, тот же текст или тот же квартал другим форматом («31.03.2028» → «I кв. 2028»: API и
 * страница пишут по-разному) — не перенос (null). Направление — по ключу срока; не распознана строка — unknown.
 */
export const completionChange = (before: string | null | undefined, after: string | null | undefined): { direction: 'later' | 'earlier' | 'unknown' } | null => {
  if (!before || !after || before === after) return null;
  const a = parseCompletion(before);
  const b = parseCompletion(after);
  if (a && b && completionKey(a) === completionKey(b)) return null;
  if (!a || !b) return { direction: 'unknown' };
  return { direction: completionKey(b) > completionKey(a) ? 'later' : 'earlier' };
};
