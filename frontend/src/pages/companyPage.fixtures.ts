// Синтетические ответы API для тестов карточки компании (companyPage.test.tsx).

import type { IFakeRoute } from '../test/render';

const company = {
  company: { id: 7, name: 'ООО «Мостострой»', city: 'Казань', legalForm: 'ООО', taxId: null, entityType: 'legal_entity' },
  aliases: [{ alias: 'Мостострой', hits: 3 }],
  identifiers: [{ jurisdiction: 'RU', type: 'inn', value: '1655000000', validationStatus: 'checksum_ok', origin: 'registry' }],
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

const notComputed = {
  status: 'not_computed',
  refresh: { active: null, lastFailure: null, running: false, stale: true, staleReasons: [] },
  signals: null,
};

export const companyRoutes = ({ withRegistry = false }: { withRegistry?: boolean } = {}): IFakeRoute[] => [
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
  { match: 'GET /api/companies/7/similar', respond: () => ({ status: 200, body: { items: [] } }) },
  { match: 'GET /api/companies/7/signals', respond: () => ({ status: 200, body: notComputed }) },
  { match: 'GET /api/companies/7/dossier-summary', respond: () => ({ status: 200, body: summary }) },
  { match: 'GET /api/assertions/', respond: () => ({ status: 404, body: { error: 'нет в тесте' } }) },
  { match: 'GET /api/graph', respond: () => ({ status: 200, body: { nodes: [], edges: [], truncated: false, notes: [] } }) },
  {
    match: 'GET /api/companies/7',
    respond: () => ({ status: 200, body: withRegistry ? { ...company, registry } : company }),
  },
];
