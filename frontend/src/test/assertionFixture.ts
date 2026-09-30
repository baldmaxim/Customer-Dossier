// Синтетическое сведение с цитатами для тестов «Откуда известно» (AssertionDetail, списки, схема).

import type { IAssertion, IEvidenceRow, IReviewRow } from '../api/types';

export const assertionRow = (id: number, over: Partial<IAssertion> = {}): IAssertion => ({
  id,
  predicate: 'contract',
  role: 'subcontract',
  eventType: null,
  subjectCompanyId: 1,
  subjectCompanyName: 'Бета-Демо',
  subjectProjectId: null,
  subjectProjectName: null,
  subjectText: null,
  objectCompanyId: 2,
  objectCompanyName: 'Дельта-Демо',
  objectProjectId: null,
  objectProjectName: null,
  objectText: null,
  counterpartyCompanyName: null,
  contextProjectName: 'ЖК Демо',
  polarity: 'positive',
  scopeBuilding: 'корпус 3',
  workPackage: null,
  validFrom: '2024-03-01',
  validTo: null,
  periodPrecision: 'month',
  modality: 'reported_fact',
  valueNumeric: '38100000',
  valueCurrency: 'RUB',
  valueType: 'contract',
  status: 'text_grounded',
  needsRevalidation: false,
  version: 3,
  confidenceExtraction: 0.87,
  origin: 'extraction',
  supportsCount: 1,
  contradictsCount: 1,
  ...over,
});

export const evidenceRow = (id: number, over: Partial<IEvidenceRow> = {}): IEvidenceRow => ({
  id,
  stance: 'supports',
  status: 'active',
  statusReason: null,
  quote: 'Бета-Демо заключила договор субподряда с Дельта-Демо',
  contextBefore: 'По данным пресс-службы, ',
  contextAfter: ' на работы по корпусу 3.',
  revisionId: 9,
  revisionNo: 2,
  completeness: 'full',
  legacyDocumentId: 19,
  runId: 77,
  sourceTitle: 'Стройка онлайн',
  url: 'https://t.me/stroy/1',
  publishedAt: '2026-09-14T08:20:00Z',
  ...over,
});

export const reviewRow = (id: number, over: Partial<IReviewRow> = {}): IReviewRow => ({
  id,
  decision: 'reviewed_supported',
  scope: 'reflects_source',
  reviewer: 'a.petrova',
  reason: null,
  assertionVersion: 2,
  provenanceGap: false,
  decidedAt: '2026-09-21T10:00:00Z',
  ...over,
});

/** Ответ GET /api/assertions/:id: цитата за, исключённая цитата и цитата против. */
export const assertionResponse = (id: number, over: Partial<IAssertion> = {}) => ({
  assertion: assertionRow(id, over),
  evidence: [
    evidenceRow(id * 10 + 1),
    evidenceRow(id * 10 + 2, { status: 'withdrawn', statusReason: 'перепечатка без первоисточника', quote: 'договор с Дельта-Демо', legacyDocumentId: null, url: null }),
    evidenceRow(id * 10 + 3, { stance: 'contradicts', quote: 'Дельта-Демо не работает с Бета-Демо', sourceTitle: 'Недвижимость изнутри' }),
  ],
  reviews: [reviewRow(1), reviewRow(2, { decision: 'disputed', reason: 'нужен первоисточник', provenanceGap: true })],
});
