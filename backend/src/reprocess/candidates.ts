// Сборка набора кандидатов из ответов модели по чанкам. Чистая функция.
//
// Отличия от старого mergeChunkExtractions:
//  - проверка ответа идёт по тексту своего чанка (локальность цитаты и реквизитов);
//  - у упоминания id в пространстве имён чанка: c<индекс>:company:<n>;
//    связи и события ссылаются на эти id, а не на строку имени;
//  - одинаковые названия с разными или неизвестными реквизитами не схлопываются;
//  - события не объединяются по type/company/project: два суда — два события;
//    одно событие из перекрывающихся чанков с той же позицией цитаты — одно;
//  - доказательство — абсолютная позиция в тексте редакции (code points) + чанк.

import type { IExtraction } from '../llm/schema.js';
import { verifyExtraction } from '../pipeline/verify.js';
import { normalizeName } from '../resolve/normalize.js';
import { locateQuote } from '../assertions/span.js';
import type { Predicate } from '../assertions/model.js';

export interface IChunkInput {
  chunkId: number;
  index: number;
  start: number;
  text: string;
  extraction: IExtraction;
}

export interface IEvidenceCandidate {
  chunkId: number;
  spanStart: number;
  spanEnd: number;
  quote: string;
  stance: 'supports';
}

export interface IEntityCandidate {
  ref: string;
  kind: 'company' | 'project';
  name: string;
  legalForm: string | null;
  taxId: string | null;
  city: string | null;
  address: string | null;
  projectKind: string | null;
  projectStage: string | null;
  mentionIds: string[];
  evidence: IEvidenceCandidate[];
  confidence: number;
}

export interface ICandidateContent {
  predicate: Predicate;
  role: string | null;
  eventType: string | null;
  subjectRef: string | null;
  objectRef: string | null;
  counterpartyRef: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: 'day' | 'unknown';
  modality: 'unknown';
  valueType: string | null;
  valueNumeric: string | null;
  valueCurrency: string | null;
}

export interface IAssertionCandidate {
  content: ICandidateContent;
  evidence: IEvidenceCandidate[];
  grounded: boolean;
  confidence: number;
  rejectedReason: string | null;
}

export interface ICandidateBuild {
  relevant: boolean;
  entities: IEntityCandidate[];
  assertions: IAssertionCandidate[];
  rejected: Array<{ chunkIndex: number; kind: string; name: string; reason: string }>;
}

const spanKey = (e: IEvidenceCandidate): string => `${e.spanStart}:${e.spanEnd}`;

const pushEvidence = (target: IEvidenceCandidate[], evidence: IEvidenceCandidate | null): void => {
  if (!evidence) return;
  // Перекрывающиеся чанки дают ту же позицию — одно доказательство, не два.
  if (!target.some(e => spanKey(e) === spanKey(evidence))) target.push(evidence);
};

const locateInChunk = (chunk: IChunkInput, quote: string): IEvidenceCandidate | null => {
  const location = locateQuote(chunk.text, quote);
  if (location.kind !== 'unique') return null;
  return {
    chunkId: chunk.chunkId,
    spanStart: chunk.start + location.span.start,
    spanEnd: chunk.start + location.span.end,
    quote: location.span.quote,
    stance: 'supports',
  };
};

