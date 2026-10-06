// Наборы сведений parser-api.com по ИНН (этап 24A): какие запросы, в каком порядке и что считается полным.
//
//  finance    — ГИР БО: поиск по ИНН → детали по внутреннему id (отчётность по годам, тыс. руб.);
//  tax        — «Прозрачный бизнес»: численность, доходы и расходы, уплаченные налоги, недоимка, флаги;
//  courts     — картотека арбитражных дел за 24 месяца (с первого числа месяца — окно не дрожит каждый день),
//               любая роль, страниц не больше PARSER_API_KAD_MAX_PAGES: не все страницы — неполный набор;
//  fssp       — исполнительные производства по ИНН;
//  bankruptcy — Федресурс (ЕФРСБ): поиск должника по ИНН → список его сообщений (страницы по from_record) →
//               карточки «Сообщение о судебном акте», новые первыми, не больше EFRSB_MAX_ACTS за проход;
//               карточка, полученная прежним снимком, переносится без запроса: сообщение ЕФРСБ не меняется
//               (аннулирование — отдельное сообщение и пометка в списке). Карточку должника (get_org) больше не
//               спрашиваем: о банкротстве в ней ничего, имя и адрес есть в поиске.
//
// Состояние набора — три слова: found (сведения есть), not_found (сервис ответил «записей нет»), partial
// (получена часть: детали или страницы не пришли). «Не проверяли» — отсутствие строки, «ошибка» — неудача
// первого же запроса: тогда снимка нет, а не пустой снимок. Ответы хранятся как есть; что в них значат поля,
// решает карта на чтении (24B, 24C) — после пробы живого ответа.

import { asObject, type ParserApiCallResult, type ParserApiFailure, type ParserApiMethod } from './client.js';
import { efrsbDate, efrsbType, messageKind } from './map/bankruptcy.js';

export const PARSER_API_DATASETS = ['finance', 'tax', 'courts', 'fssp', 'bankruptcy'] as const;
export type ParserApiDataset = (typeof PARSER_API_DATASETS)[number];

export const isParserApiDataset = (value: string): value is ParserApiDataset => (PARSER_API_DATASETS as readonly string[]).includes(value);

/** Через сколько дней набор спрашивается снова: отчётность годовая, дела и долги меняются чаще. */
export const DATASET_REFRESH_DAYS: Readonly<Record<ParserApiDataset, number>> = {
  finance: 90,
  tax: 30,
  courts: 7,
  fssp: 14,
  bankruptcy: 7,
};

/** Сервис тарифа, чьими методами идёт набор: лимит и подписка у каждого свои. */
export const DATASET_SERVICE: Readonly<Record<ParserApiDataset, string>> = {
  finance: 'nalog_bo',
  tax: 'nalog_pb',
  courts: 'arbitr',
  fssp: 'fssp',
  bankruptcy: 'fedresurs',
};

/** Окно картотеки: 24 месяца. */
export const COURTS_WINDOW_MONTHS = 24;

/** Страниц списка сообщений должника ЕФРСБ за проход (на живых ответах список до 118 записей приходил одной страницей). */
export const EFRSB_MAX_LIST_PAGES = 5;
/** Карточек судебных актов ЕФРСБ за проход; остальные — следующим, полученные не спрашиваются снова. */
export const EFRSB_MAX_ACTS = 5;

export const DATASET_FORMAT = 'parser-api-dataset@1';

export interface IDatasetResponse {
  method: ParserApiMethod;
  /** Параметры запроса без ключа. */
  params: Record<string, string>;
  body: Record<string, unknown>;
}

export interface IDatasetPayload {
  format: typeof DATASET_FORMAT;
  dataset: ParserApiDataset;
  inn: string;
  /** Окно дат запроса (картотека). */
  window: { from: string } | null;
  responses: IDatasetResponse[];
  /** Чего нет в наборе и почему: «детали: адрес не разрешён», «страницы 4–7: предел страниц». */
  missing: string[];
}

export type DatasetOutcome = 'found' | 'not_found' | 'partial';

/** Шаг запроса, который даёт refresh.ts: резерв лимита, журнал, запрос. stop — дальше в этом проходе нельзя. */
export type DatasetStepResult = ParserApiCallResult | { ok: false; failure: ParserApiFailure; httpStatus: null; apiCode: null; error: string };
export type DatasetStep = (method: ParserApiMethod, params: Record<string, string>, page?: number) => Promise<DatasetStepResult & { stop?: boolean }>;

export type DatasetRunResult =
  | { status: 'done'; outcome: DatasetOutcome; payload: IDatasetPayload; complete: boolean; stop: ParserApiFailure | null }
  | { status: 'failed'; error: string; stop: ParserApiFailure | null };

export interface IDatasetOptions {
  kadMaxPages: number;
  now: Date;
  /** Последний снимок этого набора по ИНН: из него Федресурс берёт уже полученные карточки сообщений. */
  previous?: IDatasetPayload | null;
}

