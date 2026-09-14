// Синтетические ответы модели для тестов нового конвейера. Названия и реквизиты
// вымышленные; ИНН подобраны под контрольную сумму, реальным компаниям не принадлежат.

import { emptyExtraction, type IExtraction } from '../../llm/schema.js';
import type { ILlmResult } from '../../llm/client.js';
import type { IModelProvider } from '../provider.js';

export const INN_A = '5001007329';
export const INN_B = '7700000016';

type Company = IExtraction['companies'][number];
type Project = IExtraction['projects'][number];
type Link = IExtraction['links'][number];
type Event = IExtraction['events'][number];

export const company = (name: string, quote: string, over: Partial<Company> = {}): Company => ({
  name,
  legal_form: null,
  tax_id: null,
  role: 'unknown',
  sentiment: 'neutral',
  quote,
  confidence: 0.95,
  ...over,
});

export const project = (name: string, quote: string, over: Partial<Project> = {}): Project => ({
  name,
  kind: 'residential',
  city: null,
  address: null,
  stage: 'construction',
  quote,
  confidence: 0.95,
  ...over,
});

export const link = (companyName: string, projectName: string, role: Link['role']): Link => ({
  company: companyName,
  project: projectName,
  role,
  confidence: 0.95,
});

export const event = (type: Event['type'], quote: string, over: Partial<Event> = {}): Event => ({
  type,
  company: null,
  counterparty: null,
  project: null,
  occurred_on: null,
  amount_rub: null,
  quote,
  confidence: 0.95,
  ...over,
});

export const extraction = (over: Partial<IExtraction> = {}): IExtraction => ({
  ...emptyExtraction(),
  doc_relevant: true,
  ...over,
});

const usage = { tokensIn: 10, tokensOut: 10, latencyMs: 1 };

export const ok = (data: IExtraction): ILlmResult => ({ ok: true, data, usage, rawResponse: JSON.stringify(data) });

/**
 * Детерминированный провайдер: ответ выбирается по тексту чанка. Функция
 * может бросить (timeout) или вернуть отказ. Счётчик вызовов — для проверки,
 * что готовые чанки повторно модели не отдаются.
 */
export const fakeProvider = (
  respond: (text: string, call: number) => Promise<ILlmResult> | ILlmResult,
  model = 'fake-model',
): IModelProvider & { calls: string[] } => {
  const calls: string[] = [];
  return {
    provider: 'fake',
    model,
    params: { temperature: 0 },
    calls,
    extract: async text => {
      calls.push(text);
      return respond(text, calls.length);
    },
  };
};
