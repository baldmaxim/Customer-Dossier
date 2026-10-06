// Бухгалтерская отчётность ГИР БО из снимка parser-api.com → годы с главными строками (этап 24B, finance-map@1).
//
// Разбор — на чтении: правка карты не тратит запросы и не переписывает снимки. Форма ответа сверена с живым
// ответом (06.10.2026): details → reports[] по одному на год, строки — balance[] и financial_result[] вида
// {code, name, current, previous}. Правила:
//  - год берётся из собственного отчёта (current): пересчёт прошлого года в следующем отчёте его не подменяет;
//    несколько отчётов за год — наибольший correction_number, при равенстве — поздняя published_date;
//  - единица — рубль: ГИР БО отдаёт тысячи рублей, здесь умножается на 1000 (ревью R-11: одна единица на экране);
//  - «Проценты к уплате» (2330) — по модулю: это расход, а знак в ГИР БО от отчёта к отчёту разный; строки прибыли —
//    со знаком, убыток — минус;
//  - нет строки — null, не ноль; незнакомая форма — recognized: false с причиной, а не догадка.
// Оценки нет (ADR-009): только числа отчёта, год и откуда.

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const FINANCE_MAP_VERSION = 'finance-map@1';

/** Строки отчёта, которые показывает карточка: поле → код строки ГИР БО. */
export const FINANCE_LINES = {
  revenue: 2110,
  salesProfit: 2200,
  pretaxProfit: 2300,
  netProfit: 2400,
  interestPayable: 2330,
  assets: 1600,
  equity: 1300,
  longBorrowings: 1410,
  shortBorrowings: 1510,
  payables: 1520,
  receivables: 1230,
  cash: 1250,
} as const;

export type FinanceLine = keyof typeof FINANCE_LINES;

/** Строки-расходы: в ГИР БО знак непостоянен, берём модуль. */
const EXPENSE_LINES: ReadonlySet<FinanceLine> = new Set(['interestPayable']);

export interface IFinanceYearSource {
  period: number;
  publishedDate: string | null;
  actualDate: string | null;
  correctionNumber: number;
  /** К отчёту приложено аудиторское заключение. */
  audited: boolean;
  /** PDF отчёта на bo.nalog.gov.ru. */
  pdfUrl: string | null;
}

export type IFinanceYear = { year: number; source: IFinanceYearSource } & Record<FinanceLine, number | null>;

export interface IFinanceView {
  format: typeof FINANCE_MAP_VERSION;
  recognized: boolean;
  /** Почему не распознано; пусто — распознано. */
  problems: string[];
  /** Все суммы — в рублях. */
  unit: 'RUB';
  /** Годы по убыванию. */
  years: IFinanceYear[];
}

const numberOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
};

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Только https на bo.nalog.gov.ru: ссылка уходит на экран, чужой адрес из ответа туда не попадёт. */
const pdfUrlOf = (value: unknown): string | null => {
  const raw = textOf(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (url.hostname === 'bo.nalog.gov.ru' || url.hostname === 'bo.nalog.ru') ? url.toString() : null;
  } catch {
    return null;
  }
};

const lineValues = (rows: unknown): Map<number, number | null> => {
  const out = new Map<number, number | null>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const row = asObject(raw);
    const code = numberOf(row?.code);
    if (row && code !== null) out.set(code, numberOf(row.current));
  }
  return out;
};

const detailsBody = (payload: IDatasetPayload): Record<string, unknown> | null =>
  payload.responses.find(r => r.method === 'bo_details')?.body ?? null;

const empty = (problems: string[]): IFinanceView => ({ format: FINANCE_MAP_VERSION, recognized: false, problems, unit: 'RUB', years: [] });

export const mapFinance = (payload: IDatasetPayload): IFinanceView => {
  const details = detailsBody(payload);
  if (!details) return empty(['в снимке нет ответа с отчётностью (bo_details)']);
  if (!Array.isArray(details.reports)) return empty(['в ответе нет списка отчётов reports']);

  const byYear = new Map<number, { report: Record<string, unknown>; source: IFinanceYearSource }>();
  const problems: string[] = [];
  for (const raw of details.reports) {
    const report = asObject(raw);
    const period = numberOf(report?.period);
    if (!report || period === null || !Number.isInteger(period)) {
      problems.push('отчёт без года пропущен');
      continue;
    }
    const source: IFinanceYearSource = {
      period,
      publishedDate: textOf(report.published_date),
      actualDate: textOf(report.actual_bfo_date),
      correctionNumber: numberOf(report.correction_number) ?? 0,
      audited: asObject(report.audit_report) !== null,
      pdfUrl: pdfUrlOf(report.url),
    };
    const known = byYear.get(period);
    const newer =
      !known ||
      source.correctionNumber > known.source.correctionNumber ||
      (source.correctionNumber === known.source.correctionNumber && (source.publishedDate ?? '') > (known.source.publishedDate ?? ''));
    if (newer) byYear.set(period, { report, source });
  }

  const years: IFinanceYear[] = [...byYear.values()]
    .map(({ report, source }) => {
      const lines = new Map([...lineValues(report.balance), ...lineValues(report.financial_result)]);
      const values = {} as Record<FinanceLine, number | null>;
      for (const [field, code] of Object.entries(FINANCE_LINES) as Array<[FinanceLine, number]>) {
        const thousands = lines.get(code) ?? null;
        const rubles = thousands === null ? null : thousands * 1000;
        values[field] = rubles !== null && EXPENSE_LINES.has(field) ? Math.abs(rubles) : rubles;
      }
      return { year: source.period, source, ...values };
    })
    .sort((a, b) => b.year - a.year);

  return { format: FINANCE_MAP_VERSION, recognized: years.length > 0 || problems.length === 0, problems, unit: 'RUB', years };
};
