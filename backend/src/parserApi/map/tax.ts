// «Прозрачный бизнес» ФНС из снимка parser-api.com → численность, доходы и расходы, налоги, недоимка, флаги
// (этап 24B, tax-map@1).
//
// Форма сверена с живым ответом (06.10.2026): search_org → org[] (берём запись с тем же ИНН), суммы — в рублях.
// Недоимка приходит несколькими выгрузками ФНС ({year, period}); показываем последнюю (наибольшие год и период),
// прежние — только итогом. Это сведения ФНС на дату выгрузки, а не «долг сейчас». Флаги — на flags_date.
// Нет поля — null или пустой список, не ноль. Оценки нет (ADR-009).

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const TAX_MAP_VERSION = 'tax-map@1';

export interface IArrearsSnapshot {
  year: number;
  period: number | null;
  total: number;
  arrear: number;
  penalty: number;
  fine: number;
  items: Array<{ name: string; total: number }>;
}

export interface ITaxView {
  format: typeof TAX_MAP_VERSION;
  recognized: boolean;
  problems: string[];
  /** Все суммы — в рублях. */
  unit: 'RUB';
  /** По годам, по убыванию. */
  headcount: Array<{ year: number; count: number }>;
  incomeExpenses: Array<{ year: number; income: number | null; expense: number | null }>;
  taxesPaid: Array<{ year: number; total: number; lines: number }>;
  /** Последняя выгрузка недоимки; null — сведений нет. */
  arrears: IArrearsSnapshot | null;
  /** Прежние выгрузки — итогом. */
  arrearsHistory: Array<{ year: number; period: number | null; total: number }>;
  flags: { bailiffDebt: boolean | null; noReporting: boolean | null; asOf: string | null };
  taxModes: string[];
  msp: string | null;
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : value === 1 ? true : value === 0 ? false : null);

const rows = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : [];

const empty = (problems: string[]): ITaxView => ({
  format: TAX_MAP_VERSION,
  recognized: false,
  problems,
  unit: 'RUB',
  headcount: [],
  incomeExpenses: [],
  taxesPaid: [],
  arrears: null,
  arrearsHistory: [],
  flags: { bailiffDebt: null, noReporting: null, asOf: null },
  taxModes: [],
  msp: null,
});

const byYearDesc = <T extends { year: number }>(list: T[]): T[] => list.sort((a, b) => b.year - a.year);

export const mapTax = (payload: IDatasetPayload): ITaxView => {
  const body = payload.responses.find(r => r.method === 'pb_org')?.body;
  if (!body) return empty(['в снимке нет ответа «Прозрачного бизнеса» (pb_org)']);
  const org = rows(body.org).find(o => text(o.inn) === payload.inn);
  if (!org) return empty(['в ответе нет записи с ИНН компании']);

  const headcount = byYearDesc(
    rows(org.avg_headcount).flatMap(r => {
      const year = num(r.year);
      const count = num(r.count);
      return year !== null && count !== null ? [{ year, count }] : [];
    }),
  );
  const incomeExpenses = byYearDesc(
    rows(org.income_expenses).flatMap(r => {
      const year = num(r.year);
      return year !== null ? [{ year, income: num(r.income), expense: num(r.expense) }] : [];
    }),
  );

  const taxes = new Map<number, { total: number; lines: number }>();
  for (const r of rows(org.taxes_paid)) {
    const year = num(r.year);
    if (year === null) continue;
    const entry = taxes.get(year) ?? { total: 0, lines: 0 };
    entry.total += num(r.sum) ?? 0;
    entry.lines += 1;
    taxes.set(year, entry);
  }
  const taxesPaid = byYearDesc([...taxes].map(([year, v]) => ({ year, total: Math.round(v.total * 100) / 100, lines: v.lines })));

  // Выгрузки недоимки: ключ — год и период выгрузки.
  const snapshots = new Map<string, IArrearsSnapshot>();
  for (const r of rows(org.arrears)) {
    const year = num(r.year);
    if (year === null) continue;
    const period = num(r.period);
    const key = `${year}:${period ?? ''}`;
    const snap = snapshots.get(key) ?? { year, period, total: 0, arrear: 0, penalty: 0, fine: 0, items: [] };
    const total = num(r.total_sum) ?? 0;
    snap.total += total;
    snap.arrear += num(r.arrear_sum) ?? 0;
    snap.penalty += num(r.penalty_sum) ?? 0;
    snap.fine += num(r.fine_sum) ?? 0;
    snap.items.push({ name: text(r.kbk_name) ?? 'без названия', total });
    snapshots.set(key, snap);
  }
  const ordered = [...snapshots.values()].sort((a, b) => b.year - a.year || (b.period ?? 0) - (a.period ?? 0));
  const round = (s: IArrearsSnapshot): IArrearsSnapshot => ({
    ...s,
    total: Math.round(s.total * 100) / 100,
    arrear: Math.round(s.arrear * 100) / 100,
    penalty: Math.round(s.penalty * 100) / 100,
    fine: Math.round(s.fine * 100) / 100,
    items: [...s.items].sort((a, b) => b.total - a.total),
  });

  return {
    format: TAX_MAP_VERSION,
    recognized: true,
    problems: [],
    unit: 'RUB',
    headcount,
    incomeExpenses,
    taxesPaid,
    arrears: ordered[0] ? round(ordered[0]) : null,
    arrearsHistory: ordered.slice(1).map(s => ({ year: s.year, period: s.period, total: Math.round(s.total * 100) / 100 })),
    flags: { bailiffDebt: bool(org.has_bailiff_debt), noReporting: bool(org.has_no_reporting), asOf: text(org.flags_date) },
    taxModes: rows(org.tax_modes).map(m => text(m.name) ?? text(m.title)).filter((m): m is string => m !== null)
      .concat(Array.isArray(org.tax_modes) ? org.tax_modes.filter((m): m is string => typeof m === 'string') : []),
    msp: text(org.msp) ?? text(asObject(org.msp)?.category) ?? null,
  };
};
