// Значения утверждения, проверяемые по его собственной цитате: даты с точностью, сумма с
// валютой и привязкой к стороне, корпус, пакет работ, номер дела.
//
// Всё, что не подтверждается цитатой, становится null, а не «ближайшим правдоподобным».

import { isNameInQuote } from '../../pipeline/verify.js';

const nfc = (s: string): string => s.normalize('NFC').replace(/ё/g, 'е').replace(/Ё/g, 'Е');

// ---------------------------------------------------------------------------
// Даты

export type DatePrecision = 'day' | 'month' | 'quarter' | 'year';

export interface IGroundedPeriod {
  from: string | null;
  to: string | null;
  precision: DatePrecision | 'unknown';
}

const RANK: Record<DatePrecision, number> = { year: 0, quarter: 1, month: 2, day: 3 };
const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма[йяе](?![\\p{L}])', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];

const pad = (n: number): string => String(n).padStart(2, '0');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

interface IParsedDate {
  year: number;
  month: number | null;
  day: number | null;
  quarter: number | null;
  precision: DatePrecision;
}

export const parseDateValue = (raw: string | null): IParsedDate | null => {
  if (!raw) return null;
  const v = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (month < 1 || month > 12 || day < 1 || day > lastDay(year, month)) return null;
    return { year, month, day, quarter: null, precision: 'day' };
  }
  m = /^(\d{4})-(\d{2})$/.exec(v);
  if (m) {
    const [year, month] = [Number(m[1]), Number(m[2])];
    return month >= 1 && month <= 12 ? { year, month, day: null, quarter: null, precision: 'month' } : null;
  }
  m = /^(\d{4})-Q([1-4])$/i.exec(v);
  if (m) return { year: Number(m[1]), month: null, day: null, quarter: Number(m[2]), precision: 'quarter' };
  m = /^(\d{4})$/.exec(v);
  if (m) return { year: Number(m[1]), month: null, day: null, quarter: null, precision: 'year' };
  return null;
};

/** Какую точность даты подтверждает сама цитата. */
const groundedPrecision = (d: IParsedDate, quote: string): DatePrecision | null => {
  const q = nfc(quote).toLowerCase();
  const yearShort = String(d.year).slice(2);
  const yearInText = q.includes(String(d.year));
  const numericDay = d.month
    ? new RegExp(`(^|\\D)0?${d.day ?? '\\d{1,2}'}[./]0?${d.month}[./](${d.year}|${yearShort})(\\D|$)`).test(q)
    : false;
  if (!yearInText && !numericDay) return null;
  if (d.month !== null) {
    const stem = MONTH_STEMS[d.month - 1]!;
    const monthWord = new RegExp(`(^|[^\\p{L}])${stem}`, 'u').test(q);
    const monthNumeric = new RegExp(`(^|\\D)0?${d.month}[./](${d.year}|${yearShort})(\\D|$)`).test(q);
    if (d.day !== null && ((monthWord && new RegExp(`(^|\\D)0?${d.day}\\s+${stem}`, 'u').test(q)) || numericDay)) return 'day';
    if (monthWord || monthNumeric) return 'month';
    return 'year';
  }
  if (d.quarter !== null) {
    const roman = ['i', 'ii', 'iii', 'iv'][d.quarter - 1]!;
    return new RegExp(`(^|[^\\p{L}\\d])(${d.quarter}|${roman})(-?(й|м|го))?\\s+квартал`, 'u').test(q) ? 'quarter' : 'year';
  }
  return 'year';
};

const bounds = (d: IParsedDate, precision: DatePrecision): { from: string; to: string } => {
  const y = d.year;
  if (precision === 'day') return { from: `${y}-${pad(d.month!)}-${pad(d.day!)}`, to: `${y}-${pad(d.month!)}-${pad(d.day!)}` };
  if (precision === 'month') return { from: `${y}-${pad(d.month!)}-01`, to: `${y}-${pad(d.month!)}-${pad(lastDay(y, d.month!))}` };
  if (precision === 'quarter') {
    const first = (d.quarter! - 1) * 3 + 1;
    return { from: `${y}-${pad(first)}-01`, to: `${y}-${pad(first + 2)}-${pad(lastDay(y, first + 2))}` };
  }
  return { from: `${y}-01-01`, to: `${y}-12-31` };
};

const coarser = (a: DatePrecision, b: DatePrecision): DatePrecision => (RANK[a] <= RANK[b] ? a : b);

/**
 * Период по цитате: год обязан быть написан; месяц и день — только если написаны.
 * Модель прислала день, а в цитате «в июне 2026» — точность месяц и интервал на весь месяц.
 * Дата публикации сюда не подставляется никогда.
 */
