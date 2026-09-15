// Схема извлечения extract@3 (этап 06): типизированные связи и события с временным смыслом.
//
// Отличия от extract@2:
//  - роль — не свойство компании: у companies нет role/sentiment;
//  - связи (relations) — участие в объекте, договор между компаниями, корпоративная связь;
//    у каждой своя цитата, полярность, модальность, корпус, пакет работ и период;
//  - события — стороны с процессуальными ролями, номер дела, стадия, результат, интервал
//    даты с точностью, сумма строкой с валютой и назначением;
//  - совместное упоминание и совместное участие модель не выводит: они считаются из
//    опубликованных утверждений (представления миграции 017), а не синонимом договора.
//
// Старые ответы extract@2 не переписываются: сборка кандидатов понимает обе версии.

import { z } from 'zod';

import { PROJECT_KINDS } from '../schema.js';

export const SEMANTIC_SCHEMA_VERSION = 'extract@3';

export const RELATION_TYPES = ['participation', 'contract', 'corporate'] as const;

/** Участие компании в объекте: роль на объекте, а не вообще. */
export const PARTICIPATION_ROLES = [
  'customer',
  'general_contractor',
  'contractor',
  'subcontractor',
  'supplier',
  'designer',
  'investor',
  'operator',
] as const;

/** Прямой договор: subject — заказчик договора, object — исполнитель. */
export const CONTRACT_KINDS = ['general_contract', 'subcontract', 'supply', 'design_contract', 'contract'] as const;

/** Корпоративная связь: только если прямо написано. */
export const CORPORATE_KINDS = ['owns_share', 'controls', 'member_of_group', 'brand_of'] as const;

export const RELATION_KINDS = [...PARTICIPATION_ROLES, ...CONTRACT_KINDS, ...CORPORATE_KINDS] as const;

export const KINDS_BY_TYPE: Record<(typeof RELATION_TYPES)[number], readonly string[]> = {
  participation: PARTICIPATION_ROLES,
  contract: CONTRACT_KINDS,
  corporate: CORPORATE_KINDS,
};

export const POLARITIES = ['positive', 'negative'] as const;
export const SEMANTIC_MODALITIES = ['reported_fact', 'claim', 'planned', 'possible'] as const;
export const DATE_PRECISIONS = ['day', 'month', 'quarter', 'year'] as const;

export const SEMANTIC_EVENT_TYPES = [
  'construction_start',
  'milestone',
  'delay',
  'deadline_missed',
  'suspension',
  'resumption',
  'cancellation',
  'commissioning',
  'court_case',
  'bankruptcy_intent',
  'bankruptcy_filing',
  'bankruptcy_procedure',
  'payment_claim',
  'contractor_change',
  'license_revoked',
  'tender_award',
  'other',
] as const;

export const PROCEDURAL_ROLES = ['plaintiff', 'defendant', 'applicant', 'creditor', 'debtor', 'third_party'] as const;

export const EVENT_STAGES = [
  'claim_filed',
  'accepted',
  'hearing',
  'decision',
  'appeal_filed',
  'appeal_decision',
  'cassation',
  'enforcement',
  'settled',
  'withdrawn',
  'procedure_introduced',
  'procedure_completed',
] as const;

export const EVENT_OUTCOMES = ['satisfied', 'partially_satisfied', 'dismissed', 'overturned', 'settled'] as const;
export const AMOUNT_PURPOSES = ['claim', 'award', 'contract', 'debt', 'penalty', 'other'] as const;
export const TAX_BASES = ['with_vat', 'without_vat'] as const;

const nullableString = { type: ['string', 'null'] } as const;
const nullableEnum = (values: readonly string[]) => ({ type: ['string', 'null'], enum: [...values, null] }) as const;
const confidence = { type: 'number', minimum: 0, maximum: 1 } as const;

