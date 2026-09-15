// Содержание утверждения из кандидата набора и опровержение при отрицании (этап 06).
//
// Отрицание («не является генподрядчиком») — отдельное утверждение с polarity=negative.
// Если такое же положительное утверждение уже есть, цитата отрицания добавляется к нему
// как contradicts: противоречие видно, решение аналитика не удаляется, а требует пересмотра.

import type { PoolClient } from 'pg';

import { assertionContentKey, eventQuoteDiscriminator, type IAssertionContent } from '../assertions/model.js';
import { addEvidence } from '../assertions/repository.js';
import type { IEvidenceSpan } from '../assertions/span.js';
import type { ICandidateContent, IEvidenceCandidate } from './candidates.js';

export interface IResolvedParties {
  subject: { kind: string; id: number };
  object: { kind: string; id: number } | null;
  counterparty: { kind: string; id: number } | null;
  context: { kind: string; id: number } | null;
}

/** Событие без даты, суммы, контрагента и номера дела различается своей цитатой: два суда — два утверждения. */
export const needsQuoteDiscriminator = (c: ICandidateContent): boolean =>
  c.predicate === 'event' && !c.validFrom && !c.valueNumeric && !c.counterpartyRef && !c.caseNumber;

export const toAssertionContent = (
  c: ICandidateContent,
  parties: IResolvedParties,
  evidence: readonly IEvidenceCandidate[],
): IAssertionContent => ({
  predicate: c.predicate,
  role: c.role,
  eventType: c.eventType,
  subjectCompanyId: parties.subject.kind === 'company' ? parties.subject.id : null,
  subjectProjectId: parties.subject.kind === 'project' ? parties.subject.id : null,
  subjectText: null,
  objectCompanyId: parties.object?.kind === 'company' ? parties.object.id : null,
  objectProjectId: parties.object?.kind === 'project' ? parties.object.id : null,
  objectText: null,
  counterpartyCompanyId: parties.counterparty?.kind === 'company' ? parties.counterparty.id : null,
  scopeBuilding: c.scopeBuilding ?? null,
  workPackage: c.workPackage ?? null,
  validFrom: c.validFrom,
  validTo: c.validTo,
  periodPrecision: c.periodPrecision,
  modality: c.modality,
  valueType: c.valueType,
  valueNumeric: c.valueNumeric,
  valueCurrency: c.valueCurrency,
  eventDiscriminator: needsQuoteDiscriminator(c) && evidence[0] ? eventQuoteDiscriminator(evidence[0].quote) : null,
  polarity: c.polarity ?? 'positive',
  contextProjectId: parties.context?.kind === 'project' ? parties.context.id : null,
  workPackageLabel: c.workPackageLabel ?? null,
  attributedTo: c.attributedTo ?? null,
  caseNumber: c.caseNumber ?? null,
  proceduralRole: c.proceduralRole ?? null,
  counterpartyRole: c.counterpartyRole ?? null,
  eventStage: c.eventStage ?? null,
  eventOutcome: c.eventOutcome ?? null,
  taxBasis: c.taxBasis ?? null,
});

/** Смысловые поля в подписи кандидата — только заданные, чтобы подписи наборов extract@2 не изменились. */
export const semanticSignature = (c: ICandidateContent): string => {
  const parts: string[] = [];
  const add = (label: string, value: string | null | undefined): void => {
    if (value) parts.push(`${label}=${value}`);
  };
  if (c.polarity === 'negative') parts.push('negative');
  if (c.modality !== 'unknown') add('modality', c.modality);
  add('building', c.scopeBuilding);
  add('wp', c.workPackage ?? c.workPackageLabel);
  add('case', c.caseNumber);
  add('role', c.proceduralRole);
  add('crole', c.counterpartyRole);
  add('stage', c.eventStage);
  add('outcome', c.eventOutcome);
  add('purpose', c.valueType && c.valueType !== 'amount' ? c.valueType : null);
  add('currency', c.valueCurrency && c.valueCurrency !== 'RUB' ? c.valueCurrency : null);
  return parts.join(',');
};

const POSITIVE_TWIN_MODALITIES = ['reported_fact', 'unknown'] as const;

/**
 * Опровержение: для отрицательной связи ищется положительное утверждение с тем же смыслом
 * (сторона, объект, роль, корпус, пакет) о состоявшемся факте. Цитата отрицания добавляется к нему
 * как contradicts и входит в набор — при замене набора снимается вместе с ним.
 */
export const linkContradiction = async (
  client: PoolClient,
  content: IAssertionContent,
  revisionId: number,
  span: IEvidenceSpan,
  chunkId: number | null,
): Promise<number[]> => {
  if (content.polarity !== 'negative' || content.predicate === 'event') return [];
  const ids: number[] = [];
  for (const modality of POSITIVE_TWIN_MODALITIES) {
    const twin: IAssertionContent = {
      ...content,
      polarity: 'positive',
      modality,
      validFrom: null,
      validTo: null,
      periodPrecision: 'unknown',
      attributedTo: null,
    };
    const row = (
      await client.query<{ id: number }>('SELECT id FROM assertions WHERE content_key = $1', [assertionContentKey(twin)])
    ).rows[0];
    if (!row) continue;
    const added = await addEvidence(client, {
      assertionId: row.id,
      revisionId,
      stance: 'contradicts',
      span,
      origin: 'extraction',
      extractionId: null,
      legacyKind: null,
      legacyId: null,
      extractionChunkId: chunkId,
    });
    ids.push(added.id);
  }
  return ids;
};