const list = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.map(asObject).filter((x): x is Record<string, unknown> => x !== null) : [];

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : null;

const numberOf = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Запись ответа именно про этот ИНН: поиск возвращает и чужие (по подстроке, по названию). */
const byInn = (items: ReadonlyArray<Record<string, unknown>>, inn: string): Record<string, unknown> | null =>
  items.find(item => text(item.inn) === inn || text(item.Inn) === inn) ?? null;

/** Первое число месяца N месяцев назад, YYYY-MM-DD (UTC). */
export const windowFrom = (now: Date, months: number): string => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return date.toISOString().slice(0, 10);
};

const payloadOf = (dataset: ParserApiDataset, inn: string, window: IDatasetPayload['window'] = null): IDatasetPayload => ({
  format: DATASET_FORMAT,
  dataset,
  inn,
  window,
  responses: [],
  missing: [],
});

const failureNote = (what: string, res: { failure: ParserApiFailure; error: string }): string => `${what}: ${res.failure} — ${res.error}`;
const stopOf = (res: { stop?: boolean; failure: ParserApiFailure }): ParserApiFailure | null => (res.stop ? res.failure : null);

/** Поиск → детали по id найденной записи (ГИР БО, Федресурс). */
const searchThenDetails = async (
  dataset: ParserApiDataset,
  inn: string,
  step: DatasetStep,
  search: { method: ParserApiMethod; params: Record<string, string>; listKey: string },
  details: { method: ParserApiMethod; idKey: string; label: string },
): Promise<DatasetRunResult> => {
  const payload = payloadOf(dataset, inn);
  const first = await step(search.method, search.params);
  if (!first.ok) return { status: 'failed', error: failureNote(search.method, first), stop: stopOf(first) };
  payload.responses.push({ method: search.method, params: search.params, body: first.body });
  const match = byInn(list(first.body[search.listKey]), inn);
  if (!match) return { status: 'done', outcome: 'not_found', payload, complete: true, stop: null };
  const id = text(match[details.idKey]);
  if (id === null) {
    payload.missing.push(`${details.label}: в ответе поиска нет ${details.idKey}`);
    return { status: 'done', outcome: 'partial', payload, complete: false, stop: null };
  }
  const params = { id };
  const second = await step(details.method, params);
  if (!second.ok) {
    payload.missing.push(failureNote(details.label, second));
    return { status: 'done', outcome: 'partial', payload, complete: false, stop: stopOf(second) };
  }
  payload.responses.push({ method: details.method, params, body: second.body });
  return { status: 'done', outcome: 'found', payload, complete: true, stop: null };
};

/** Один запрос: список непуст — found, пуст — not_found; страниц больше одной — неполный набор. */
const single = async (
  dataset: ParserApiDataset,
  inn: string,
  step: DatasetStep,
  method: ParserApiMethod,
  params: Record<string, string>,
  listKey: string,
  pagesKey: string | null,
): Promise<DatasetRunResult> => {
  const payload = payloadOf(dataset, inn);
  const res = await step(method, params);
  if (!res.ok) return { status: 'failed', error: failureNote(method, res), stop: stopOf(res) };
  payload.responses.push({ method, params, body: res.body });
  const raw = res.body[listKey];
  const items = Array.isArray(raw) ? list(raw) : asObject(raw) ? [asObject(raw)!] : [];
  const pages = pagesKey ? numberOf(res.body[pagesKey]) : null;
  const complete = pages === null || pages <= 1;
  if (!complete) payload.missing.push(`страницы 2–${pages}: портал читает только первую`);
  if (items.length === 0) return { status: 'done', outcome: complete ? 'not_found' : 'partial', payload, complete, stop: null };
  return { status: 'done', outcome: complete ? 'found' : 'partial', payload, complete, stop: null };
};

const runCourts = async (inn: string, step: DatasetStep, options: IDatasetOptions): Promise<DatasetRunResult> => {
  const from = windowFrom(options.now, COURTS_WINDOW_MONTHS);
  const payload = payloadOf('courts', inn, { from });
  let cases = 0;
  let pagesCount: number | null = null;
  for (let page = 1; page <= options.kadMaxPages; page += 1) {
    const params = { Inn: inn, InnType: 'Any', DateFrom: from, page: String(page) };
    const res = await step('kad_search', params, page);
    if (!res.ok) {
      if (page === 1) return { status: 'failed', error: failureNote('kad_search', res), stop: stopOf(res) };
      payload.missing.push(failureNote(`страница ${page}`, res));
      return { status: 'done', outcome: 'partial', payload, complete: false, stop: stopOf(res) };
    }
    payload.responses.push({ method: 'kad_search', params, body: res.body });
    const found = list(res.body.Cases).length;
    cases += found;
    pagesCount = numberOf(res.body.PagesCount) ?? pagesCount;
    // Последняя страница: сервис сказал, сколько их, или страница пустая.
    if (found === 0 || (pagesCount !== null && page >= pagesCount)) {
      return { status: 'done', outcome: cases > 0 ? 'found' : 'not_found', payload, complete: true, stop: null };
    }
  }
  payload.missing.push(
    pagesCount !== null
      ? `страницы ${options.kadMaxPages + 1}–${pagesCount}: предел страниц PARSER_API_KAD_MAX_PAGES`
      : `страницы после ${options.kadMaxPages}: предел страниц, сколько их всего — сервис не сообщил`,
  );
  return { status: 'done', outcome: 'partial', payload, complete: false, stop: null };
};

