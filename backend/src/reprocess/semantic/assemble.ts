// Кандидаты утверждений из проверенного ответа extract@3 одного чанка.
//
// Предикаты: participates_in_project (компания → объект, роль, корпус, пакет, период),
// contract (заказчик договора → исполнитель, объект договора как контекст),
// corporate_relation (владение, контроль, группа, бренд), event (стороны, дело, стадия, сумма).
// Ничего не выводится транзитивно: каждое утверждение — из своей цитаты.

import type { IAssertionCandidate, ICandidateContent, IEvidenceCandidate } from '../candidates.js';
import type { ISemanticVerification } from './verify.js';

export interface IAssembleContext {
  localCompany: ReadonlyMap<string, string>;
  localProject: ReadonlyMap<string, string>;
  mentionToEntity: ReadonlyMap<string, string>;
  locate: (quote: string) => IEvidenceCandidate | null;
  relations: Map<string, IAssertionCandidate>;
  events: Map<string, IAssertionCandidate>;
  chunkIndex: number;
}

const PREDICATE_BY_TYPE = {
  participation: 'participates_in_project',
  contract: 'contract',
  corporate: 'corporate_relation',
} as const;

const refOf = (names: ReadonlyMap<string, string>, mentions: ReadonlyMap<string, string>, name: string | null): string | null => {
  if (!name) return null;
  const mention = names.get(name);
  return mention ? (mentions.get(mention) ?? null) : null;
};

const emptyCandidate = (content: ICandidateContent, review: string | null): IAssertionCandidate => ({
  content,
  evidence: [],
  grounded: false,
  confidence: 0,
  rejectedReason: null,
  review,
});

const pushEvidence = (target: IEvidenceCandidate[], evidence: IEvidenceCandidate | null): void => {
  if (evidence && !target.some(e => e.spanStart === evidence.spanStart && e.spanEnd === evidence.spanEnd)) target.push(evidence);
};

/** Ключ связи: всё, что меняет смысл. Одна компания в двух корпусах — две связи. */
const contentKey = (c: ICandidateContent): string =>
  [
    c.predicate, c.role, c.subjectRef, c.objectRef, c.contextRef, c.scopeBuilding, c.workPackage, c.polarity, c.modality,
    c.validFrom, c.validTo,
  ].join('|');

export const assembleSemantic = (verified: ISemanticVerification, ctx: IAssembleContext): void => {
  for (const relation of verified.relations) {
    const subjectRef = refOf(ctx.localCompany, ctx.mentionToEntity, relation.subject);
    const objectRef =
      relation.type === 'participation'
        ? refOf(ctx.localProject, ctx.mentionToEntity, relation.project)
        : refOf(ctx.localCompany, ctx.mentionToEntity, relation.object);
    if (!subjectRef || !objectRef) continue;
    const content: ICandidateContent = {
      predicate: PREDICATE_BY_TYPE[relation.type],
      role: relation.kind,
      eventType: null,
      subjectRef,
      objectRef,
      counterpartyRef: null,
      contextRef: relation.type === 'contract' ? refOf(ctx.localProject, ctx.mentionToEntity, relation.project) : null,
      validFrom: relation.period.from,
      validTo: relation.period.to,
      periodPrecision: relation.period.precision,
      modality: relation.modality,
      polarity: relation.polarity,
      scopeBuilding: relation.building,
      workPackage: relation.workPackage,
      workPackageLabel: relation.workPackageLabel,
      attributedTo: relation.attributedTo,
      valueType: null,
      valueNumeric: null,
      valueCurrency: null,
    };
    const key = contentKey(content);
    const candidate = ctx.relations.get(key) ?? emptyCandidate(content, relation.review);
    if (relation.quoteVerified) pushEvidence(candidate.evidence, ctx.locate(relation.quote));
    // Одна цитата на проверке, другая — нет: смысл спорный, утверждение остаётся на проверке.
    candidate.review = candidate.review ?? relation.review;
    candidate.confidence = Math.max(candidate.confidence, relation.confidenceFinal);
    ctx.relations.set(key, candidate);
  }

  for (const event of verified.events) {
    const location = event.quoteVerified ? ctx.locate(event.quote) : null;
    const subjectRef = refOf(ctx.localCompany, ctx.mentionToEntity, event.subject);
    const projectRef = refOf(ctx.localProject, ctx.mentionToEntity, event.project);
    if (!subjectRef && !projectRef) continue;
    const key = location ? `${event.type}|${location.spanStart}:${location.spanEnd}` : `${event.type}|c${ctx.chunkIndex}|${ctx.events.size}`;
    const candidate =
      ctx.events.get(key) ??
      emptyCandidate(
        {
          predicate: 'event',
          role: null,
          eventType: event.type,
          subjectRef: subjectRef ?? projectRef,
          objectRef: subjectRef ? projectRef : null,
          counterpartyRef: refOf(ctx.localCompany, ctx.mentionToEntity, event.counterparty),
          contextRef: null,
          validFrom: event.period.from,
          validTo: event.period.to,
          periodPrecision: event.period.precision,
          modality: event.modality,
          polarity: event.polarity,
          scopeBuilding: event.building,
          workPackage: null,
          workPackageLabel: null,
          attributedTo: event.attributedTo,
          caseNumber: event.caseNumber,
          proceduralRole: event.subjectRole,
          counterpartyRole: event.counterpartyRole,
          eventStage: event.stage,
          eventOutcome: event.outcome,
          taxBasis: event.taxBasis,
          valueType: event.amount ? (event.amountPurpose ?? 'amount') : null,
          valueNumeric: event.amount?.value ?? null,
          valueCurrency: event.amount?.currency ?? null,
        },
        event.review,
      );
    pushEvidence(candidate.evidence, location);
    candidate.review = candidate.review ?? event.review;
    candidate.confidence = Math.max(candidate.confidence, event.confidenceFinal);
    ctx.events.set(key, candidate);
  }
};
