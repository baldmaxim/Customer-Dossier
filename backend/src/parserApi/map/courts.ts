// Картотека арбитражных дел из снимка parser-api.com → дела компании за окно 24 месяца (этап 24C, courts-map@1).
//
// Форма сверена с живым ответом (06.10.2026): страницы search → Cases[] {CaseId, CaseNumber, CaseType, Court, StartDate,
// Plaintiffs, Respondents, Thirds, Others}; участники — {Name, Inn, Address}. Правила:
//  - роль компании — по её ИНН среди участников дела, а не по названию; не нашлась — «роль не указана», не догадка;
//  - вид дела — по CaseType: Г — экономический спор, А — административный, Б — банкротство. Роль в деле о банкротстве
//    не говорит, чьё это банкротство (бывает спор внутри чужого дела): банкротство самой компании — по Федресурсу;
//  - сумм исков в списке картотеки нет (они только в карточке дела) — их нет и здесь, суммы не выдумываются;
//  - «за 12 месяцев» считается от даты проверки, а не от сегодняшнего дня: число не плывёт само;
//  - не все страницы получены — complete: false, и экран говорит «не все дела», а не «дел столько».
// Оценки нет (ADR-009): только числа картотеки и откуда.

import { asObject } from '../client.js';
import type { IDatasetPayload } from '../datasets.js';

export const COURTS_MAP_VERSION = 'courts-map@1';

export type CourtCaseType = 'economic' | 'administrative' | 'bankruptcy' | 'unknown';
export type CourtRole = 'respondent' | 'plaintiff' | 'third' | 'other' | 'unknown';

export interface ICourtCase {
  id: string | null;
  number: string;
  startDate: string | null;
  court: string | null;
  type: CourtCaseType;
  /** Роль компании в деле: главная — первой (ответчик, истец, третье лицо, иное). */
  roles: CourtRole[];
  /** Другая сторона: при роли ответчика — истцы, при роли истца — ответчики, иначе обе. Первые три имени. */
  counterparties: string[];
  counterpartiesTotal: number;
  /** Карточка дела на kad.arbitr.ru. */
  url: string | null;
}

export interface ICourtsView {
  format: typeof COURTS_MAP_VERSION;
  recognized: boolean;
  problems: string[];
  window: { from: string } | null;
  complete: boolean;
  total: number;
  byRole: Record<CourtRole, number>;
  byType: Record<CourtCaseType, number>;
  /** За 12 месяцев до проверки — по дате регистрации дела. */
  last12m: { from: string; total: number; respondent: number; plaintiff: number } | null;
  /** Все дела, новые сверху. */
  cases: ICourtCase[];
}

const TYPE_BY_CODE: Readonly<Record<string, CourtCaseType>> = {
  Г: 'economic',
  А: 'administrative',
  A: 'administrative',
  Б: 'bankruptcy',
  B: 'bankruptcy',
};

const PARTY_ROLES: ReadonlyArray<[string, CourtRole]> = [
  ['Respondents', 'respondent'],
  ['Plaintiffs', 'plaintiff'],
  ['Thirds', 'third'],
  ['Others', 'other'],
];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const parties = (value: unknown): Array<{ name: string | null; inn: string | null }> =>
  Array.isArray(value)
    ? value.map(asObject).filter((x): x is Record<string, unknown> => x !== null).map(p => ({ name: text(p.Name), inn: text(p.Inn) }))
    : [];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const zeroRoles = (): Record<CourtRole, number> => ({ respondent: 0, plaintiff: 0, third: 0, other: 0, unknown: 0 });
const zeroTypes = (): Record<CourtCaseType, number> => ({ economic: 0, administrative: 0, bankruptcy: 0, unknown: 0 });

/** Дата на 12 месяцев раньше проверки, YYYY-MM-DD. */
const yearBefore = (iso: string): string => {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
};

/**
 * @param checkedAt — когда проверяли (parser_api_checks.checked_at): от неё считается «за 12 месяцев».
 * @param complete — получены ли все страницы (parser_api_records.complete).
 */
export const mapCourts = (payload: IDatasetPayload, checkedAt: string | null, complete: boolean): ICourtsView => {
  const pages = payload.responses.filter(r => r.method === 'kad_search');
  const base = { format: COURTS_MAP_VERSION, window: payload.window, complete } as const;
  if (pages.length === 0) {
    return { ...base, recognized: false, problems: ['в снимке нет страниц картотеки (kad_search)'], total: 0, byRole: zeroRoles(), byType: zeroTypes(), last12m: null, cases: [] };
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  const cases: ICourtCase[] = [];
  for (const page of pages) {
    if (!Array.isArray(page.body.Cases)) {
      problems.push(`страница ${page.params.page ?? '?'}: нет списка Cases`);
      continue;
    }
    for (const raw of page.body.Cases) {
      const c = asObject(raw);
      const number = text(c?.CaseNumber);
      if (!c || !number) continue;
      const id = text(c.CaseId);
      const key = id ?? number;
      if (seen.has(key)) continue;
      seen.add(key);
      const byParty = PARTY_ROLES.map(([field, role]) => ({ role, list: parties(c[field]) }));
      const roles = byParty.filter(p => p.list.some(x => x.inn === payload.inn)).map(p => p.role);
      const mine = (p: { inn: string | null }) => p.inn === payload.inn;
      const plaintiffs = byParty.find(p => p.role === 'plaintiff')!.list.filter(p => !mine(p));
      const respondents = byParty.find(p => p.role === 'respondent')!.list.filter(p => !mine(p));
      const other = roles[0] === 'respondent' ? plaintiffs : roles[0] === 'plaintiff' ? respondents : [...plaintiffs, ...respondents];
      const names = other.map(p => p.name).filter((n): n is string => n !== null);
      cases.push({
        id,
        number,
        startDate: text(c.StartDate),
        court: text(c.Court),
        type: TYPE_BY_CODE[text(c.CaseType) ?? ''] ?? 'unknown',
        roles: roles.length > 0 ? roles : ['unknown'],
        counterparties: names.slice(0, 3),
        counterpartiesTotal: names.length,
        url: id && GUID.test(id) ? `https://kad.arbitr.ru/Card/${id}` : null,
      });
    }
  }
  cases.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.number.localeCompare(a.number));

  const byRole = zeroRoles();
  const byType = zeroTypes();
  for (const c of cases) {
    byRole[c.roles[0]!] += 1;
    byType[c.type] += 1;
  }
  let last12m: ICourtsView['last12m'] = null;
  if (checkedAt) {
    const from = yearBefore(checkedAt);
    const recent = cases.filter(c => c.startDate !== null && c.startDate >= from);
    last12m = {
      from,
      total: recent.length,
      respondent: recent.filter(c => c.roles[0] === 'respondent').length,
      plaintiff: recent.filter(c => c.roles[0] === 'plaintiff').length,
    };
  }
  return { ...base, recognized: problems.length < pages.length, problems, total: cases.length, byRole, byType, last12m, cases };
};
