// Схема извлечения extract@1: JSON Schema для LM Studio + зеркальная zod-схема.
//
// Две схемы вместо одной — намеренно. JSON Schema принуждает модель к форме
// ответа (structured output), zod проверяет то, что реально пришло: LM Studio
// соблюдает схему не идеально, а на обрыве генерации отдаёт обрезанный JSON.

import { z } from 'zod';

export const SCHEMA_VERSION = 'extract@2';

export const ROLES = [
  'customer',
  'general_contractor',
  'contractor',
  'designer',
  'investor',
  'operator',
  // Упомянута в тексте, но в стройке не участвует: аналитик, консалтинг,
  // брокер, банк, СМИ, орган власти с комментарием. Без этого варианта модель
  // обязана выбрать строительную роль и выбирала ближайшую — «проектировщик»:
  // на живых данных вышло 15 проектировщиков при 1 генподрядчике.
  'not_participant',
  'unknown',
] as const;

/** Роли, которые не описывают участие в стройке и в канон как роль не пишутся. */
export const NON_PARTICIPANT_ROLES: ReadonlySet<string> = new Set(['not_participant', 'unknown']);

export const PROJECT_KINDS = [
  'residential',
  'office',
  'industrial',
  'infrastructure',
  'social',
  'other',
] as const;

export const PROJECT_STAGES = [
  'announced',
  'design',
  'construction',
  'suspended',
  'commissioned',
  'cancelled',
  'unknown',
] as const;

export const EVENT_TYPES = [
  'construction_start',
  'milestone',
  'delay',
  'deadline_missed',
  'court_case',
  'contractor_change',
  'commissioning',
  'bankruptcy',
  'license_revoked',
  'tender_award',
  'other',
] as const;

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

/**
 * LM Studio в режиме strict требует: все свойства перечислены в required,
 * additionalProperties: false в каждом объекте, nullable — через тип-массив
 * ["string","null"], а не через "nullable": true.
 */
const nullableString = { type: ['string', 'null'] } as const;
const confidence = { type: 'number', minimum: 0, maximum: 1 } as const;

export const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_relevant', 'companies', 'projects', 'links', 'events'],
  properties: {
    doc_relevant: { type: 'boolean' },
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'legal_form', 'tax_id', 'role', 'sentiment', 'quote', 'confidence'],
        properties: {
          name: { type: 'string' },
          legal_form: nullableString,
          tax_id: nullableString,
          role: { type: 'string', enum: ROLES },
          sentiment: { type: 'string', enum: SENTIMENTS },
          quote: { type: 'string' },
          confidence,
        },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'city', 'address', 'stage', 'quote', 'confidence'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS },
          city: nullableString,
          address: nullableString,
          stage: { type: 'string', enum: PROJECT_STAGES },
          quote: { type: 'string' },
          confidence,
        },
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['company', 'project', 'role', 'confidence'],
        properties: {
          company: { type: 'string' },
          project: { type: 'string' },
          role: { type: 'string', enum: ROLES },
          confidence,
        },
      },
    },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'company',
          'counterparty',
          'project',
          'occurred_on',
          'amount_rub',
          'quote',
          'confidence',
        ],
        properties: {
          type: { type: 'string', enum: EVENT_TYPES },
          company: nullableString,
          counterparty: nullableString,
          project: nullableString,
          occurred_on: nullableString,
          amount_rub: { type: ['number', 'null'] },
          quote: { type: 'string' },
          confidence,
        },
      },
    },
  },
} as const;

// --- zod: проверка того, что реально пришло ---

const confidenceSchema = z.number().min(0).max(1);

export const companyExtractSchema = z.object({
  name: z.string().min(1).max(300),
  legal_form: z.string().max(100).nullish(),
  tax_id: z.string().max(20).nullish(),
  role: z.enum(ROLES),
  sentiment: z.enum(SENTIMENTS),
  quote: z.string().min(1).max(4000),
  confidence: confidenceSchema,
});

export const projectExtractSchema = z.object({
  name: z.string().min(1).max(300),
  kind: z.enum(PROJECT_KINDS),
  city: z.string().max(120).nullish(),
  address: z.string().max(400).nullish(),
  stage: z.enum(PROJECT_STAGES),
  quote: z.string().min(1).max(4000),
  confidence: confidenceSchema,
});

export const linkExtractSchema = z.object({
  company: z.string().min(1).max(300),
  project: z.string().min(1).max(300),
  role: z.enum(ROLES),
  confidence: confidenceSchema,
});

export const eventExtractSchema = z.object({
  type: z.enum(EVENT_TYPES),
  company: z.string().max(300).nullish(),
  counterparty: z.string().max(300).nullish(),
  project: z.string().max(300).nullish(),
  occurred_on: z.string().max(40).nullish(),
  amount_rub: z.number().nonnegative().nullish(),
  quote: z.string().min(1).max(4000),
  confidence: confidenceSchema,
});

/**
 * superRefine проверяет ссылочную целостность: links и events ссылаются на
 * сущности строками-именами из этого же ответа. Висячая ссылка не должна
 * ронять весь документ — её отбрасывает cleanExtraction ниже, а здесь мы
 * лишь фиксируем, что структура сама по себе валидна.
 */
export const extractionSchema = z.object({
  doc_relevant: z.boolean(),
  companies: z.array(companyExtractSchema).max(50),
  projects: z.array(projectExtractSchema).max(50),
  links: z.array(linkExtractSchema).max(100),
  events: z.array(eventExtractSchema).max(50),
});

export type ICompanyExtract = z.infer<typeof companyExtractSchema>;
export type IProjectExtract = z.infer<typeof projectExtractSchema>;
export type ILinkExtract = z.infer<typeof linkExtractSchema>;
export type IEventExtract = z.infer<typeof eventExtractSchema>;
export type IExtraction = z.infer<typeof extractionSchema>;

export const emptyExtraction = (): IExtraction => ({
  doc_relevant: false,
  companies: [],
  projects: [],
  links: [],
  events: [],
});
