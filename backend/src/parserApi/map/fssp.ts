// Исполнительные производства ФССП из снимка parser-api.com (этап 24C, fssp-map@1).
//
// Форма сверена с живым ответом (06.10.2026): {done, result[], total_rows_count, total_pages_count}; производство —
// {process_title, process_date, stop_date, stop_reason, subjects[{title, sum?}], document_*, department_title, …}.
// Правила (ревью TASK 11, R-10):
//  - статус — по полям окончания, словами ФССП: дата окончания есть — окончено; даты нет — «не окончено по данным ФССП»
//    (сервис не присылает пустые поля, так что «нет даты» и «поле пустое» — одно и то же). Это не вывод «действует и
//    взыскивается»; основание окончания без даты — противоречие, статус не ясен;
//  - суммы — словами ФССП: «Сумма долга» (по исполнительному документу), «Остаток долга по исполнительному документу»
//    (остаток по данным ФССП), «Исполнительский сбор» — отдельно, не складываются в одно «долг сейчас»;
//  - остаток считается только по производствам, где ФССП его указала, и это число показывается рядом («у K из N»);
//  - сервис отдаёт и окончённые производства не все (ФССП публикует их выборочно) — экран так и говорит;
//  - основание окончания ФССП пишет ссылкой на закон («ст. 46 ч. 1 п. 4») — stopMeaning раскладывает её по 229-ФЗ
//    «Об исполнительном производстве» (fssp-map@2, 06.10.2026): ст. 46 ч. 1 — документ возвращён взыскателю (п. 3 —
//    не найдены должник, имущество или счета, п. 4 — нет имущества для взыскания), ст. 47 ч. 1 п. 1–2 — фактическое
//    исполнение, п. 6 — удержание периодических платежей, п. 7 — должник признан банкротом, п. 8 — ликвидация, п. 9 —
//    истёк срок давности, ст. 43 — прекращение. «Окончено» не значит «погашено»: по ст. 46 ч. 1 п. 3–4 долг не взыскан,
//    и это число показывается отдельно с суммой долга. Незнакомая ссылка — «другое основание», ссылка остаётся рядом.
// Оценки нет (ADR-009).

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const FSSP_MAP_VERSION = 'fssp-map@2';

/** Что значит основание окончания по 229-ФЗ — раскладка ссылки на закон, а не оценка. */
export type FsspStopMeaning =
  | 'executed'
  | 'not_found'
  | 'no_property'
  | 'returned'
  | 'periodic'
  | 'bankruptcy'
  | 'liquidation'
  | 'terminated'
  | 'expired'
  | 'other';

/** «ст. 46 ч. 1 п. 4» → no_property. Ссылку ФССП пишет по-разному («ст.46 ч.1 п.4») — пробелы не важны. */
export const stopMeaning = (reason: string | null): FsspStopMeaning => {
  const m = reason ? /ст\.?\s*(\d+)(?:\s*ч\.?\s*(\d+))?(?:\s*п\.?\s*(\d+))?/i.exec(reason) : null;
  if (!m) return 'other';
  const [article, part, point] = [Number(m[1]), m[2] ? Number(m[2]) : null, m[3] ? Number(m[3]) : null];
  if (article === 43) return 'terminated';
  if (article === 46 && part === 1) return point === 3 ? 'not_found' : point === 4 ? 'no_property' : 'returned';
  if (article === 47 && part === 1) {
    if (point === 1 || point === 2) return 'executed';
    if (point === 4) return 'returned';
    if (point === 5) return 'terminated';
    if (point === 6) return 'periodic';
    if (point === 7) return 'bankruptcy';
    if (point === 8) return 'liquidation';
    if (point === 9) return 'expired';
  }
  return 'other';
};

/** Окончено без взыскания: долг остался (ст. 46 ч. 1 п. 3–4). */
const UNCOLLECTED: ReadonlySet<FsspStopMeaning> = new Set(['not_found', 'no_property']);

export interface IFsspEndedGroup {
  count: number;
  /** «Сумма долга» по документам этих производств — где ФССП её указала. */
  debt: number;
  debtCovered: number;
}