export const groundPeriod = (
  fromRaw: string | null,
  toRaw: string | null,
  claimed: DatePrecision | null,
  quote: string,
  publishedAt: Date | null,
  /** Период связи: начало без конца — открытый интервал, а не весь месяц начала. */
  openEnded = false,
): IGroundedPeriod => {
  const none: IGroundedPeriod = { from: null, to: null, precision: 'unknown' };
  const from = parseDateValue(fromRaw);
  if (!from) return none;
  const maxYear = (publishedAt ?? new Date()).getUTCFullYear() + 5;
  const plausible = (d: IParsedDate): boolean => d.year >= 1991 && d.year <= maxYear;
  if (!plausible(from)) return none;

  const fromGround = groundedPrecision(from, quote);
  if (!fromGround) return none;
  let precision = coarser(coarser(from.precision, fromGround), claimed ?? from.precision);
  const start = bounds(from, precision);

  let end: string | null = openEnded ? null : start.to;
  const to = parseDateValue(toRaw);
  if (to && plausible(to)) {
    const toGround = groundedPrecision(to, quote);
    if (toGround) {
      const toPrecision = coarser(to.precision, toGround);
      precision = coarser(precision, toPrecision);
      const candidate = bounds(to, toPrecision).to;
      if (candidate >= start.from) end = candidate;
    }
  }
  return { from: bounds(from, precision).from, to: end, precision };
};

// ---------------------------------------------------------------------------
// Суммы

export interface IGroundedAmount {
  value: string;
  currency: string | null;
}

const MAGNITUDE: Array<[RegExp, number]> = [
  [/^трлн/, 1e12],
  [/^млрд/, 1e9],
  [/^млн/, 1e6],
  [/^(тыс|тысяч)/, 1e3],
];

const CURRENCY: Array<[RegExp, string]> = [
  [/^(руб|₽|р\.)/, 'RUB'],
  [/^(долл|\$|usd)/, 'USD'],
  [/^(евро|€|eur)/, 'EUR'],
  [/^(тенге|₸|kzt)/, 'KZT'],
];

const NUMBER_RE = /(\d{1,3}(?:[\s\u00a0]\d{3})+|\d+)(?:[.,](\d+))?\s*((?:трлн|млрд|млн|тысяч|тыс)\.?)?\s*((?:рубл\p{L}*|руб\.?|₽|р\.|доллар\p{L}*|долл\.?|\$|евро|€|тенге|₸))?/giu;

