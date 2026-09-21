// Типы read-model сигналов компании (этап 07, ADR-009). Вход — утверждения и публикации на срез,
// выход — три независимых блока с правилом, окном, знаменателем и списком исходных id у каждого числа.

export const SIGNAL_RULES_VERSION = 'signals@2';

export type ReviewLevel = 'reviewed' | 'text_grounded' | 'legacy_unreviewed' | 'disputed' | 'rejected';

export interface ISignalEvidence {
  id: number;
  stance: 'supports' | 'contradicts' | 'mentions';
  sourceItemId: number;
}

export interface ISignalAssertion {
  id: number;
  predicate: string;
  role: string | null;
  eventType: string | null;
  status: string;
  origin: string;
  needsRevalidation: boolean;
  polarity: 'positive' | 'negative';
  modality: string;
  subjectCompanyId: number | null;
  subjectProjectId: number | null;
  objectCompanyId: number | null;
  objectProjectId: number | null;
  counterpartyCompanyId: number | null;
  contextProjectId: number | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  caseNumber: string | null;
  proceduralRole: string | null;
  counterpartyRole: string | null;
  eventStage: string | null;
  eventOutcome: string | null;
  valueType: string | null;
  valueNumeric: string | null;
  valueCurrency: string | null;
  /** Только активные доказательства на срез. */
  evidence: ISignalEvidence[];
}

export interface ISignalPublication {
  sourceItemId: number;
  sourceKey: string;
  publishedAt: string | null;
  completeness: string;
  /**
   * Хэш дедупликации текста редакции-основания (последней из редакций, на которые ссылаются доказательства; этап 13):
   * признак общей семьи, не доказательство первоисточника. Правка без разбора не меняет семью старой цитаты.
   */
  dedupHash: string;
  /** Номер редакции-основания (по доказательствам) и последней наблюдаемой редакции публикации на срез. */
  evidenceRevisionNo?: number;
  latestRevisionNo?: number;
  /** Есть более новая редакция, по которой доказательств ещё нет (правка не разобрана). */
  pendingRevision?: boolean;
  /** Источник пересылки из наблюдений, если транспорт его назвал. */
  forwardOrigin: string | null;
  observations: number;
}

export interface ICompanySignalInput {
  companyId: number;
  entityType: string | null;
  identifiers: Array<{ type: string; validationStatus: string }>;
  aliases: number;
  openAmbiguities: number;
  pendingMerges: number;
  /** Legacy-роли и события, не перенесённые в утверждения (backfill:assertions не запускался). */
  legacyUnimported: { participations: number; events: number };
  assertions: ISignalAssertion[];
  publications: ISignalPublication[];
}

export interface IWindow {
  from: string;
  to: string;
  basis: 'event_date' | 'publication_date';
}

/** Любое число сигнала: значение, правило, окно, знаменатель и исходные id для drilldown. */
export interface IAggregate {
  value: number | null;
  status: 'ok' | 'insufficient_data';
  rule: string;
  window: IWindow | null;
  denominator: number | null;
  ids: number[];
  idsTruncated: boolean;
}

/**
 * Дата, взятая из выборки (первая и последняя публикация): значение, правило и публикация,
 * из которой она взята. Неизвестна — `insufficient_data` и null: «даты нет» не значит «давно».
 */
export interface IDateSignal {
  value: string | null;
  status: 'ok' | 'insufficient_data';
  rule: string;
  sourceItemId: number | null;
}

export type IdentityStatus = 'identified' | 'identifier_unverified' | 'name_only' | 'ambiguous';

export interface IIdentityBlock {
  status: IdentityStatus;
  entityType: string | null;
  identifiers: Record<string, number>;
  aliases: number;
  openAmbiguities: number;
  pendingMerges: number;
  coverage: {
    publications: IAggregate;
    sources: number;
    completeness: Record<string, number>;
    legacyUnimported: { participations: number; events: number };
    note: string;
  };
}

export interface IParticipationItem {
  assertionId: number;
  projectId: number;
  role: string;
  building: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  review: ReviewLevel;
  needsRevalidation: boolean;
}

export interface IExperienceBlock {
  projects: IAggregate;
  byRole: Record<string, IAggregate>;
  byWorkPackage: Record<string, IAggregate>;
  reviewed: IAggregate;
  /** signals@2: договоры и корпоративные связи числом, с тем же правилом «положительно, как факт». */
  contractsCount: IAggregate;
  corporateCount: IAggregate;
  /** Разные компании, названные другой стороной договора или корпоративной связи. */
  counterparties: IAggregate;
  participations: IParticipationItem[];
  /** План, возможность, заявление и отрицание участия — не опыт, показываются отдельно. */
  notCounted: Array<{ assertionId: number; projectId: number | null; role: string | null; modality: string; polarity: string; review: ReviewLevel }>;
  contracts: Array<{
    assertionId: number;
    side: 'client' | 'performer';
    role: string | null;
    counterpartCompanyId: number | null;
    projectId: number | null;
    modality: string;
    polarity: string;
    value: { amount: string; currency: string | null; purpose: string | null } | null;
    review: ReviewLevel;
  }>;
  corporate: Array<{ assertionId: number; role: string | null; direction: 'outgoing' | 'incoming'; otherCompanyId: number | null; review: ReviewLevel }>;
  note: string;
}

export type EventDateStatus = 'in_window' | 'boundary' | 'before_window' | 'future' | 'undated';

export interface IEventItem {
  assertionId: number;
  type: string;
  companyRole: 'subject' | 'counterparty';
  proceduralRole: string | null;
  caseNumber: string | null;
  stage: string | null;
  outcome: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  dateStatus: EventDateStatus;
  review: ReviewLevel;
  needsRevalidation: boolean;
  modality: string;
  value: { amount: string; currency: string | null; purpose: string | null } | null;
  publications: number;
  families: number;
  /** Отрицательные и спорные сведения — со слов источника, не установленный факт. */
  attribution: 'source_reported';
}

export interface ILegalCase {
  caseKey: string;
  caseNumber: string | null;
  companyProceduralRole: string | null;
  stages: Array<{ assertionId: number; stage: string | null; outcome: string | null; validFrom: string | null; review: ReviewLevel }>;
}

export interface IMediaBlock {
  publications: IAggregate;
  publications90d: IAggregate;
  publicationsUndated: IAggregate;
  /** signals@2: край выборки по датам публикаций — свежесть сведений, не активность компании. */
  firstPublishedAt: IDateSignal;
  latestPublishedAt: IDateSignal;
  observations: number;
  families: IAggregate;
  familiesByOrigin: { established: IAggregate; named: IAggregate; unknown: IAggregate };
  events: IEventItem[];
  eventsDated12m: IAggregate;
  eventsBoundary12m: IAggregate;
  eventsUndated: IAggregate;
  eventsUndatedPublished90d: IAggregate;
  eventsFuture: IAggregate;
  eventsByReview: Record<ReviewLevel, number>;
  /** signals@2: события по видам и число судебных дел — числом, а не только списком. */
  eventsByType: Record<string, IAggregate>;
  legalCasesCount: IAggregate;
  reviewedShare: IAggregate;
  legalCases: ILegalCase[];
  courtRoles: { plaintiff: number; defendant: number; other: number; unknown: number };
  notCounted: Array<{ assertionId: number; type: string | null; reason: string }>;
  note: string;
}

export interface ICompanySignals {
  rulesVersion: string;
  cutoff: string;
  companyId: number;
  identity: IIdentityBlock;
  experience: IExperienceBlock;
  media: IMediaBlock;
}
