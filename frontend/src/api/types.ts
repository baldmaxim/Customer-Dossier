export type Role =
  | 'customer'
  | 'general_contractor'
  | 'contractor'
  | 'designer'
  | 'investor'
  | 'operator';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface ICompanySearchItem {
  id: number;
  name: string;
  city: string | null;
  legalForm: string | null;
  score: number;
  // Этап 08A: контекст для осознанного выбора среди одноимённых.
  entityType?: string;
  identifiers?: string[];
  projects?: number | null;
  matchedAlias?: string | null;
  homonyms?: number;
}

export interface ICompany {
  id: number;
  name: string;
  legalForm: string | null;
  taxId: string | null;
  city: string | null;
  website: string | null;
  isVerified: boolean;
  mergedIntoId: number | null;
  entityType?: EntityType;
  version?: number;
}

export type EntityType = 'legal_entity' | 'brand' | 'group' | 'unknown';

export interface ICompanyIdentifier {
  jurisdiction: string;
  type: string;
  value: string;
  validationStatus: string;
  origin: string;
}

export interface ICompanyRelation {
  id: number;
  relationType: 'brand_of' | 'member_of_group' | 'successor_of';
  status: string;
  direction: 'outgoing' | 'incoming';
  otherCompanyId: number;
  otherCompanyName: string;
}

export interface ICompanyResponse {
  company: ICompany;
  aliases: Array<{ alias: string; hits: number }>;
  identifiers?: ICompanyIdentifier[];
  relations?: ICompanyRelation[];
  /** Приходит вместо остального, если компания слита в другую. */
  mergedInto?: number;
}

export interface IProjectRow {
  id: number;
  name: string;
  kind: string;
  stage: string;
  city: string | null;
  plannedCompletion: string | null;
  actualCompletion: string | null;
  role: Role;
  confidence: number;
  isCurrent: boolean;
  counterparties: Array<{ id: number; name: string; role: Role }> | null;
}

export type TextCompleteness = 'full' | 'excerpt' | 'caption_only' | 'failed' | 'unknown';

export interface ISourceItem {
  id: number;
  sourceId: number;
  sourceTitle: string;
  sourceKind: string;
  itemKey: string;
  externalId: string | null;
  canonicalUrl: string | null;
  originalUrl: string | null;
  publishedAt: string | null;
  state: 'present' | 'deleted_observed';
  deletedObservedAt: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  latestRevisionId: number | null;
  historyBeforeImport: 'complete' | 'unknown';
  origin: 'ingest' | 'legacy_import';
  revisionCount: number;
  latestCompleteness: TextCompleteness | null;
  latestCompletenessReason: string | null;
}

export interface IRevisionMeta {
  id: number;
  revisionNo: number;
  bodyLength: number;
  representation: string;
  completeness: TextCompleteness;
  completenessReason: string | null;
  attachments: Array<{ kind: string; status: string }>;
  publishedAt: string | null;
  sourceModifiedAt: string | null;
  firstObservedAt: string;
  chronology: 'source_modified_at' | 'observed_order' | 'unknown';
  sameContentAsRevisionId: number | null;
  legacyDocumentId: number | null;
  origin: 'ingest' | 'legacy_import';
  observationCount: number;
}

export interface IRevision extends Omit<IRevisionMeta, 'bodyLength' | 'observationCount'> {
  sourceItemId: number;
  title: string | null;
  body: string;
}

export type DiffOp =
  | { op: 'equal' | 'delete' | 'insert'; lines: string[] }
  | { op: 'skip'; count: number };

export interface IDiffResponse {
  from: number;
  to: number;
  diff: { ok: true; ops: DiffOp[]; inserted: number; deleted: number } | { ok: false; reason: string };
}

export type AssertionStatus = 'candidate' | 'text_grounded' | 'reviewed_supported' | 'disputed' | 'rejected';