/** Требования LM Studio strict: все свойства в required, additionalProperties: false, nullable — тип-массивом. */
export const SEMANTIC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_relevant', 'companies', 'projects', 'relations', 'events'],
  properties: {
    doc_relevant: { type: 'boolean' },
    companies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'legal_form', 'tax_id', 'quote', 'confidence'],
        properties: { name: { type: 'string' }, legal_form: nullableString, tax_id: nullableString, quote: { type: 'string' }, confidence },
      },
    },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'city', 'address', 'quote', 'confidence'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: PROJECT_KINDS },
          city: nullableString,
          address: nullableString,
          quote: { type: 'string' },
          confidence,
        },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type', 'kind', 'subject', 'object', 'project', 'building', 'work_package', 'polarity', 'modality',
          'attributed_to', 'date_from', 'date_to', 'date_precision', 'quote', 'confidence',
        ],
        properties: {
          type: { type: 'string', enum: RELATION_TYPES },
          kind: { type: 'string', enum: RELATION_KINDS },
          subject: { type: 'string' },
          object: nullableString,
          project: nullableString,
          building: nullableString,
          work_package: nullableString,
          polarity: { type: 'string', enum: POLARITIES },
          modality: { type: 'string', enum: SEMANTIC_MODALITIES },
          attributed_to: nullableString,
          date_from: nullableString,
          date_to: nullableString,
          date_precision: nullableEnum(DATE_PRECISIONS),
          quote: { type: 'string' },
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
          'type', 'subject', 'project', 'building', 'counterparty', 'subject_role', 'counterparty_role', 'case_number',
          'stage', 'outcome', 'polarity', 'modality', 'attributed_to', 'date_from', 'date_to', 'date_precision',
          'amount', 'currency', 'amount_purpose', 'tax_basis', 'quote', 'confidence',
        ],
        properties: {
          type: { type: 'string', enum: SEMANTIC_EVENT_TYPES },
          subject: nullableString,
          project: nullableString,
          building: nullableString,
          counterparty: nullableString,
          subject_role: nullableEnum(PROCEDURAL_ROLES),
          counterparty_role: nullableEnum(PROCEDURAL_ROLES),
          case_number: nullableString,
          stage: nullableEnum(EVENT_STAGES),
          outcome: nullableEnum(EVENT_OUTCOMES),
          polarity: { type: 'string', enum: POLARITIES },
          modality: { type: 'string', enum: SEMANTIC_MODALITIES },
          attributed_to: nullableString,
          date_from: nullableString,
          date_to: nullableString,
          date_precision: nullableEnum(DATE_PRECISIONS),
          amount: nullableString,
          currency: nullableString,
          amount_purpose: nullableEnum(AMOUNT_PURPOSES),
          tax_basis: nullableEnum(TAX_BASES),
          quote: { type: 'string' },
          confidence,
        },
      },
    },
  },
} as const;

// --- zod: проверка того, что реально пришло ---

const conf = z.number().min(0).max(1);
const opt = (max: number) => z.string().max(max).nullish().transform(v => v ?? null);
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values).nullish().transform(v => v ?? null);

export const semanticCompanySchema = z.object({
  name: z.string().min(1).max(300),
  legal_form: opt(100),
  tax_id: opt(20),
  quote: z.string().min(1).max(4000),
  confidence: conf,
});

export const semanticProjectSchema = z.object({
  name: z.string().min(1).max(300),
  kind: z.enum(PROJECT_KINDS),
  city: opt(120),
  address: opt(400),
  quote: z.string().min(1).max(4000),
  confidence: conf,
});

export const semanticRelationSchema = z.object({
  type: z.enum(RELATION_TYPES),
  kind: z.enum(RELATION_KINDS),
  subject: z.string().min(1).max(300),
  object: opt(300),
  project: opt(300),
  building: opt(120),
  work_package: opt(200),
  polarity: z.enum(POLARITIES),
  modality: z.enum(SEMANTIC_MODALITIES),
  attributed_to: opt(300),
  date_from: opt(40),
  date_to: opt(40),
  date_precision: optEnum(DATE_PRECISIONS),
  quote: z.string().min(1).max(4000),
  confidence: conf,
});

export const semanticEventSchema = z.object({
  type: z.enum(SEMANTIC_EVENT_TYPES),
  subject: opt(300),
  project: opt(300),
  building: opt(120),
  counterparty: opt(300),
  subject_role: optEnum(PROCEDURAL_ROLES),
  counterparty_role: optEnum(PROCEDURAL_ROLES),
  case_number: opt(80),
  stage: optEnum(EVENT_STAGES),
  outcome: optEnum(EVENT_OUTCOMES),
  polarity: z.enum(POLARITIES),
  modality: z.enum(SEMANTIC_MODALITIES),
  attributed_to: opt(300),
  date_from: opt(40),
  date_to: opt(40),
  date_precision: optEnum(DATE_PRECISIONS),
  amount: opt(40),
  currency: opt(20),
  amount_purpose: optEnum(AMOUNT_PURPOSES),
  tax_basis: optEnum(TAX_BASES),
  quote: z.string().min(1).max(4000),
  confidence: conf,
});

export const semanticExtractionSchema = z.object({
  doc_relevant: z.boolean(),
  companies: z.array(semanticCompanySchema).max(50),
  projects: z.array(semanticProjectSchema).max(50),
  relations: z.array(semanticRelationSchema).max(100),
  events: z.array(semanticEventSchema).max(50),
});

export type ISemanticCompany = z.infer<typeof semanticCompanySchema>;
export type ISemanticProject = z.infer<typeof semanticProjectSchema>;
export type ISemanticRelation = z.infer<typeof semanticRelationSchema>;
export type ISemanticEvent = z.infer<typeof semanticEventSchema>;
export type ISemanticExtraction = z.infer<typeof semanticExtractionSchema>;

/** Ответ extract@3 отличается наличием relations; у extract@2 — links. */
export const isSemanticExtraction = (payload: unknown): payload is ISemanticExtraction =>
  typeof payload === 'object' && payload !== null && Array.isArray((payload as { relations?: unknown }).relations);
