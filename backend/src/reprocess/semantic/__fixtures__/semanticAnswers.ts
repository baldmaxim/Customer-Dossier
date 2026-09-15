// Шаблонные ответы extract@3 для тестов этапа 06. Это не ответы реальной модели.

import type {
  ISemanticCompany,
  ISemanticEvent,
  ISemanticExtraction,
  ISemanticProject,
  ISemanticRelation,
} from '../../../llm/semantic/schema.js';
import type { ILlmResult } from '../../../llm/client.js';
import type { IModelProvider } from '../../provider.js';

export const company = (name: string, quote: string, over: Partial<ISemanticCompany> = {}): ISemanticCompany => ({
  name,
  legal_form: null,
  tax_id: null,
  quote,
  confidence: 0.95,
  ...over,
});

export const project = (name: string, quote: string, over: Partial<ISemanticProject> = {}): ISemanticProject => ({
  name,
  kind: 'residential',
  city: null,
  address: null,
  quote,
  confidence: 0.95,
  ...over,
});

export const relation = (over: Partial<ISemanticRelation> & Pick<ISemanticRelation, 'type' | 'kind' | 'subject' | 'quote'>): ISemanticRelation => ({
  object: null,
  project: null,
  building: null,
  work_package: null,
  polarity: 'positive',
  modality: 'reported_fact',
  attributed_to: null,
  date_from: null,
  date_to: null,
  date_precision: null,
  confidence: 0.95,
  ...over,
});

export const event = (over: Partial<ISemanticEvent> & Pick<ISemanticEvent, 'type' | 'quote'>): ISemanticEvent => ({
  subject: null,
  project: null,
  building: null,
  counterparty: null,
  subject_role: null,
  counterparty_role: null,
  case_number: null,
  stage: null,
  outcome: null,
  polarity: 'positive',
  modality: 'reported_fact',
  attributed_to: null,
  date_from: null,
  date_to: null,
  date_precision: null,
  amount: null,
  currency: null,
  amount_purpose: null,
  tax_basis: null,
  confidence: 0.95,
  ...over,
});

export const answer = (over: Partial<ISemanticExtraction>): ISemanticExtraction => ({
  doc_relevant: true,
  companies: [],
  projects: [],
  relations: [],
  events: [],
  ...over,
});

const usage = { tokensIn: 10, tokensOut: 10, latencyMs: 1 };

export const okSemantic = (data: ISemanticExtraction): ILlmResult<ISemanticExtraction> => ({ ok: true, data, usage, rawResponse: JSON.stringify(data) });

/** Детерминированный провайдер extract@3: ответ по тексту чанка. */
export const semanticProvider = (respond: (text: string) => ISemanticExtraction): IModelProvider => ({
  provider: 'fake',
  model: 'fake-semantic',
  params: { temperature: 0 },
  schemaVersion: 'extract@3',
  extract: async text => okSemantic(respond(text)),
});
