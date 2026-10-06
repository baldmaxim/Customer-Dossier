// Синтетические ответы API для тестов карточки компании (companyPage.test.tsx).

import type { IFakeRoute } from '../test/render';
import type { ICompanyBuildersResponse, ICompanyFinanceResponse, IFinanceYear, IFocusView, IParserApiDatasetState } from '../api/types';

const company = {
  company: { id: 7, name: 'ООО «Мостострой»', city: 'Казань', legalForm: 'ООО', taxId: null, entityType: 'legal_entity' },
  aliases: [{ alias: 'Мостострой', hits: 3 }],
  identifiers: [{ jurisdiction: 'RU', type: 'inn', value: '1655000000', validationStatus: 'checksum_valid', origin: 'registry' }],
  relations: [],
  registry: null,
  mergedInto: null,
};

const registry = {
  source: { key: 'registry', title: 'Единый реестр' },
  externalRef: '123',
  asOf: '2026-09-20',
  fetchedAt: '2026-09-21',
  fields: [],
  developer: { name: 'Мостострой', legalForm: 'ООО', inn: '1655000000', ogrn: null },
  groupName: null,
  address: null,
  changes: [],
  coverage: { loaded: 1, truncated: false },
  attribution: 'По сведениям проектной декларации',
};

const fact = (over: Record<string, unknown> = {}) => ({
  assertionId: 101,
  predicate: 'participates_in_project',
  role: 'general_contractor',
  basis: 'participation',
  eventType: null,
  modality: 'reported_fact',
  polarity: 'positive',
  status: 'text_grounded',
  projectId: 55,
  projectName: 'Развязка на М-7',
  otherCompanyId: null,
  otherCompanyName: null,
  amount: null,
  currency: null,
  valueType: null,
  quote: 'генподрядчиком выступает «Мостострой»',
  ...over,
});

const publication = (over: Record<string, unknown> = {}) => ({
  itemId: 11,
  revisionId: 21,
  documentId: 31,
  title: null,
  topic: 'Подряд на развязку передан другой фирме',
  publishedAt: '2026-09-18T07:00:00Z',
  observedAt: '2026-09-18T07:30:00Z',
  sourceTitle: 'Стройканал',
  sourceKind: 'telegram',
  sourceKey: 'stroykanal',
  url: 'https://t.me/stroykanal/11',
  completeness: 'full',
  snippet: 'Начало текста публикации',
  facts: [fact(), fact({ assertionId: 102, predicate: 'company_mentioned', role: null, projectName: null })],
  moreFacts: 0,
  ...over,
});

const partner = {
  companyId: 8,
  name: 'ООО «Дорсервис»',
  city: 'Казань',
  links: [
    { kind: 'contract', role: 'subcontractor', ownRole: 'general_contractor', projectId: 55, projectName: 'Развязка на М-7', assertionId: 101, modality: null, status: null },
  ],
};

const projectRow = (over: Record<string, unknown> = {}) => ({
  id: 55,
  name: 'Развязка на М-7',
  kind: 'infrastructure',
  stage: 'construction',
  city: 'Казань',
  plannedCompletion: null,
  actualCompletion: null,
  role: 'general_contractor',
  confidence: 0.9,
  isCurrent: true,
  basis: 'participation',
  counterparties: [{ id: 9, name: 'АО «Мостотрест»', role: 'designer' }],
  ...over,
});

export const event = (over: Record<string, unknown> = {}) => ({
  id: 501,
  type: 'construction_start',
  occurredOn: '2026-01-01',
  severity: 0,
  amountRub: null,
  quote: 'Начали строительство',
  confidence: 0.9,
  status: 'text_grounded',
  projectId: 55,
  projectName: 'Развязка на М-7',
  counterpartyId: null,
  counterpartyName: null,
  url: null,
  sourceTitle: null,
  sourceKey: null,
  sourceKind: null,
  ...over,
});

