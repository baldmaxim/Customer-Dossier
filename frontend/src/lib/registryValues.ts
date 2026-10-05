// Разбор строк ДОМ.РФ в числа для портфеля объектов (05.10.2026). Сервер отдаёт значения полей так, как
// они стоят на странице («472», «933 425 ₽», «IV кв. 2027», «45 %»), — разбирает только экран и только
// для сводки. Правило одно: незнакомый формат — null, а не догадка. Объект с неразобранным значением в
// сумму не входит, и сводка говорит «не распознано: N»; подгонять число по похожей строке нельзя —
// ошибка в сторону «не знаем», а не в сторону выдуманного.

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

/** «45 %», «45,3%» → 0.45 / 0.453; «120 из 472» → 120/472. Вне 0..100 % — null. */
export const parsePercent = (raw: string | null | undefined): number | null => {
  const s = raw?.trim();
  if (!s) return null;
  const pct = /^(\d{1,3}(?:[.,]\d+)?)\s*%$/.exec(s);
  if (pct) {
    const value = toNumber(pct[1]!);
    return value !== null && value >= 0 && value <= 100 ? value / 100 : null;
  }
  const ofTotal = /^(\d[\d\s  ]*)\s+из\s+(\d[\d\s  ]*)$/.exec(s);
  if (ofTotal) {
    const part = toNumber(ofTotal[1]!);
    const whole = toNumber(ofTotal[2]!);
    return part !== null && whole !== null && whole > 0 && part <= whole ? part / whole : null;
  }
  return null;
};

/** «933 425 ₽», «1 554 843 руб.», «180000 р.» → рубли; «от 300 000 ₽», «$100» — null. */
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