export interface IAssertion {
  id: number;
  predicate: 'participates_in_project' | 'contract' | 'corporate_relation' | 'event' | 'company_mentioned' | 'project_mentioned';
  /** Роль на объекте, вид договора или корпоративной связи (этап 06). */
  role: string | null;
  eventType: string | null;
  subjectCompanyId: number | null;
  subjectCompanyName: string | null;
  subjectProjectId: number | null;
  subjectProjectName: string | null;
  subjectText: string | null;
  objectCompanyId: number | null;
  objectCompanyName: string | null;
  objectProjectId: number | null;
  objectProjectName: string | null;
  objectText: string | null;
  counterpartyCompanyName: string | null;
  contextProjectName?: string | null;
  polarity?: 'positive' | 'negative';
  workPackageLabel?: string | null;
  attributedTo?: string | null;
  caseNumber?: string | null;
  proceduralRole?: string | null;
  counterpartyRole?: string | null;
  eventStage?: string | null;
  eventOutcome?: string | null;
  taxBasis?: string | null;
  periodPrecision?: string;
  scopeBuilding: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  modality: string;
  valueType?: string | null;
  valueNumeric: string | null;
  valueCurrency: string | null;
  status: AssertionStatus;
  needsRevalidation: boolean;
  version: number;
  confidenceExtraction: number | null;
  origin: string;
  supportsCount: number;
  contradictsCount: number;
}

export interface IEvidenceRow {
  id: number;
  stance: 'supports' | 'contradicts' | 'mentions';
  status: 'active' | 'withdrawn' | 'unavailable';
  statusReason: string | null;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  revisionId: number;
  revisionNo: number;
  completeness: TextCompleteness;
  legacyDocumentId: number | null;
  /** Запуск нового конвейера, из чанка которого пришло доказательство (этап 15B); null — legacy или вручную. */
  runId?: number | null;
  sourceTitle: string;
  url: string | null;
  publishedAt: string | null;
}

export interface IReviewRow {
  id: number;
  decision: AssertionStatus;
  scope: 'reflects_source' | 'fact_confirmed';
  reviewer: string;
  reason: string | null;
  assertionVersion: number;
  provenanceGap: boolean;
  decidedAt: string;
}

export interface IMention {
  id: number;
  documentId: number;
  surfaceForm: string;
  role: Role | null;
  quote: string;
  quoteVerified: boolean;
  sentiment: Sentiment;
  confidence: number;
  publishedAt: string;
  url: string | null;
  sourceTitle: string;
  sourceKind: string;
}

export interface IEventRow {
  id: number;
  type: string;
  occurredOn: string | null;
  severity: number;
  amountRub: number | null;
  quote: string;
  confidence: number;
  status: string;
  projectId: number | null;
  projectName: string | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  url: string | null;
}

/** Строка списка подрядчиков из снимка сигналов (этап 07). Индекса риска нет. */
export interface IContractorRow {
  companyId: number;
  name: string;
  city: string | null;
  identityStatus: string;
  projects: number | null;
  roles: string[];
  eventsDated12m: number;
  eventsUndated: number;
  publications: number | null;
  families: number | null;
  courtRoles: { plaintiff: number; defendant: number; other: number; unknown: number } | null;
}

export interface IPendingMerge {
  id: number;
  entityKind: 'company' | 'project';
  score: number;
  reasons: Record<string, unknown>;
  sourceName: string;
  targetName: string;
  sourceId: number;
  targetId: number;
  sampleDocumentId: number | null;
}

export type PermissionStatus = 'unknown' | 'approved' | 'blocked' | 'revoked' | 'expired';

