// Модель утверждения: содержательная идентичность и производное состояние.
// Чистые функции — проверяются без базы.

import { createHash } from 'node:crypto';

export const ASSERTION_STATUSES = ['candidate', 'text_grounded', 'reviewed_supported', 'disputed', 'rejected'] as const;
export type AssertionStatus = (typeof ASSERTION_STATUSES)[number];

export const REVIEW_DECISIONS = ['reviewed_supported', 'disputed', 'rejected', 'candidate'] as const;
export type ReviewDecisionValue = (typeof REVIEW_DECISIONS)[number];

export const MODALITIES = ['reported_fact', 'claim', 'planned', 'possible', 'negated', 'unknown'] as const;
export type Modality = (typeof MODALITIES)[number];

export type Predicate = 'participates_in_project' | 'event' | 'company_mentioned' | 'project_mentioned';
export type EvidenceStance = 'supports' | 'contradicts' | 'mentions';

export interface IAssertionContent {
  predicate: Predicate;
  role: string | null;
  eventType: string | null;
  subjectCompanyId: number | null;
  subjectProjectId: number | null;
  subjectText: string | null;
  objectCompanyId: number | null;
  objectProjectId: number | null;
  objectText: string | null;
  counterpartyCompanyId: number | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: 'day' | 'month' | 'quarter' | 'year' | 'unknown';
  modality: Modality;
  valueType: string | null;
  valueNumeric: string | null;
  valueCurrency: string | null;
}

/**
 * Ключ содержательной идентичности. В него входит всё, что меняет смысл:
 * предикат, роль/тип события, обе стороны, корпус, пакет работ, период,
 * модальность и значение. Одна компания в двух корпусах — два утверждения;
 * «планирует» и «является» — два утверждения. Порядок полей фиксирован.
 */
export const assertionContentKey = (content: IAssertionContent): string => {
  const canonical = [
    content.predicate,
    content.role,
    content.eventType,
    content.subjectCompanyId,
    content.subjectProjectId,
    content.subjectText?.trim().toLowerCase() ?? null,
    content.objectCompanyId,
    content.objectProjectId,
    content.objectText?.trim().toLowerCase() ?? null,
    content.counterpartyCompanyId,
    content.scopeBuilding?.trim().toLowerCase() ?? null,
    content.workPackage?.trim().toLowerCase() ?? null,
    content.validFrom,
    content.validTo,
    content.periodPrecision,
    content.modality,
    content.valueType,
    content.valueNumeric,
    content.valueCurrency,
  ];
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
};

export interface IEvidenceRef {
  id: number;
  stance: EvidenceStance;
  status: 'active' | 'withdrawn' | 'unavailable';
}

/** Хэш набора активных доказательств: какое основание было перед глазами при решении. */
export const evidenceSetHash = (evidence: readonly IEvidenceRef[]): string => {
  const active = evidence
    .filter(e => e.status === 'active')
    .map(e => `${e.id}:${e.stance}`)
    .sort();
  return createHash('sha256').update(active.join('|'), 'utf8').digest('hex');
};

export interface ILatestDecision {
  decision: ReviewDecisionValue;
  evidenceSetHash: string;
}

export interface IAssertionState {
  status: AssertionStatus;
  needsRevalidation: boolean;
}

/**
 * Состояние утверждения.
 *  - Есть решение аналитика — статус из решения. Если набор доказательств с тех
 *    пор изменился (отзыв, новое основание, опровержение), решение не удаляется,
 *    но утверждение требует пересмотра.
 *  - Решения нет — техническое состояние: text_grounded, если есть активное
 *    поддерживающее доказательство, иначе candidate. Grounded значит «так
 *    написано в тексте», а не «это правда».
 */
export const deriveAssertionState = (
  evidence: readonly IEvidenceRef[],
  latest: ILatestDecision | null,
): IAssertionState => {
  const currentHash = evidenceSetHash(evidence);
  // Решение «candidate» — снять оценку и вернуть утверждение на проверку.
  if (latest && latest.decision !== 'candidate') {
    return { status: latest.decision, needsRevalidation: latest.evidenceSetHash !== currentHash };
  }
  const grounded = evidence.some(e => e.status === 'active' && e.stance === 'supports');
  return { status: grounded ? 'text_grounded' : 'candidate', needsRevalidation: false };
};