const DEBT = 'Сумма долга';
const REMAINING = 'Остаток долга по исполнительному документу';
const FEE = 'Исполнительский сбор';

export interface IFsspProceeding {
  number: string;
  date: string | null;
  /** Предмет взыскания — строка без суммы. */
  subject: string | null;
  debt: number | null;
  remaining: number | null;
  department: string | null;
  issuer: string | null;
  stopDate: string | null;
  stopReason: string | null;
}

export interface IFsspView {
  format: typeof FSSP_MAP_VERSION;
  recognized: boolean;
  problems: string[];
  /** Сколько записей сервис насчитал и сколько отдал; все страницы получены. */
  totalRows: number | null;
  loaded: number;
  complete: boolean;
  /** Не окончено по данным ФССП: даты окончания нет. */
  open: { count: number; debt: number; remaining: number; remainingCovered: number; fee: number };
  ended: {
    count: number;
    /** По ссылке на закон словами ФССП, с её значением. */
    byReason: Array<{ reason: string; meaning: FsspStopMeaning } & IFsspEndedGroup>;
    byMeaning: Array<{ meaning: FsspStopMeaning } & IFsspEndedGroup>;
    /** Возвращено взыскателю без взыскания: не найдены должник, имущество или счета; нет имущества. */
    uncollected: IFsspEndedGroup;
  };
  unknownStatus: number;
  openedByYear: Array<{ year: number; count: number }>;
  /** Возбуждено за 12 месяцев до проверки. */
  last12m: { from: string; count: number } | null;
  /** Предметы взыскания неоконченных производств, по убыванию числа. */
  bySubject: Array<{ subject: string; count: number }>;
  /** Последние неоконченные производства, новые сверху. */
  recent: IFsspProceeding[];
}

