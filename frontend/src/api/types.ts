export type RiskLight = 'grey' | 'green' | 'yellow' | 'red';

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
}

export interface IRisk {
  companyId: number;
  name: string;
  city: string | null;
  projectsTotal: number;
  activeProjects: number;
  doneProjects: number;
  projectsAsGc: number;
  projectsAsContractor: number;
  projectsAsCustomer: number;
  avgDelayDays: number | null;
  delayedProjects: number;
  delayShare: number | null;
  mentions90d: number;
  negative90d: number;
  negativeShare90d: number | null;
  lastMentionAt: string | null;
  hardEvents12m: number;
  replacedCount: number;
  riskScore: number;
  riskLight: RiskLight;
}

export interface ICompanyResponse {
  company: ICompany;
  risk: IRisk | null;
  aliases: Array<{ alias: string; hits: number }>;
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
  predicate: 'participates_in_project' | 'event' | 'company_mentioned' | 'project_mentioned';
  role: Role | null;
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
  scopeBuilding: string | null;
  workPackage: string | null;
  validFrom: string | null;
  validTo: string | null;
  modality: string;
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

export interface IContractorRow extends Omit<IRisk, 'lastMentionAt'> {
  lastMentionAt?: string | null;
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
}