export interface ISourceRow {
  id: number;
  kind: 'telegram' | 'website' | 'manual';
  key: string;
  title: string;
  status: 'active' | 'paused' | 'broken';
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyScope: string | null;
  policyBasis: string | null;
  policyReference: string | null;
  policyOwner: string | null;
  policyDecidedAt: string | null;
  policyExpiresAt: string | null;
  isSynthetic: boolean;
  /** Почему сбор запрещён; null — разрешён. Считает сервер тем же gate. */
  collectBlockedReason: string | null;
  aiBlockedReason: string | null;
  pollIntervalSec: number;
  nextRunAt: string | null;
  lastOkAt: string | null;
  failStreak: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastItemsSeen: number | null;
  lastItemsNew: number | null;
  lastError: string | null;
  layoutStats: Record<string, number> | null;
  /** Этап 05A: здоровье адаптера, итог и покрытие последнего запуска. */
  health?: SourceHealth;
  healthReason?: string | null;
  lastAttemptAt?: string | null;
  parserVersion?: string | null;
  lastOutcome?: string | null;
  lastFound?: number | null;
  lastSaved?: number | null;
  lastChanged?: number | null;
  lastSkipped?: number | null;
  lastFailed?: number | null;
  lastPages?: number | null;
  lastCoverage?: Record<string, unknown> | null;
  lastDurationMs?: number | null;
  retryAfterAt?: string | null;
  /** Этап 08A: секунд с последнего успеха, публикаций и публикаций с неполной текущей редакцией. */
  lagSeconds?: number | null;
  items?: number;
  incompleteItems?: number;
}

export type SourceHealth = 'unknown' | 'ok' | 'parser_degraded' | 'rate_limited' | 'blocked' | 'error' | 'config_invalid' | 'identity_uncertain';

export interface ISiteProbeReport {
  outcome: string;
  health: SourceHealth;
  healthReason: string | null;
  httpStatus: number | null;
  counts: { found: number; saved: number; changed: number; skipped: number; failed: number };
  pagesFetched: number;
  coverage: Record<string, unknown>;
  layoutStats: Record<string, number>;
  parserVersion: string;
  samples: Array<{ url: string; title: string; completeness: string; reason: string; preview: string }>;
  errors: string[];
}

export interface IMergeEntitySummary {
  id: number;
  name: string;
  version: number;
  mergedIntoId: number | null;
  city: string | null;
  legalForm: string | null;
  entityType: EntityType | null;
  projectLevel: string | null;
  parentProjectId: number | null;
  identifiers: Array<{ type: string; value: string }>;
  aliases: string[];
}

export interface IMergeConflict {
  code: string;
  message: string;
}

export interface IMergePreview {
  kind: 'company' | 'project';
  source: IMergeEntitySummary;
  target: IMergeEntitySummary;
  conflicts: IMergeConflict[];
  warnings: string[];
  counts: Record<string, number>;
  reviewedAssertions: Array<{ assertionId: number; status: string; decisions: number }>;
  canApply: boolean;
  /** merge-preview@1: применяется только с этим токеном. */
  previewToken: string;
  queueStatus?: string;
}

export interface IMergeHistoryItem {
  id: number;
  entityKind: 'company' | 'project';
  sourceId: number;
  targetId: number;
  sourceName: string | null;
  targetName: string | null;
  status: 'applied' | 'undone';
  actor: string;
  createdAt: string;
  undoneAt: string | null;
}

export interface ICompensatingPlan {
  reason: string;
  changes: Array<{ dependency: string; added: string[]; removed: string[] }>;
  steps: string[];
}

// ─── Сигналы компании (этап 07, signals@1) ────────────────────────────────

export type ReviewLevel = 'reviewed' | 'text_grounded' | 'legacy_unreviewed' | 'disputed' | 'rejected';

export interface ISignalAggregate {
  value: number | null;
  status: 'ok' | 'insufficient_data';
  rule: string;
  window: { from: string; to: string; basis: 'event_date' | 'publication_date' } | null;
  denominator: number | null;
  ids: number[];
  idsTruncated: boolean;
}

export interface ISignalEvent {
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
  dateStatus: 'in_window' | 'boundary' | 'before_window' | 'future' | 'undated';
  review: ReviewLevel;
  needsRevalidation: boolean;
  modality: string;
  value: { amount: string; currency: string | null; purpose: string | null } | null;
  publications: number;
  families: number;
}