export const splitSentences = (text: string): string[] => nfc(text).split(/(?<=[.!?…])\s+(?=[\p{Lu}«"\d])/u);
const splitClauses = (sentence: string): string[] => sentence.split(/[;:]\s+|,\s+(?=а\s|но\s|тогда\s+как|в\s+то\s+время)|\s+—\s+|\.\s+/u);

export const parseAmountValue = (raw: string | null): string | null => {
  if (!raw) return null;
  const v = raw.replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d{1,18}(\.\d{1,2})?$/.test(v)) return null;
  const [int, frac] = v.split('.');
  return `${BigInt(int!).toString()}.${(frac ?? '').padEnd(2, '0')}`;
};

const numericEquals = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;

/**
 * Сумма принадлежит утверждению, только если: число с единицей (млн/руб/…) есть в цитате;
 * фрагмент с числом называет сторону этого утверждения; и в этом фрагменте нет другой
 * компании без нашей стороны. «250 квартир» — не сумма: нет денежной единицы.
 */
export const groundAmount = (
  raw: string | null,
  quote: string,
  ownNames: readonly string[],
  otherNames: readonly string[],
): IGroundedAmount | null => {
  const value = parseAmountValue(raw);
  if (!value || ownNames.length === 0) return null;
  const target = Number(value);

  for (const sentence of splitSentences(quote)) {
    for (const match of sentence.matchAll(NUMBER_RE)) {
      const magnitudeWord = match[3]?.toLowerCase() ?? '';
      const currencyWord = match[4]?.toLowerCase() ?? '';
      if (!magnitudeWord && !currencyWord) continue;
      const base = Number(`${match[1]!.replace(/[\s\u00a0]/g, '')}.${match[2] ?? '0'}`);
      const factor = MAGNITUDE.find(([re]) => re.test(magnitudeWord))?.[1] ?? 1;
      if (!numericEquals(base * factor, target)) continue;

      const clause = splitClauses(sentence).find(c => c.includes(match[0].trim().split(/\s+/)[0]!)) ?? sentence;
      const ownInClause = ownNames.some(n => isNameInQuote(n, clause));
      const otherInClause = otherNames.some(n => isNameInQuote(n, clause));
      const ownInSentence = ownNames.some(n => isNameInQuote(n, sentence));
      const otherInSentence = otherNames.some(n => isNameInQuote(n, sentence));
      // Сторона названа во фрагменте с числом — сумма её. Иначе допустимо предложение, где нет чужих компаний.
      const bound = ownInClause || (ownInSentence && !otherInClause && !otherInSentence);
      if (!bound) continue;

      const currency = CURRENCY.find(([re]) => re.test(currencyWord))?.[1] ?? null;
      return { value, currency };
    }
  }
  return null;
};

export const groundTaxBasis = (claimed: string | null, quote: string): 'with_vat' | 'without_vat' | null => {
  const q = nfc(quote).toLowerCase();
  if (claimed === 'without_vat' && /без\s+ндс/u.test(q)) return 'without_vat';
  if (claimed === 'with_vat' && /(с|включая|в\s+т\.\s?ч\.?|в\s+том\s+числе)\s+ндс/u.test(q) && !/без\s+ндс/u.test(q)) return 'with_vat';
  return null;
};

// ---------------------------------------------------------------------------
// Корпус, пакет работ, номер дела

const BUILDING_RE =
  /(корпус\p{L}*|корп\.|очеред\p{L}*|секци\p{L}*|литер\p{L}*|блок\p{L}*|строени\p{L}*|стр\.)\s*№?\s*(\d[\p{L}\d.\-/]*|\p{L}(?![\p{L}]))|(\d+)\s*-?\s*(?:я|й|ая)?\s+(очеред\p{L}*|секци\p{L}*)/giu;

const normalizeBuildingType = (t: string): string => {
  const w = t.toLowerCase();
  if (w.startsWith('корп')) return 'корпус';
  if (w.startsWith('очеред')) return 'очередь';
  if (w.startsWith('секци')) return 'секция';
  if (w.startsWith('литер')) return 'литер';
  if (w.startsWith('блок')) return 'блок';
  return 'строение';
};

const buildingKeys = (text: string): string[] =>
  [...nfc(text).matchAll(BUILDING_RE)].map(m =>
    m[1]
      ? `${normalizeBuildingType(m[1])} ${m[2]!.toLowerCase().replace(/[.,]$/, '')}`
      : `${normalizeBuildingType(m[4]!)} ${m[3]}`,
  );

/** Корпус/очередь из ответа модели, если та же пара «тип + номер» есть в цитате. */
export const groundBuilding = (label: string | null, quote: string): string | null => {
  if (!label) return null;
  const claimed = buildingKeys(label);
  if (claimed.length === 0) return null;
  const inQuote = new Set(buildingKeys(quote));
  return claimed.find(k => inQuote.has(k)) ?? null;
};

const ABBR = (token: string): RegExp => new RegExp(`(^|[^\\p{L}\\d])${token}([^\\p{L}\\d]|$)`, 'u');

/** Нормализованные темы работ из DATA_CONTRACTS. Свободная подпись сохраняется рядом. */
export const WORK_PACKAGES: Array<{ value: string; patterns: RegExp[] }> = [
  { value: 'ВК', patterns: [ABBR('ВК'), /водоснабжени|водоотведени|канализаци/iu] },
  { value: 'ОВ', patterns: [ABBR('ОВиК'), ABBR('ОВ'), /отоплени|вентиляци|кондиционир/iu] },
  { value: 'ЭОМ', patterns: [ABBR('ЭОМ'), /электроснабж|электромонтаж|электроосвещ|электрооборуд|электросет/iu] },
  { value: 'СС', patterns: [ABBR('СС'), /слаботоч|сет(и|ей)\s+связи/iu] },
  { value: 'автоматика', patterns: [ABBR('АСУ'), /автоматик|диспетчериз/iu] },
  { value: 'противопожарные системы', patterns: [ABBR('АПС'), ABBR('АУПТ'), /противопожар|пожарн|дымоудал/iu] },
  { value: 'общестрой', patterns: [/общестро|монолитн|возведение\s+каркаса|каркас|коробк/iu] },
];

const stems = (text: string): string[] =>
  nfc(text)
    .toLowerCase()
    .split(/[^\p{L}\d]+/u)
    .filter(w => w.length >= 4)
    .map(w => (w.length >= 7 ? w.slice(0, -2) : w));

export interface IGroundedWorkPackage {
  normalized: string | null;
  label: string | null;
}

/** Пакет работ: подпись должна стоять в цитате; нормализуется, только если тема узнаётся и там и там. */
export const groundWorkPackage = (label: string | null, quote: string): IGroundedWorkPackage => {
  if (!label) return { normalized: null, label: null };
  const q = nfc(quote);
  const qStems = new Set(stems(q));
  const labelStems = stems(label);
  const labelInQuote = labelStems.length > 0 && labelStems.filter(s => [...qStems].some(x => x.startsWith(s) || s.startsWith(x))).length / labelStems.length >= 0.6;
  const theme = WORK_PACKAGES.find(wp => wp.patterns.some(p => p.test(nfc(label))) && wp.patterns.some(p => p.test(q)));
  if (theme) return { normalized: theme.value, label: labelInQuote ? label.trim() : null };
  return { normalized: null, label: labelInQuote ? label.trim() : null };
};

/** Номер дела — только если те же знаки стоят в цитате (без учёта пробелов и регистра). */
export const groundCaseNumber = (raw: string | null, quote: string): string | null => {
  if (!raw) return null;
  const compact = (s: string): string => nfc(s).toUpperCase().replace(/[\s\u00a0№]/g, '');
  const value = compact(raw);
  if (value.length < 4 || !/\d/.test(value)) return null;
  return compact(quote).includes(value) ? raw.trim().replace(/^№\s*/, '') : null;
};

/** Кто утверждает — только если назван в цитате. */
export const groundAttribution = (raw: string | null, quote: string): string | null =>
  raw && isNameInQuote(raw, quote) ? raw.trim() : null;