const revision = (id: number, body: string) => ({
  revision: {
    id, sourceItemId: 11, revisionNo: 1, title: null, body, representation: 'telegram_web_text@1', bodyHash: 'x',
    completeness: 'full', completenessReason: null, attachments: [], publishedAt: '2026-09-18T07:00:00Z', sourceModifiedAt: null,
    firstObservedAt: '2026-09-18T07:30:00Z', chronology: 'observed_order', sameContentAsRevisionId: null, legacyDocumentId: 31, origin: 'ingest',
  },
});

const summary = {
  generatedAt: '2026-09-21T10:00:00Z',
  signalsCutoff: null,
  stale: false,
  staleReasons: [],
  summary: [],
  counterparties: { contracts: [], corporate: [], coParticipants: [] },
  contradictions: [{ kind: 'polarity_conflict', assertionId: 101, priority: 1 }],
  limits: [],
  cases: [],
};

/** Показатель, посчитанный правилами: число без окна и знаменателя — для плиток сводки хватает. */
const agg = (value: number) => ({ value, status: 'ok', rule: 'test', window: null, denominator: null, ids: [], idsTruncated: false });

/**
 * Посчитанные показатели signals@2 — только то, что читает «Обзор» (плитки сводки). «Подробно»
 * с этим ответом не открывать: его разделам нужен полный снимок.
 */
export const computedSignals = {
  status: 'ok',
  refresh: {
    active: { id: 1, rulesVersion: 'signals@2', cutoffAt: '2026-10-01T12:00:00Z', finishedAt: '2026-10-01T12:01:00Z' },
    lastFailure: null,
    running: false,
    stale: false,
    staleReasons: [],
  },
  signals: {
    experience: { byRole: { general_contractor: agg(1), customer: agg(1) }, counterparties: agg(3), contractsCount: agg(2), corporateCount: agg(1) },
    media: {
      publications: agg(14),
      publications90d: agg(4),
      latestPublishedAt: { value: '2026-09-30T12:00:00Z', status: 'ok', rule: 'test', sourceItemId: 11 },
      eventsDated12m: agg(2),
      legalCasesCount: agg(3),
      courtRoles: { plaintiff: 1, defendant: 2, other: 0, unknown: 0 },
    },
  },
};

/** 24 месяца по месяц среза computedSignals (октябрь 2026), значения — с конца ряда. */
const SERIES_MONTHS = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 9 - (23 - i), 1)).toISOString().slice(0, 7));

const monthSeries = (tail: number[], excluded: Partial<Record<'undated' | 'beforeWindow' | 'future' | 'coarse' | 'registry', number>> = {}) => {
  const values = [...Array(24 - tail.length).fill(0), ...tail] as number[];
  const sum = values.reduce((t, v) => t + v, 0);
  const ex = { undated: 0, beforeWindow: 0, future: 0, coarse: 0, registry: 0, ...excluded };
  return {
    ...agg(sum),
    denominator: sum + Object.values(ex).reduce((t, v) => t + v, 0),
    buckets: SERIES_MONTHS.map((month, i) => ({ month, value: values[i]! })),
    excluded: ex,
    partialLast: true,
  };
};

/** Показатели signals@3: те же числа и ряды по месяцам (публикации и события). */
export const seriesSignals = {
  ...computedSignals,
  refresh: { ...computedSignals.refresh, active: { ...computedSignals.refresh.active, rulesVersion: 'signals@3' } },
  signals: {
    ...computedSignals.signals,
    cutoff: '2026-10-01T12:00:00Z',
    media: {
      ...computedSignals.signals.media,
      publicationsByMonth: monthSeries([3, 0, 5, 2], { undated: 2, registry: 1, beforeWindow: 1 }),
      eventsByMonth: monthSeries([1, 0, 1], { coarse: 1 }),
    },
  },
};

/** Объект вкладки «Объекты»: свой, с двумя ролями, без сведений ДОМ.РФ. */
export const objectRow = (over: Record<string, unknown> = {}) => ({
  projectId: 55,
  name: 'Развязка на М-7',
  city: 'Казань',
  level: 'complex',
  basis: 'participation',
  roles: [
    { role: 'general_contractor', isCurrent: true, origin: 'published' },
    { role: 'customer', isCurrent: true, origin: 'published' },
  ],
  via: null,
  registry: null,
  state: { state: 'construction', validFrom: '2026-01-01' },
  ...over,
});