export interface ISignalParticipation {
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

export interface ICompanySignals {
  rulesVersion: string;
  cutoff: string;
  companyId: number;
  identity: {
    status: 'identified' | 'identifier_unverified' | 'name_only' | 'ambiguous';
    entityType: string | null;
    identifiers: Record<string, number>;
    aliases: number;
    openAmbiguities: number;
    pendingMerges: number;
    coverage: {
      publications: ISignalAggregate;
      sources: number;
      completeness: Record<string, number>;
      legacyUnimported: { participations: number; events: number };
      note: string;
    };
  };
  experience: {
    projects: ISignalAggregate;
    byRole: Record<string, ISignalAggregate>;
    byWorkPackage: Record<string, ISignalAggregate>;
    reviewed: ISignalAggregate;
    participations: ISignalParticipation[];
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
    note: string;
  };
  media: {
    publications: ISignalAggregate;
    publications90d: ISignalAggregate;
    publicationsUndated: ISignalAggregate;
    observations: number;
    families: ISignalAggregate;
    familiesByOrigin: { established: ISignalAggregate; named: ISignalAggregate; unknown: ISignalAggregate };
    events: ISignalEvent[];
    eventsDated12m: ISignalAggregate;
    eventsBoundary12m: ISignalAggregate;
    eventsUndated: ISignalAggregate;
    eventsUndatedPublished90d: ISignalAggregate;
    eventsFuture: ISignalAggregate;
    eventsByReview: Record<ReviewLevel, number>;
    reviewedShare: ISignalAggregate;
    legalCases: Array<{
      caseKey: string;
      caseNumber: string | null;
      companyProceduralRole: string | null;
      stages: Array<{ assertionId: number; stage: string | null; outcome: string | null; validFrom: string | null; review: ReviewLevel }>;
    }>;
    courtRoles: { plaintiff: number; defendant: number; other: number; unknown: number };
    notCounted: Array<{ assertionId: number; type: string | null; reason: string }>;
    note: string;
  };
}

export interface ISignalRefreshState {
  active: { id: number; rulesVersion: string; cutoffAt: string; finishedAt: string } | null;
  lastFailure: { id: number; error: string | null; finishedAt: string } | null;
  running: boolean;
  stale: boolean;
  staleReasons: string[];
}

export interface ISignalsResponse {
  status: 'ok' | 'not_computed' | 'not_in_snapshot';
  refresh: ISignalRefreshState;
  signals: ICompanySignals | null;
}

export interface IProjectContext {
  cutoff: string;
  participations: Array<{
    assertionId: number;
    role: string | null;
    building: string | null;
    workPackage: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    modality: string;
    polarity: string;
    review: ReviewLevel;
    counted: boolean;
  }>;
  projectEvents: Array<{
    assertionId: number;
    type: string | null;
    building: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    review: ReviewLevel;
    overlap: 'overlaps' | 'no_overlap' | 'unknown';
    sameBuilding: boolean | null;
    namesCompany: boolean;
  }>;
  currentState: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>;
  note: string;
}

// ─── Рабочее досье (этап 08A) ─────────────────────────────────────────────

export type Attribution =
  | 'source_reported'
  | 'analyst_reviewed'
  | 'analyst_disputed'
  | 'analyst_rejected'
  | 'operator_claim'
  | 'not_established'
  | 'system_context';

export interface IStatement {
  code: string;
  text: string;
  attribution: Attribution;
  assertionIds: number[];
  evidenceIds: number[];
  quotes: Array<{ evidenceId: number; quote: string; sourceTitle: string; publishedAt: string | null; stance: string }>;
  /** Применимость к обращению (scope-match@1, этап 12). */
  scope?: { version: string; dimensions: Record<string, 'match' | 'compatible' | 'unknown' | 'conflict'>; missing: string[]; conflicts: string[] };
  priorDecisions?: Array<{ assertionId: number; mergeId: number; decisionId: number; decision: string; reviewer: string; decidedAt: string }>;
}

export interface ICaseRow {
  id: number;
  title: string;
  companyStatus: 'identified' | 'unidentified';
  companyId: number | null;
  companyName: string | null;
  companyNameClaimed: string | null;
  projectId: number | null;
  projectName: string | null;
  projectNameClaimed: string | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  claimedRole: string | null;
  claimedClientCompanyId: number | null;
  claimedClientCompanyName: string | null;
  claimedClientName: string | null;
  claimedTerms: string | null;
  requestDate: string;
  operatorNote: string | null;
  status: 'open' | 'closed';
  provenance: 'operator_recorded_claim';
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ICaseInput {
  title: string;
  companyId: number | null;
  companyNameClaimed: string | null;
  projectId: number | null;
  projectNameClaimed: string | null;
  scopeBuilding: string | null;
  workPackageLabel: string | null;
  claimedRole: string | null;
  claimedClientCompanyId: number | null;
  claimedClientName: string | null;
  claimedTerms: string | null;
  requestDate: string;
  operatorNote: string | null;
  status: 'open' | 'closed';
}

export interface ICaseDossier {
  templateVersion: string;
  caseId: number;
  caseVersion: number;
  generatedAt: string;
  freshness: { signalsCutoff: string | null; stale: boolean; staleReasons: string[]; latestEvidenceAt: string | null };
  subject: IStatement[];
  observations: IStatement[];
  role: {
    claimed: IStatement | null;
    status: 'reviewed' | 'reported' | 'contradicted' | 'scope_unknown' | 'not_established' | 'no_project' | 'no_company';
    established: IStatement[];
    otherBuildings: IStatement[];
    contradictions: IStatement[];
    /** Не применимо к предмету обращения или часть не указана (снимки до этапа 12 — без поля). */
    context?: IStatement[];
  };
  chain: {
    claimed: IStatement | null;
    status: 'documented' | 'differs_from_claim' | 'scope_unknown' | 'not_documented' | 'no_project' | 'no_company';
    documented: IStatement[];
    subcontracts: IStatement[];
    coParticipants: IStatement[];
    context?: IStatement[];
  };
  terms: { claimed: IStatement | null; fromSources: IStatement[] };
  projectContext: { state: IStatement[]; events: IStatement[] };
  companyEvents: IStatement[];
  uncertainties: IStatement[];
  questions: Array<{ code: string; text: string; basedOn: string }>;
  disclaimer: string;
}

export interface IProjectSearchItem {
  id: number;
  name: string;
  city: string | null;
  kind: string;
  level: string;
  levelLabel: string | null;
  parentId: number | null;
  parentName: string | null;
  children: number;
}

export interface IProjectDossier {
  project: {
    id: number;
    name: string;
    kind: string;
    city: string | null;
    level: string;
    levelLabel: string | null;
    parent: { id: number; name: string } | null;
    children: Array<{ id: number; name: string; level: string; levelLabel: string | null }>;
    mergedIntoId: number | null;
  };
  period: { from: string | null; to: string | null };
  state: {
    current: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>;
    history: Array<{ building: string | null; state: string; validFrom: string; periodPrecision: string; assertionId: number }>;
  };
  participants: Array<{
    companyId: number;
    companyName: string;
    role: string | null;
    building: string | null;
    workPackage: string | null;
    validFrom: string | null;
    validTo: string | null;
    periodPrecision: string;
    inPeriod: 'overlaps' | 'no_overlap' | 'unknown' | 'no_period_selected';
    statement: IStatement;
  }>;
  notCounted: IStatement[];
  contracts: IStatement[];
  coParticipationNote: string;
  events: IStatement[];
  cases: Array<{ id: number; title: string; status: string }>;
}

export interface ICompanySummary {
  generatedAt: string;
  signalsCutoff: string | null;
  stale: boolean;
  staleReasons: string[];
  summary: IStatement[];
  counterparties: {
    contracts: IStatement[];
    corporate: IStatement[];
    coParticipants: Array<{ companyId: number; companyName: string; projectId: number; projectName: string; roleOther: string | null; roleThis: string | null }>;
  };
  contradictions: Array<{ kind: string; assertionId: number; priority: number }>;
  limits: IStatement[];
  cases: Array<{ id: number; title: string; status: string }>;
}

export interface IReviewQueueItem {
  priority: number;
  kind: 'identity' | 'polarity_conflict' | 'role_period_conflict' | 'correction' | 'dispute';
  refId: number;
  assertionId: number | null;
  detail: Record<string, unknown>;
  since: string;
}

// Схема связей и снимки досье (этап 08B)

export type GraphEdgeType = 'participation' | 'contract' | 'corporate' | 'hierarchy' | 'co_mentioned';

export interface IGraphNode {
  key: string;
  kind: 'company' | 'project';
  id: number;
  label: string;
  subtype: string | null;
  details: string[];
  depth: number;
  seed: boolean;
}

export interface IGraphEdge {
  key: string;
  type: GraphEdgeType;
  from: string;
  to: string;
  assertionId: number | null;
  role: string | null;
  building: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  periodPrecision: string;
  status: string;
  polarity: string;
  modality: string;
  supports: number;
  contradicts: number;
  contextProjectId: number | null;
  details: string[];
}

export interface IGraph {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  truncated: boolean;
  notes: string[];
}

export interface ISnapshotListItem {
  id: number;
  caseId: number;
  caseVersion: number;
  generatedAt: string;
  knowledgeCutoff: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rulesVersion: string;
  templateVersion: string;
  payloadHash: string;
  redactions: number;
}

export interface ISnapshotSource {
  evidenceId: number;
  assertionId: number;
  stance: string;
  status: string;
  quote: string | null;
  withheldReason: string | null;
  revisionId: number;
  revisionNo: number;
  sourceId: number;
  sourceKey: string;
  sourceTitle: string;
  url: string | null;
  publishedAt: string | null;
  completeness: string;
}

export interface ISnapshotView {
  meta: { id: number; caseId: number; caseVersion: number; schemaVersion: string; generatedAt: string; knowledgeCutoff: string; effectiveFrom: string | null; effectiveTo: string | null; payloadHash: string; hashAlgorithm: string };
  integrity: { algorithm: string; storedHash: string; computedHash: string; verified: boolean };
  availability: { checkedAt: string; withheldSources: Array<{ sourceId: number; sourceKey: string; reason: string }>; withheldEvidence: number };
  redactions: Array<{ evidenceId: number; reason: string; actor: string; redactedAt: string }>;
  payload: {
    schemaVersion: string;
    generatedAt: string;
    knowledgeCutoff: string;
    effective: { from: string | null; to: string | null; undatedIncluded: number; excluded: number; note: string };
    versions: { template: string; signalsRules: string; graph: string; signalsCutoff: string | null; signalsStale: boolean };
    case: { id: number; version: number; title: string; companyNameClaimed: string | null; projectNameClaimed: string | null; scopeBuilding: string | null; requestDate: string };
    company: { id: number; name: string; legalForm: string | null; entityType: string; identifiers: string[] } | null;
    project: { id: number; name: string; level: string; levelLabel: string | null; city: string | null } | null;
    dossier: ICaseDossier;
    reviews: Array<{ id: number; assertionId: number; decision: string; scope: string; reason: string | null; assertionVersion: number; decidedAt: string }>;
    openQueue: Array<{ kind: string; assertionId: number; priority: number }>;
    sources: ISnapshotSource[];
    graph: IGraph;
    limitations: string[];
  };
}

// Этап 15A: неоднозначные упоминания
export type AmbiguityStatus = 'open' | 'resolved' | 'dismissed';
export type AmbiguityDecisionKind = 'resolved_to' | 'kept_unknown' | 'dismissed';

export interface IAmbiguityListItem {
  id: number;
  entityKind: 'company' | 'project';
  surface: string;
  candidateIds: number[];
  revisionId: number | null;
  occurrences: number;
  status: AmbiguityStatus;
  version: number;
  updatedAt: string;
}

export interface IAmbiguityPage {
  items: IAmbiguityListItem[];
  total: number;
  nextCursor: string | null;
}

export interface IAmbiguityChoiceCheck {
  conflicts: Array<{ code: string; message: string }>;
  textIdentifiers: Array<{ type: string; value: string }>;
  textLegalForm: string | null;
  notes: string[];
}

export interface IAmbiguityCandidate {
  id: number;
  name: string;
  mergedIntoId: number | null;
  legalForm: string | null;
  entityType: string | null;
  city: string | null;
  identifiers: Array<{ type: string; value: string }>;
  choice: IAmbiguityChoiceCheck;
}

export interface IAmbiguityDecision {
  id: number;
  decision: AmbiguityDecisionKind;
  entityId: number | null;
  reason: string;
  actor: string;
  ambiguityVersion: number;
  decidedAt: string;
}

export interface IAmbiguityDetail extends IAmbiguityListItem {
  revision: { id: number; excerpt: string | null; publishedAt: string | null } | null;
  whyAmbiguous: string;
  candidates: IAmbiguityCandidate[];
  decisions: IAmbiguityDecision[];
  scopeNote: string;
}

// Этап 15B: рабочее место запусков
export type RunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface IRunListItem {
  id: number;
  revisionId: number;
  revisionNo: number;
  latestRevisionNo: number;
  sourceItemId: number;
  source: { id: number; key: string };
  status: RunStatus;
  error: string | null;
  fingerprint: string;
  model: string | null;
  schemaVersion: string | null;
  promptVersion: string | null;
  previousRunId: number | null;
  coverage: { coveredChars: number | null; totalChars: number | null; chunks: number; chunksOk: number; chunksFailed: number };
  relevant: boolean | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  usage: { responses: number; tokensIn: number | null; tokensOut: number | null; latencyMs: number | null };
  policy: { allowed: boolean; reason: string | null };
  candidateSet: { id: number; status: string } | null;
}

export interface IRunPage {
  items: IRunListItem[];
  total: number;
  nextBeforeId: number | null;
  worker: { pipelineEnabled: boolean; autoPublish: boolean };
}

export interface IRunDetail extends IRunListItem {
  identity: { historical: boolean; candidateBuildVersion: string | null; candidateBuildCurrent: boolean; provider: string | null };
  lineage: { previous: Array<{ id: number; status: string }>; retries: Array<{ id: number; status: string }> };
  inFlight: boolean;
  lease: { owner: string | null; expiresAt: string | null; claimCount: number };
  revision: { id: number; no: number; title: string | null; publishedAt: string | null; bodyChars: number };
  latestRevision: { id: number; no: number } | null;
  publication: { activeSetId: number | null; activeRunId: number | null; activeRevisionNo: number | null; version: number };
  chunks: Array<{
    index: number;
    rangeStart: number;
    rangeEnd: number;
    status: string;
    attempts: number;
    lastError: string | null;
    responses: Array<{ attemptNo: number; outcome: string; error: string | null; tokensIn: number | null; tokensOut: number | null; latencyMs: number | null; createdAt: string }>;
  }>;
  candidates: Array<{
    id: number;
    predicate: string;
    role: string | null;
    grounded: boolean;
    verdict: 'publishable' | 'review' | 'ungrounded';
    rejectedReason: string | null;
    confidence: number | null;
    parties: string[];
    evidence: Array<{ quote: string; spanStart: number; spanEnd: number; stance: string; chunkId: number }>;
  }>;
  ambiguities: Array<{ id: number; surface: string; status: string; candidates: number }>;
  runComplete: boolean;
}

export interface IPublishPreviewItem {
  signature: string;
  predicate: string;
  grounded: boolean;
  quotes: string[];
}

export interface IPublishPreview {
  previewToken: string;
  run: { id: number; status: string; coveredChars: number | null; totalChars: number | null; complete: boolean };
  setId: number;
  sourceItemId: number;
  status: string;
  relevant: boolean;
  activeSetId: number | null;
  expectedVersion: number;
  stale: { stale: boolean; reason: string | null };
  policy: { allowed: boolean; reason: string | null };
  added: IPublishPreviewItem[];
  removed: IPublishPreviewItem[];
  kept: IPublishPreviewItem[];
  changed: Array<{ before: string; after: string }>;
  ungrounded: IPublishPreviewItem[];
  reviewImpact: Array<{ assertionId: number; status: string; decisions: number }>;
  contradictions: Array<{ assertionId: number }>;
}

export interface IPublishResult {
  outcome: 'published' | 'already_published' | 'rejected_policy' | 'rejected_stale';
  setId: number;
  version: number;
  reason: string | null;
  nextStep: string | null;
  assertions: number;
  evidenceAdded: number;
  evidenceSuperseded: number;
}
