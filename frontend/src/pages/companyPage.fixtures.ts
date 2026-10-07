// Синтетические ответы API для тестов карточки компании (companyPage.test.tsx).

import type { IFakeRoute } from '../test/render';
import type { IBankruptcyView, ICompanyBuildersResponse, ICompanyChecksResponse, ICompanyDelivery, IDeliveryHouse, ICompanyFinanceResponse, IEventStats, IFinanceYear, IFocusView, IParserApiDatasetState, IPublicationStats } from '../api/types';

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

/** 24 месяца по октябрь 2026, значения — с конца ряда (ряд итогов: публикации ленты, события списка). */
const SERIES_MONTHS = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2026, 9 - (23 - i), 1)).toISOString().slice(0, 7));

export const monthSeries = (tail: number[], excluded: Partial<Record<'undated' | 'beforeWindow' | 'future' | 'coarse' | 'registry', number>> = {}) => {
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

/** Итоги ленты публикаций (GET /companies/7/publication-stats) — тот же набор, что лента: две публикации. */
export const publicationStats = (over: Partial<IPublicationStats> = {}): IPublicationStats => ({
  total: 2,
  undated: 0,
  last90: 2,
  latestAt: '2026-09-30T12:00:00Z',
  sources: 1,
  completeness: { full: 2 },
  families: { total: 2, established: 0, named: 0, unknown: 2 },
  byMonth: monthSeries([0, 2]) as IPublicationStats['byMonth'],
  ...over,
});

/** Итоги списка событий (stats в ответе GET /companies/7/events): по умолчанию событий нет. */
export const eventStats = (over: Partial<IEventStats> = {}): IEventStats => ({
  total: 0,
  dated12m: 0,
  undated: 0,
  byType: [],
  byMonth: monthSeries([]) as IEventStats['byMonth'],
  ...over,
});

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

/** Свод ДОМ.РФ объекта по домам (сервер, registry/houses.ts): один строящийся дом. */
export const objectRegistry = (over: Record<string, unknown> = {}) => ({
  sourceTitle: 'наш.дом.рф',
  houses: 1,
  delivered: 0,
  inProgress: 1,
  status: 'Строится',
  completion: { from: 'IV кв. 2027', to: 'IV кв. 2027' },
  keys: null,
  propertyClass: 'Бизнес',
  floors: '24',
  developer: 'ООО «СЗ Развитие»',
  group: 'Донстрой',
  address: 'Москва город, Мосфильмовская ул., д. 70',
  apartments: 472,
  apartmentsCounted: 1,
  soldShare: null,
  pricePerSqm: { min: 933_425, max: 933_425 },
  contractors: [],
  asOf: '2026-09-20',
  fetchedAt: '2026-09-20T09:00:00.000Z',
  photoRef: null,
  hasPhoto: false,
  ...over,
});

/** Ответ вкладки «Объекты»: roles — как считает сервер (роли самой компании на её объектах, без объектов СЗ группы). */
export const objectsBody = (items: unknown[], members: unknown[] = []) => {
  const counts = new Map<string, number>();
  for (const o of items as Array<{ via: unknown; roles: Array<{ role: string }> }>) {
    if (o.via) continue;
    for (const role of new Set(o.roles.map(r => r.role))) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return {
    items,
    roles: [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    members,
    coverage: { loaded: items.length, total: items.length, truncated: false },
  };
};

export const manyPartners = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...partner, companyId: 200 + i, name: `ООО «Партнёр ${i + 1}»`, links: [] }));


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

/** Суды, ФССП, банкротство (24C). По умолчанию у компании нет ИНН — блока нет. */
export const checksBody = (over: Partial<ICompanyChecksResponse> = {}): ICompanyChecksResponse => ({
  inn: null,
  problem: 'no_inn',
  configured: true,
  scheduled: false,
  courts: null,
  fssp: null,
  bankruptcy: null,
  ...over,
});

/** ЕФРСБ (bankruptcy-map@2). По умолчанию — должник найден, сообщения не запрашивались (снимок до @2). */
export const efrsbView = (over: Partial<IBankruptcyView> = {}): IBankruptcyView => ({
  format: 'bankruptcy-map@2',
  recognized: true,
  problems: [],
  found: true,
  record: { name: 'ООО «ДЕМО»', category: 'Обычная организация', region: 'г. Москва', address: null },
  missing: [],
  messages: null,
  courtActs: null,
  courtActsCoverage: null,
  procedureAct: null,
  laterAct: null,
  caseNumbers: [],
  ...over,
});

/** Сроки и продажи по домам ДОМ.РФ (24E). По умолчанию домов нет — блока нет. */
export const deliveryBody = (over: Partial<ICompanyDelivery> = {}): ICompanyDelivery => ({
  format: 'delivery@1',
  observedSince: null,
  houses: 0,
  inProgress: { count: 0, apartments: 0 },
  delivered: { recent: 0, recentApartments: 0, older: 0, windowFrom: '2024-10-06' },
  pastDue: [],
  shifts: [],
  sales: { apartments: 0, share: null, counted: 0, price: null },
  dynamics: null,
  unparsed: { completion: 0, apartments: 0 },
  list: [],
  truncated: false,
  ...over,
});

export const deliveryHouse = (ref: string, over: Partial<IDeliveryHouse> = {}): IDeliveryHouse => ({
  externalRef: ref,
  name: `Дом ${ref}`,
  projectId: 60,
  projectName: 'Река',
  status: 'Строится',
  delivered: false,
  completion: 'IV кв. 2027',
  completionParsed: { year: 2027, quarter: 4 },
  pastDue: false,
  apartments: 400,
  soldShare: 0.5,
  price: 500_000,
  date: '2026-10-02',
  url: `https://xn--80az8a.xn--d1aqf.xn--p1ai/сервисы/каталог-новостроек/объект/${ref}`,
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
  { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: [partner], counts: { companies: 1, contracts: 1, corporate: 0 } } }) },
  { match: 'GET /api/companies/7/events', respond: () => ({ status: 200, body: { items: [], total: 0, stats: eventStats() } }) },
  { match: 'GET /api/companies/7/publication-stats', respond: () => ({ status: 200, body: publicationStats() }) },
  { match: 'GET /api/companies/7/objects', respond: () => ({ status: 200, body: objectsBody([objectRow()]) }) },
  { match: 'GET /api/companies/7/builders', respond: () => ({ status: 200, body: buildersBody() }) },
  { match: 'GET /api/companies/7/finance', respond: () => ({ status: 200, body: financeBody() }) },
  { match: 'GET /api/companies/7/registry-checks', respond: () => ({ status: 200, body: checksBody() }) },
  { match: 'GET /api/companies/7/delivery', respond: () => ({ status: 200, body: deliveryBody() }) },
  { match: 'GET /api/companies/7/site-projects', respond: () => ({ status: 200, body: { sites: [], projects: [], waiting: 0 } }) },
  { match: 'GET /api/companies/7/site', respond: () => ({ status: 200, body: { mode: 'off', candidates: [], familySites: [], search: null } }) },
  { match: 'GET /api/companies/7/similar', respond: () => ({ status: 200, body: { items: [] } }) },
  // Без своей строки запрос назначения попадал в общий «GET /api/companies/7» и получал тело карточки.
  {
    match: 'GET /api/companies/7/assignment',
    respond: () => ({ status: 200, body: { state: 'unidentified', dismissal: null, portal: [], egrul: [], search: null, focusConfigured: false } }),
  },
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