const runBankruptcy = async (inn: string, step: DatasetStep, options: IDatasetOptions): Promise<DatasetRunResult> => {
  const payload = payloadOf('bankruptcy', inn);
  const search = { orgCode: inn };
  const first = await step('fedresurs_ur', search);
  if (!first.ok) return { status: 'failed', error: failureNote('fedresurs_ur', first), stop: stopOf(first) };
  payload.responses.push({ method: 'fedresurs_ur', params: search, body: first.body });
  const match = byInn(list(first.body.records), inn);
  if (!match) return { status: 'done', outcome: 'not_found', payload, complete: true, stop: null };
  const id = text(match.id);
  if (id === null) {
    payload.missing.push('сообщения должника: в ответе поиска нет id');
    return { status: 'done', outcome: 'partial', payload, complete: false, stop: null };
  }
  const partial = (stop: ParserApiFailure | null): DatasetRunResult => ({ status: 'done', outcome: 'partial', payload, complete: false, stop });

  // Список сообщений: from_record — сколько записей уже получено.
  const messages: Array<Record<string, unknown>> = [];
  let total: number | null = null;
  for (let page = 1; page <= EFRSB_MAX_LIST_PAGES; page += 1) {
    const params: Record<string, string> = messages.length > 0 ? { id, from_record: String(messages.length) } : { id };
    const res = await step('fedresurs_messages', params, page);
    if (!res.ok) {
      payload.missing.push(failureNote(page === 1 ? 'сообщения должника' : `сообщения с ${messages.length + 1}-го`, res));
      return partial(stopOf(res));
    }
    payload.responses.push({ method: 'fedresurs_messages', params, body: res.body });
    const rows = list(res.body.records);
    total = numberOf(res.body.total_count) ?? total;
    messages.push(...rows);
    if (rows.length === 0 || total === null || messages.length >= total) break;
  }
  let complete = true;
  if (total !== null && messages.length < total) {
    payload.missing.push(`сообщения ${messages.length + 1}–${total}: предел страниц списка`);
    complete = false;
  }

  // Карточки судебных актов: неаннулированные, новые первыми.
  const acts = messages
    .map(m => ({ id: text(m.id), date: efrsbDate(m.date), ...efrsbType(m.type) }))
    .filter((m): m is { id: string; date: string | null; type: string; annulled: boolean } => m.id !== null && !m.annulled && messageKind(m.type) === 'court_act')
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const known = new Map(
    (options.previous?.responses ?? [])
      .filter(r => r.method === 'fedresurs_message' && r.params.id)
      .map(r => [r.params.id!, r.body] as const),
  );
  let asked = 0;
  let deferred = 0;
  for (const act of new Map(acts.map(a => [a.id, a])).values()) {
    const params = { id: act.id };
    const body = known.get(act.id);
    if (body) {
      payload.responses.push({ method: 'fedresurs_message', params, body });
      continue;
    }
    if (asked >= EFRSB_MAX_ACTS) {
      deferred += 1;
      continue;
    }
    asked += 1;
    const res = await step('fedresurs_message', params);
    if (!res.ok) {
      payload.missing.push(failureNote(`судебный акт ${act.date ?? act.id}`, res));
      if (res.stop) return partial(stopOf(res));
      complete = false;
      continue;
    }
    payload.responses.push({ method: 'fedresurs_message', params, body: res.body });
  }
  if (deferred > 0) {
    payload.missing.push(`судебные акты: ещё ${deferred} — следующим проходом (не больше ${EFRSB_MAX_ACTS} за проход)`);
    complete = false;
  }
  return complete ? { status: 'done', outcome: 'found', payload, complete: true, stop: null } : partial(null);
};

export const runDataset = (dataset: ParserApiDataset, inn: string, step: DatasetStep, options: IDatasetOptions): Promise<DatasetRunResult> => {
  switch (dataset) {
    case 'finance':
      return searchThenDetails(dataset, inn, step, { method: 'bo_search', params: { inn }, listKey: 'items' }, { method: 'bo_details', idKey: 'id', label: 'отчётность' });
    case 'tax':
      return single(dataset, inn, step, 'pb_org', { inn }, 'org', null);
    case 'courts':
      return runCourts(inn, step, options);
    case 'fssp':
      return single(dataset, inn, step, 'fssp_ur', { inn }, 'result', 'total_pages_count');
    case 'bankruptcy':
      return runBankruptcy(inn, step, options);
  }
};