const RECENT_LIMIT = 10;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const money = (value: unknown): number | null => {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.').replace(/\s/g, '')) : NaN;
  return Number.isFinite(raw) ? raw : null;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const yearBefore = (iso: string): string => {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
};

type Status = 'open' | 'ended' | 'unknown';

const statusOf = (row: Record<string, unknown>): Status => {
  if (text(row.stop_date)) return 'ended';
  return text(row.stop_reason) ? 'unknown' : 'open';
};

const proceedingOf = (row: Record<string, unknown>): IFsspProceeding => {
  const subjects = Array.isArray(row.subjects) ? row.subjects.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : [];
  const sumOf = (title: string): number | null => {
    const found = subjects.filter(s => text(s.title) === title).map(s => money(s.sum)).filter((n): n is number => n !== null);
    return found.length > 0 ? found.reduce((a, b) => a + b, 0) : null;
  };
  return {
    number: text(row.process_title) ?? '—',
    date: text(row.process_date),
    subject: text(subjects.find(s => s.sum === undefined || s.sum === null || s.sum === '')?.title),
    debt: sumOf(DEBT),
    remaining: sumOf(REMAINING),
    department: text(row.department_title),
    issuer: text(row.document_organization),
    stopDate: text(row.stop_date),
    stopReason: text(row.stop_reason),
  };
};

/** Все производства снимка (для «Нового»: что появилось с прошлого снимка). Нет списка — пусто. */
export const fsspProceedings = (payload: IDatasetPayload): IFsspProceeding[] => {
  const body = payload.responses.find(r => r.method === 'fssp_ur')?.body;
  if (!body || !Array.isArray(body.result)) return [];
  return body.result.map(asObject).filter((x): x is Record<string, unknown> => x !== null).map(proceedingOf);
};

/**
 * @param checkedAt — когда проверяли: от неё «возбуждено за 12 месяцев».
 * @param complete — все страницы получены (parser_api_records.complete).
 */
export const mapFssp = (payload: IDatasetPayload, checkedAt: string | null, complete: boolean): IFsspView => {
  const body = payload.responses.find(r => r.method === 'fssp_ur')?.body;
  const empty = (problems: string[]): IFsspView => ({
    format: FSSP_MAP_VERSION,
    recognized: false,
    problems,
    totalRows: null,
    loaded: 0,
    complete,
    open: { count: 0, debt: 0, remaining: 0, remainingCovered: 0, fee: 0 },
    ended: { count: 0, byReason: [], byMeaning: [], uncollected: { count: 0, debt: 0, debtCovered: 0 } },
    unknownStatus: 0,
    openedByYear: [],
    last12m: null,
    bySubject: [],
    recent: [],
  });
  if (!body) return empty(['в снимке нет ответа ФССП (fssp_ur)']);
  if (!Array.isArray(body.result)) return empty(['в ответе ФССП нет списка result']);

  const rows = body.result.map(asObject).filter((x): x is Record<string, unknown> => x !== null);
  const seen = new Set<string>();
  const open: IFsspProceeding[] = [];
  const ended: IFsspProceeding[] = [];
  let unknownStatus = 0;
  const unknownRows: IFsspProceeding[] = [];
  let fee = 0;
  const byYear = new Map<number, number>();
  for (const row of rows) {
    const p = proceedingOf(row);
    if (p.number !== '—') {
      if (seen.has(p.number)) continue;
      seen.add(p.number);
    }
    const year = p.date ? Number(p.date.slice(0, 4)) : NaN;
    if (Number.isInteger(year)) byYear.set(year, (byYear.get(year) ?? 0) + 1);
    const status = statusOf(row);
    if (status === 'open') {
      open.push(p);
      const subjects = Array.isArray(row.subjects) ? row.subjects.map(asObject) : [];
      fee += subjects.filter(s => text(s?.title) === FEE).reduce((a, s) => a + (money(s?.sum) ?? 0), 0);
    } else if (status === 'ended') ended.push(p);
    else {
      unknownStatus += 1;
      unknownRows.push(p);
    }
  }

  const group = (list: IFsspProceeding[]): IFsspEndedGroup => {
    const withDebt = list.filter(p => p.debt !== null);
    return { count: list.length, debt: round2(withDebt.reduce((a, p) => a + (p.debt ?? 0), 0)), debtCovered: withDebt.length };
  };
  const groupBy = <K extends string>(keyOf: (p: IFsspProceeding) => K): Array<[K, IFsspEndedGroup]> => {
    const groups = new Map<K, IFsspProceeding[]>();
    for (const p of ended) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
    return [...groups].map(([k, list]): [K, IFsspEndedGroup] => [k, group(list)]).sort((a, b) => b[1].count - a[1].count);
  };
  const subjects = new Map<string, number>();
  for (const p of open) if (p.subject) subjects.set(p.subject, (subjects.get(p.subject) ?? 0) + 1);
  const withRemaining = open.filter(p => p.remaining !== null);
  const all = [...open, ...ended, ...unknownRows];
  const from = checkedAt ? yearBefore(checkedAt) : null;
  const totalRows = money(body.total_rows_count);

  return {
    format: FSSP_MAP_VERSION,
    recognized: true,
    problems: [],
    totalRows,
    loaded: rows.length,
    complete,
    open: {
      count: open.length,
      debt: round2(open.reduce((a, p) => a + (p.debt ?? 0), 0)),
      remaining: round2(withRemaining.reduce((a, p) => a + (p.remaining ?? 0), 0)),
      remainingCovered: withRemaining.length,
      fee: round2(fee),
    },
    ended: {
      count: ended.length,
      byReason: groupBy(p => p.stopReason ?? 'основание не указано').map(([reason, g]) => ({ reason, meaning: stopMeaning(reason), ...g })),
      byMeaning: groupBy(p => stopMeaning(p.stopReason)).map(([meaning, g]) => ({ meaning, ...g })),
      uncollected: group(ended.filter(p => UNCOLLECTED.has(stopMeaning(p.stopReason)))),
    },
    unknownStatus,
    openedByYear: [...byYear].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year),
    last12m: from ? { from, count: all.filter(p => p.date !== null && p.date >= from).length } : null,
    bySubject: [...subjects].map(([subject, count]) => ({ subject, count })).sort((a, b) => b.count - a.count),
    recent: [...open].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, RECENT_LIMIT),
  };
};