/** Сводка ДОМ.РФ объекта: поля сайта на дату. */
export const objectRegistry = (over: Record<string, unknown> = {}) => ({
  externalRef: '71431',
  sourceTitle: 'наш.дом.рф',
  asOf: null,
  fetchedAt: '2026-09-20T09:00:00.000Z',
  address: 'Москва город, Мосфильмовская ул., д. 70',
  status: 'Строится',
  completion: 'IV кв. 2027',
  keys: null,
  apartments: '472',
  pricePerSqm: '933 425 ₽',
  propertyClass: 'Бизнес',
  floors: '24',
  sold: null,
  contractor: null,
  developer: 'ООО «СЗ Развитие»',
  group: 'Донстрой',
  ...over,
});

export const objectsBody = (items: unknown[], members: unknown[] = []) => ({
  items,
  members,
  coverage: { loaded: items.length, total: items.length, truncated: false },
});

export const manyPartners = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...partner, companyId: 200 + i, name: `ООО «Партнёр ${i + 1}»`, links: [] }));

const notComputed = {
  status: 'not_computed',
  refresh: { active: null, lastFailure: null, running: false, stale: true, staleReasons: [] },
  signals: null,
};

/** Сведения ЕГРЮЛ из Контур.Фокуса: по умолчанию Фокус не подключён — шапка и разделы как раньше. */
export const focusView = (over: Partial<IFocusView> = {}): IFocusView => ({
  configured: false,
  scheduled: true,
  refreshDays: 14,
  identifier: { type: 'inn', value: '7701000001' },
  problem: null,
  check: null,
  fetchedAt: null,
  fields: [],
  summary: null,
  focusHref: null,
  changes: [],
  coverage: { loaded: 0, truncated: false },
  attribution: 'Сведения ЕГРЮЛ/ЕГРИП по данным Контур.Фокуса на дату проверки. Это записи государственного реестра в изложении сервиса, а не оценка компании.',
  ...over,
});

/** Компания найдена в Фокусе: руководитель сменился при последнем обновлении. */
export const focusFound = (over: Partial<IFocusView> = {}): IFocusView =>
  focusView({
    configured: true,
    check: { outcome: 'found', checkedAt: '2026-10-02T08:00:00Z', nextCheckAt: '2026-10-16T08:00:00Z', attemptCount: 0, lastError: null },
    fetchedAt: '2026-10-01T08:00:00Z',
    fields: [
      { key: 'name', label: 'Краткое наименование', value: 'ООО "МОСТОСТРОЙ"' },
      { key: 'status', label: 'Статус', value: 'Действующее' },
      { key: 'heads', label: 'Руководитель', value: 'Петров Пётр Петрович — Генеральный директор, с 01.09.2026' },
      { key: 'address', label: 'Юридический адрес', value: '420000, Респ Татарстан, г Казань, ул Баумана, д 1' },
      { key: 'activity', label: 'Основной вид деятельности', value: '42.13 Строительство мостов и тоннелей' },
    ],
    summary: {
      status: 'Действующее',
      head: 'Петров Пётр Петрович — Генеральный директор, с 01.09.2026',
      address: '420000, Респ Татарстан, г Казань, ул Баумана, д 1',
    },
    focusHref: 'https://focus.kontur.ru/entity?query=1027700000001',
    changes: [
      {
        fetchedAt: '2026-10-01T08:00:00Z',
        changes: [{ label: 'Руководитель', from: 'Иванов Иван Иванович — Генеральный директор', to: 'Петров Пётр Петрович — Генеральный директор, с 01.09.2026' }],
      },
    ],
    coverage: { loaded: 3, truncated: false },
    ...over,
  });

/** «Кто строит для компании» (24D). По умолчанию компания нигде не заказчик — блока нет. */
export const buildersBody = (over: Partial<ICompanyBuildersResponse> = {}): ICompanyBuildersResponse => ({
  items: [],
  objects: { customerSide: 0, withRegistry: 0, withRegistryContractor: 0, truncated: false },
  ...over,
});

