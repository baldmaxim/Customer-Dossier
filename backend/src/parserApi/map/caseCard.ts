// Сумма иска из карточки арбитражного дела parser-api.com (details_by_id) — case-card-map@1.
//
// Форма — по документации сервиса: Cases[] {CaseId, CaseInstances[] {Name, InstanceEvents[] {Date, ClaimSum}}};
// живой ответ сверяется пробой (`npm run parserapi -- --probe kad_details <ИНН> --id <CaseId>`). Правила:
//  - сумма — ClaimSum событий первой инстанции; инстанции с таким названием нет — событий всех инстанций;
//  - «при подаче» — самое раннее по дате событие с суммой больше нуля; другая сумма у самого позднего события —
//    «позже в карточке» (уточнение требований): обе — слова карточки, ни одна не подменяет другую;
//  - нет поля или 0 — «сумма в карточке не указана» (неимущественный спор, обеспечение), а не «0 ₽»;
//  - рубли как есть, без пересчёта. Сумма иска — требование истца, а не долг компании.

import { asObject } from '../client.js';

export const CASE_CARD_MAP_VERSION = 'case-card-map@1';

export interface ICaseClaim {
  /** Когда карточку получили: сумма — на эту дату. */
  fetchedAt: string;
  /** В ответе нашлись инстанции дела. false — форма ответа незнакома, суммы не ищем. */
  recognized: boolean;
  /** Сумма при подаче, руб.; null — в карточке не указана. */
  amount: number | null;
  /** Сумма самого позднего события с суммой, если она другая, руб. */
  latest: number | null;
}

const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : [];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** ClaimSum: число или строка «12345.67» / «12345,67». Не число и не больше нуля — суммы нет. */
const amountOf = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const FIRST_INSTANCE = /^перв/i;

export const mapCaseCard = (body: Record<string, unknown>, caseId: string, fetchedAt: string): ICaseClaim => {
  const cases = list(body.Cases);
  const card = cases.find(c => text(c.CaseId)?.toLowerCase() === caseId.toLowerCase()) ?? cases[0];
  const instances = list(card?.CaseInstances);
  if (instances.length === 0) return { fetchedAt, recognized: false, amount: null, latest: null };
  const first = instances.filter(i => FIRST_INSTANCE.test(text(i.Name) ?? ''));
  const events = (first.length > 0 ? first : instances)
    .flatMap(i => list(i.InstanceEvents))
    .map((e, order) => ({ date: text(e.Date) ?? '', order, amount: amountOf(e.ClaimSum) }))
    .filter((e): e is { date: string; order: number; amount: number } => e.amount !== null)
    // Без даты — в конец: «при подаче» берётся только с датой, если она есть хоть у одного события.
    .sort((a, b) => (a.date === '' ? 1 : 0) - (b.date === '' ? 1 : 0) || a.date.localeCompare(b.date) || a.order - b.order);
  const amount = events[0]?.amount ?? null;
  const last = events.at(-1)?.amount ?? null;
  return { fetchedAt, recognized: true, amount, latest: last !== null && last !== amount ? last : null };
};