export const buildCandidates = (chunks: readonly IChunkInput[], publishedAt: Date | null): ICandidateBuild => {
  const entities: IEntityCandidate[] = [];
  const byKey = new Map<string, IEntityCandidate>();
  const mentionToEntity = new Map<string, string>();
  const assertions: IAssertionCandidate[] = [];
  const rejected: ICandidateBuild['rejected'] = [];
  let relevant = false;

  const entityFor = (
    kind: 'company' | 'project',
    key: string,
    seed: Omit<IEntityCandidate, 'ref' | 'mentionIds' | 'evidence'>,
  ): IEntityCandidate => {
    const existing = byKey.get(key);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, seed.confidence);
      return existing;
    }
    const created: IEntityCandidate = { ...seed, ref: `e:${kind}:${entities.length}`, mentionIds: [], evidence: [] };
    entities.push(created);
    byKey.set(key, created);
    return created;
  };

  const events = new Map<string, IAssertionCandidate>();
  const links = new Map<string, IAssertionCandidate>();

  for (const chunk of chunks) {
    const verified = verifyExtraction(chunk.extraction, chunk.text, publishedAt);
    for (const r of verified.rejected) rejected.push({ chunkIndex: chunk.index, ...r });
    if (!verified.relevant) continue;
    relevant = true;

    const localCompany = new Map<string, string>();
    const localProject = new Map<string, string>();

    verified.companies.forEach((company, i) => {
      const mentionId = `c${chunk.index}:company:${i}`;
      const normalizedKey = normalizeName(company.name, 'company').key;
      // Реквизит — часть ключа: «Альфа» с ИНН X и «Альфа» с ИНН Y (или без ИНН) — разные кандидаты.
      const key = `company|${normalizedKey}|${company.taxIdAccepted ?? 'no-tax-id'}`;
      const entity = entityFor('company', key, {
        kind: 'company',
        name: company.name,
        legalForm: company.legal_form ?? null,
        taxId: company.taxIdAccepted,
        city: null,
        address: null,
        projectKind: null,
        projectStage: null,
        confidence: company.confidenceFinal,
      });
      entity.mentionIds.push(mentionId);
      if (company.quoteVerified) pushEvidence(entity.evidence, locateInChunk(chunk, company.quote));
      mentionToEntity.set(mentionId, entity.ref);
      localCompany.set(company.name, mentionId);
    });

    verified.projects.forEach((project, i) => {
      const mentionId = `c${chunk.index}:project:${i}`;
      // Город — часть ключа: одноимённые ЖК разных или неизвестных городов не склеиваются.
      const key = `project|${normalizeName(project.name, 'project').key}|${project.city ?? 'no-city'}`;
      const entity = entityFor('project', key, {
        kind: 'project',
        name: project.name,
        legalForm: null,
        taxId: null,
        city: project.city,
        address: project.address,
        projectKind: project.kind,
        projectStage: project.stage,
        confidence: project.confidenceFinal,
      });
      entity.mentionIds.push(mentionId);
      if (project.quoteVerified) pushEvidence(entity.evidence, locateInChunk(chunk, project.quote));
      mentionToEntity.set(mentionId, entity.ref);
      localProject.set(project.name, mentionId);
    });

    for (const link of verified.links) {
      const companyMention = localCompany.get(link.company);
      const projectMention = localProject.get(link.project);
      if (!companyMention || !projectMention) continue;
      const subjectRef = mentionToEntity.get(companyMention)!;
      const objectRef = mentionToEntity.get(projectMention)!;
      const key = `${subjectRef}|${objectRef}|${link.role}`;
      const candidate =
        links.get(key) ??
        ({
          content: {
            predicate: 'participates_in_project',
            role: link.role,
            eventType: null,
            subjectRef,
            objectRef,
            counterpartyRef: null,
            validFrom: null,
            validTo: null,
            periodPrecision: 'unknown',
            modality: 'unknown',
            valueType: null,
            valueNumeric: null,
            valueCurrency: null,
          },
          evidence: [],
          grounded: false,
          confidence: 0,
          rejectedReason: null,
        } satisfies IAssertionCandidate);
      // У связи нет собственной цитаты (R03, этап 06): основание — подтверждённая цитата компании в том же чанке.
      const company = verified.companies.find(c => c.name === link.company);
      if (company?.quoteVerified) pushEvidence(candidate.evidence, locateInChunk(chunk, company.quote));
      candidate.confidence = Math.max(candidate.confidence, link.confidenceFinal);
      links.set(key, candidate);
    }

    for (const event of verified.events) {
      const location = event.quoteVerified ? locateInChunk(chunk, event.quote) : null;
      const subjectMention = event.company ? localCompany.get(event.company) : undefined;
      const projectMention = event.project ? localProject.get(event.project) : undefined;
      const counterpartyMention = event.counterparty ? localCompany.get(event.counterparty) : undefined;
      const subjectRef = subjectMention ? mentionToEntity.get(subjectMention)! : null;
      const projectRef = projectMention ? mentionToEntity.get(projectMention)! : null;
      if (!subjectRef && !projectRef) continue;

      // Одинаковое событие из перекрывающихся чанков — та же абсолютная позиция цитаты.
      // Без позиции события не объединяются: разные суды одной компании остаются разными.
      const key = location
        ? `${event.type}|${location.spanStart}:${location.spanEnd}`
        : `${event.type}|c${chunk.index}|${events.size}`;
      const candidate =
        events.get(key) ??
        ({
          content: {
            predicate: 'event',
            role: null,
            eventType: event.type,
            subjectRef: subjectRef ?? projectRef,
            objectRef: subjectRef ? projectRef : null,
            counterpartyRef: counterpartyMention ? mentionToEntity.get(counterpartyMention)! : null,
            validFrom: event.occurredOn ? event.occurredOn.toISOString().slice(0, 10) : null,
            validTo: event.occurredOn ? event.occurredOn.toISOString().slice(0, 10) : null,
            periodPrecision: event.occurredOn ? 'day' : 'unknown',
            modality: 'unknown',
            valueType: event.amountRub !== null ? 'amount' : null,
            valueNumeric: event.amountRub !== null ? event.amountRub.toFixed(2) : null,
            valueCurrency: event.amountRub !== null ? 'RUB' : null,
          },
          evidence: [],
          grounded: false,
          confidence: 0,
          rejectedReason: null,
        } satisfies IAssertionCandidate);
      pushEvidence(candidate.evidence, location);
      candidate.confidence = Math.max(candidate.confidence, event.confidenceFinal);
      events.set(key, candidate);
    }
  }

  for (const entity of entities) {
    assertions.push({
      content: {
        predicate: entity.kind === 'company' ? 'company_mentioned' : 'project_mentioned',
        role: null,
        eventType: null,
        subjectRef: entity.ref,
        objectRef: null,
        counterpartyRef: null,
        validFrom: null,
        validTo: null,
        periodPrecision: 'unknown',
        modality: 'unknown',
        valueType: null,
        valueNumeric: null,
        valueCurrency: null,
      },
      evidence: entity.evidence,
      grounded: false,
      confidence: entity.confidence,
      rejectedReason: null,
    });
  }
  assertions.push(...links.values(), ...events.values());

  for (const a of assertions) {
    a.grounded = a.evidence.length > 0;
    if (!a.grounded) a.rejectedReason = 'нет однозначно найденной цитаты в тексте чанка';
  }

  return { relevant, entities, assertions, rejected };
};