/** Финансы (24B). По умолчанию у компании нет ИНН — блока нет. */
export const financeBody = (over: Partial<ICompanyFinanceResponse> = {}): ICompanyFinanceResponse => ({
  inn: null,
  problem: 'no_inn',
  configured: true,
  scheduled: false,
  finance: null,
  tax: null,
  ...over,
});

export const datasetState = (dataset: IParserApiDatasetState['dataset'], over: Partial<IParserApiDatasetState> = {}): IParserApiDatasetState => ({
  dataset,
  outcome: 'found',
  checkedAt: '2026-10-06T08:00:00Z',
  nextCheckAt: '2027-01-04T08:00:00Z',
  attemptCount: 0,
  lastError: null,
  record: { fetchedAt: '2026-10-06T08:00:00Z', complete: true, missing: [] },
  ...over,
});

export const financeYear = (year: number, revenue: number, netProfit: number): IFinanceYear => ({
  year,
  source: { period: year, publishedDate: `${year + 1}-04-01`, actualDate: null, correctionNumber: 0, audited: year === 2025, pdfUrl: `https://bo.nalog.gov.ru/download/bfo/pdf/${year}` },
  revenue,
  salesProfit: null,
  pretaxProfit: null,
  netProfit,
  interestPayable: 1_000_000,
  assets: 167_500_000_000,
  equity: 106_200_000_000,
  longBorrowings: 39_300_000_000,
  shortBorrowings: 11_300_000_000,
  payables: 6_000_000_000,
  receivables: 36_400_000_000,
  cash: 935_600_000,
});

export const companyRoutes = ({
  withRegistry = false,
  registryOver = {},
  focus = focusView(),
  companyOver = {},
}: { withRegistry?: boolean; registryOver?: Record<string, unknown>; focus?: IFocusView; companyOver?: Record<string, unknown> } = {}): IFakeRoute[] => [
  {
    match: 'GET /api/companies/7/publications',
    respond: () => ({
      status: 200,
      body: {
        items: [publication(), publication({ itemId: 12, revisionId: 22, topic: 'Мост через Оку сдан', snippet: 'Второй пост', facts: [] })],
        nextCursor: null,
      },
    }),
  },
  { match: 'GET /api/revisions/21', respond: () => ({ status: 200, body: revision(21, 'Полный текст первого поста.') }) },
  { match: 'GET /api/revisions/22', respond: () => ({ status: 200, body: revision(22, 'Полный текст второго поста.') }) },
  { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: [partner] } }) },
  { match: 'GET /api/companies/7/projects', respond: () => ({ status: 200, body: { items: [projectRow(), projectRow({ role: 'customer', counterparties: null })] } }) },
  { match: 'GET /api/companies/7/events', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/objects', respond: () => ({ status: 200, body: objectsBody([objectRow()]) }) },
  { match: 'GET /api/companies/7/builders', respond: () => ({ status: 200, body: buildersBody() }) },
  { match: 'GET /api/companies/7/finance', respond: () => ({ status: 200, body: financeBody() }) },
  { match: 'GET /api/companies/7/site', respond: () => ({ status: 200, body: { mode: 'off', candidates: [], familySites: [], search: null } }) },
  { match: 'GET /api/companies/7/similar', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/signals', respond: () => ({ status: 200, body: notComputed }) },
  { match: 'GET /api/companies/7/dossier-summary', respond: () => ({ status: 200, body: summary }) },
  { match: 'GET /api/assertions/', respond: () => ({ status: 404, body: { error: 'нет в тесте' } }) },
  { match: 'GET /api/graph', respond: () => ({ status: 200, body: { nodes: [], edges: [], truncated: false, notes: [] } }) },
  { match: 'GET /api/companies/7/focus', respond: () => ({ status: 200, body: focus }) },
  {
    match: 'GET /api/companies/7',
    respond: () => ({
      status: 200,
      body: { ...(withRegistry ? { ...company, registry: { ...registry, ...registryOver } } : company), ...companyOver },
    }),
  },
];
