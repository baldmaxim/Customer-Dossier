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
  /** 02.10.2026: чем одноимённые различаются — публикации, группа и юридический адрес со страницы ДОМ.РФ,
   *  группа, в которую компания входит, и сколько застройщиков в её группе. */
  publications?: number | null;
  registryGroup?: string | null;
  registryAddress?: string | null;
  memberOf?: string | null;
  members?: number;
  exact?: boolean;
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
  /** Заведена по реквизиту, наименование ЕГРЮЛ ещё не пришло: имя временное («ИНН …», ADR-016). */
  namePending?: boolean;
}

/** Наименование и статус по ЕГРЮЛ — заголовок карточки (ADR-016); из последнего ответа Контур.Фокуса. */
export interface ICompanyEgrul {
  name: string | null;
  fullName: string | null;
  status: string | null;
  fetchedAt: string;
}

/** «На контроле» (ADR-016): кто и когда поставил. */
export interface ICompanyWatch {
  addedBy: string;
  addedAt: string;
}

export type FocusStopReason = 'no_key' | 'limit' | 'key_rejected' | 'quota_exhausted' | 'rate_limited';

/** Что ответил Контур.Фокус при заведении компании; заведение от ответа не зависит. */
export type RegisterFocusOutcome =
  | { status: 'found' | 'not_found' | 'already_checked' }
  | { status: 'stopped'; reason: FocusStopReason }
  | { status: 'failed'; error: string };

/** Ответ POST /api/companies — компания по ИНН/ОГРН. */
export interface ICompanyRegistered {
  companyId: number;
  /** false — карточка с этим реквизитом уже была. */
  created: boolean;
  identifier: { type: string; value: string };
  focus: RegisterFocusOutcome;
}

/** Вид каталога компаний (ADR-016): юрлица, группы, имена без ИНН. */
export type CatalogView = 'legal' | 'groups' | 'unidentified';

export interface ICatalogMember {
  companyId: number;
  name: string;
  inn: string | null;
}

/** Строка каталога GET /api/catalog/companies. */
export interface ICatalogRow {
  /** company — карточка портала; registry_group — группа только по реестру ДОМ.РФ, своей карточки нет. */
  kind: 'company' | 'registry_group';
  companyId: number | null;
  groupRef: string | null;
  name: string;
  /** Краткое наименование по ЕГРЮЛ (Контур.Фокус); null — сведений нет. */
  egrulName: string | null;
  egrulStatus: string | null;
  inn: string | null;
  ogrn: string | null;
  city: string | null;
  entityType: string;
  roles: string[];
  objects: number;
  publications: number;
  lastPublishedAt: string | null;
  watched: boolean;
  namePending: boolean;
  /** Кандидатов для назначения: подсказки Фокуса по названию и пары «возможный дубль». */
  hints: number;
  /** СЗ и другие юрлица, которые входят в эту компанию или группу: в общем списке их нет. */
  members: ICatalogMember[];
  /** Куда входит сама компания (видно в плоском списке «на контроле»). */
  parents: string[];
}

export interface ICatalogResponse {
  view: CatalogView;
  items: ICatalogRow[];
  total: number;
  counts: Record<CatalogView, number> & { watched: number; dismissed: number };
}

/** Назначение имени без ИНН (ADR-016, этап 23D): GET /api/companies/:id/assignment. */
export type AssignmentState = 'unidentified' | 'identified' | 'group' | 'dismissed';

export interface IPortalCandidate {
  companyId: number;
  name: string;
  inn: string | null;
  ogrn: string | null;
  city: string | null;
  entityType: string;
  similarity: number | null;
  mergeQueueId: number | null;
  modelVerdict: 'same' | 'different' | 'unsure' | null;
  modelReason: string | null;
}

export interface IEgrulCandidate {
  inn: string | null;
  ogrn: string | null;
  name: string | null;
  address: string | null;
  status: string | null;
  existingCompanyId: number | null;
  existingCompanyName: string | null;
}

export interface IAssignmentView {
  state: AssignmentState;
  dismissal: { reason: string; by: string; at: string } | null;
  portal: IPortalCandidate[];
  egrul: IEgrulCandidate[];
  search: { query: string; searchedAt: string | null; nextSearchAt: string; lastError: string | null } | null;
  focusConfigured: boolean;
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

export interface IRegistryFieldChange {
  label: string;
  from: string | null;
  to: string | null;
}

export interface IRegistryChangeEntry {
  asOf: string | null;
  fetchedAt: string;
  changes: IRegistryFieldChange[];
}

/** Снимок реестра на дату (этап 20B): показывается с датой и атрибуцией, не как проверенный факт. */
export interface IRegistryView {
  source: { key: string; title: string };
  externalRef: string;
  asOf: string | null;
  fetchedAt: string;
  fields: Array<{ label: string; value: string }>;
  developer: { name: string; legalForm: string | null; inn: string | null; ogrn: string | null } | null;
  groupName: string | null;
  address: string | null;
  changes: IRegistryChangeEntry[];
  coverage: { loaded: number; truncated: boolean };
  attribution: string;
  /** Главное фото объекта снято (только у снимка объекта). */
  hasPhoto?: boolean;
  /** Карточки портала застройщика и его группы (только у снимка объекта). */
  developerCompany?: { id: number; name: string } | null;
  groupCompany?: { id: number; name: string } | null;
}

/** Похожий объект со сведениями реестра: подсказка «возможно, это тот же», не подстановка данных. */
export interface IRegistryLookalike {
  projectId: number;
  name: string;
  city: string | null;
  reason: 'merge_queue' | 'name';
}

/** Сводка последнего снимка ДОМ.РФ по объекту — поля сайта на дату, не проверенный факт. */
export interface ICompanyObjectRegistry {
  externalRef: string;
  sourceTitle: string;
  asOf: string | null;
  fetchedAt: string;
  address: string | null;
  status: string | null;
  completion: string | null;
  keys: string | null;
  apartments: string | null;
  pricePerSqm: string | null;
  propertyClass: string | null;
  floors: string | null;
  sold: string | null;
  contractor: string | null;
  developer: string | null;
  group: string | null;
  /** Главное фото снято: GET /api/projects/:id/photo. Старый сервер поля не присылает. */
  hasPhoto?: boolean;
}

/** Объект на вкладке «Объекты» карточки компании (02.10.2026). */
export interface ICompanyObject {
  projectId: number;
  name: string;
  city: string | null;
  level: string | null;
  basis: 'participation' | 'event';
  roles: Array<{ role: string; isCurrent: boolean; origin: string }>;
  /** Объект застройщика из группы компании: роль у него, а не у самой компании. */
  via: { companyId: number; name: string } | null;
  registry: ICompanyObjectRegistry | null;
  state: { state: string; validFrom: string | null } | null;
}

export interface ICompanyObjectsResponse {
  items: ICompanyObject[];
  members: Array<{ companyId: number; name: string }>;
  coverage: { loaded: number; total: number; truncated: boolean };
}

/** «Кто строит для компании» (этап 24D): GET /api/companies/:id/builders. */
export type BuilderRole = 'general_contractor' | 'contractor';
export type BuilderSource = 'registry' | 'publications';

export interface IBuilderObject {
  projectId: number;
  name: string;
  role: BuilderRole;
  sources: BuilderSource[];
  isCurrent: boolean;
  registryAsOf: string | null;
  lastPublication: string | null;
  mentions: number | null;
}

export interface ICompanyBuilder {
  key: string;
  name: string;
  inn: string | null;
  company: { id: number; name: string } | null;
  match: 'identifier' | 'name' | 'participation' | null;
  registryNames: string[];
  inGroup: boolean;
  roles: BuilderRole[];
  sources: BuilderSource[];
  objects: IBuilderObject[];
  lastSeen: string | null;
}

export interface ICompanyBuildersResponse {
  items: ICompanyBuilder[];
  objects: { customerSide: number; withRegistry: number; withRegistryContractor: number; truncated: boolean };
}

export interface IRegistryProjectRow {
  projectId: number;
  name: string;
  city: string | null;
  asOf: string | null;
  fetchedAt: string;
}

export interface ICompanyResponse {
  company: ICompany;
  aliases: Array<{ alias: string; hits: number }>;
  identifiers?: ICompanyIdentifier[];
  relations?: ICompanyRelation[];
  registry?: IRegistryView | null;
  registryProjects?: IRegistryProjectRow[];
  /** «На контроле»; null — не стоит. */
  watch?: ICompanyWatch | null;
  /** Наименование по ЕГРЮЛ; null — реквизита или ответа Фокуса нет. */
  egrul?: ICompanyEgrul | null;
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
  role: Role | null;
  confidence: number | null;
  isCurrent: boolean | null;
  basis: 'participation' | 'event';
  counterparties: Array<{ id: number; name: string; role: Role }> | null;
}

export type TextCompleteness = 'full' | 'excerpt' | 'caption_only' | 'failed' | 'unknown';

export interface ISourceItem {
  id: number;
  sourceId: number;
  sourceTitle: string;
  sourceKind: string;
  /** Ключ канала: сервер отдаёт его всегда (ITEM_COLUMNS), экран подписывает «@ключ», пока нет имени. */
  sourceKey: string;
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
  /** Заголовок источника последней редакции; у telegram-постов его нет. */
  title: string | null;
  latestCompleteness: TextCompleteness | null;
  latestCompletenessReason: string | null;
  /** Тема, составленная локальной моделью (headline@1). Не заголовок источника. */
  topic: string | null;
  topicModel: string | null;
  topicVersion: string | null;
}

/** Состояние текста для страницы документа: почему из него взято именно столько. */
export type ItemState =
  | 'in_cards'
  | 'nothing_found'
  | 'not_relevant'
  | 'built_not_in_cards'
  | 'running'
  | 'queued'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'no_policy'
  | 'no_run';

export interface IItemAssertion {
  id: number;
  predicate: string;
  role: string | null;
  eventType: string | null;
  polarity: string;
  modality: string;
  status: string;
  validFrom: string | null;
  periodPrecision: string;
  parties: Array<{ kind: 'company' | 'project'; id: number; name: string; side: string }>;
  quotes: Array<{ quote: string; spanStart: number; spanEnd: number; stance: string }>;
}

export interface IItemOutcome {
  state: ItemState;
  policy: { allowed: boolean; reason: string | null };
  run: {
    id: number;
    status: string;
    error: string | null;
    finishedAt: string | null;
    coveredChars: number | null;
    totalChars: number | null;
    relevant: boolean | null;
    revisionNo: number;
  } | null;
  activeSetId: number | null;
  assertions: IItemAssertion[];
  companies: Array<{ id: number; name: string }>;
  projects: Array<{ id: number; name: string }>;
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

/** Картинка публикации Telegram — сжатая копия на портале (GET /api/items/:id/images/:n). */
export interface IPostImage {
  /** Порядок в посте, с нуля. */
  n: number;
  /** video — обложка: само видео открывается в оригинале. */
  kind: 'photo' | 'video';
  width: number;
  height: number;
}

export interface IRevision extends Omit<IRevisionMeta, 'bodyLength' | 'observationCount'> {
  sourceItemId: number;
  title: string | null;
  body: string;
  /** Картинки публикации; null — не записано (пост собран до 06.10.2026, не Telegram, сбор фото выключен). */
  images?: { items: IPostImage[]; missing: number } | null;
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
  sourceTitle: string | null;
  sourceKey: string | null;
  sourceKind: string | null;
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
  /** Вердикт модели и причина (02.10.2026); старый сервер полей не присылает. */
  modelVerdict?: 'same' | 'different' | 'unsure' | null;
  modelReason?: string | null;
  decisionNote?: string | null;
}

export type PermissionStatus = 'unknown' | 'approved' | 'blocked' | 'revoked' | 'expired';

/** Этап 16 (source-health@1): состояние источника для оператора. */
export interface ISourceHealthState {
  version: string;
  state: 'never_run' | 'healthy' | 'degraded' | 'policy_blocked' | 'temporary_error' | 'partial_history';
  reason: string;
  coverage: { totalKnown: false; gaps: string[] };
  aiAllowed: boolean;
}

export interface ISourceRow {
  healthState?: ISourceHealthState;
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
  /** Срок сбора: глубина истории в днях; null — только новые (канал) / весь архив (сайт). */
  historyDays: number | null;
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

// ─── Сигналы компании (этап 07, signals@2) ────────────────────────────────

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

/**
 * signals@3: ряд по календарным месяцам (UTC), 24 месяца по месяц среза. value — сумма месяцев, denominator —
 * всё рассмотренное; что не вошло — по причине. В снимках прежних правил ряда нет.
 */
export interface ISignalMonthlySeries extends ISignalAggregate {
  buckets: Array<{ month: string; value: number }>;
  excluded: { undated: number; beforeWindow: number; future: number; coarse: number; registry: number };
  partialLast: boolean;
}

/** Дата из выборки (signals@2): неизвестна — insufficient_data, а не сегодняшняя. */
export interface ISignalDate {
  value: string | null;
  status: 'ok' | 'insufficient_data';
  rule: string;
  sourceItemId: number | null;
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
    /* signals@2. В снимках, считанных прежними правилами, этих чисел нет — отсюда `?`. */
    contractsCount?: ISignalAggregate;
    corporateCount?: ISignalAggregate;
    counterparties?: ISignalAggregate;
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
    firstPublishedAt?: ISignalDate;
    latestPublishedAt?: ISignalDate;
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
    eventsByType?: Record<string, ISignalAggregate>;
    legalCasesCount?: ISignalAggregate;
    /* signals@3: в снимках прежних правил рядов нет — отсюда `?`. */
    publicationsByMonth?: ISignalMonthlySeries;
    eventsByMonth?: ISignalMonthlySeries;
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

/** Сводка по базе для главной и для ступени «Результат». */
export interface ISummaryResponse {
  byIdentity: Array<{ identityStatus: string; n: number }>;
  totals: {
    companies: number;
    projects: number;
    documents: number;
    pendingMerges: number;
    lonelyCompanies: number;
  } | null;
  refresh: ISignalRefreshState;
}

/** Состояние конвейера: очередь, извлечения и включённость фоновых заданий. */
/** Строка ленты публикаций о компании (этап 22). Одна публикация — одна строка. */
export interface IPublicationFact {
  assertionId: number | null;
  predicate: string;
  role: string | null;
  eventType: string | null;
  modality: string | null;
  polarity: string | null;
  status: string | null;
  projectId: number | null;
  projectName: string | null;
  otherCompanyId: number | null;
  otherCompanyName: string | null;
  amount: string | null;
  currency: string | null;
  valueType: string | null;
  quote: string | null;
}

export interface IPublicationRow {
  itemId: number;
  revisionId: number;
  documentId: number | null;
  title: string | null;
  topic: string | null;
  publishedAt: string | null;
  observedAt: string;
  sourceTitle: string;
  sourceKind: string;
  /** Ключ канала: пока имя канала не собрано, экран показывает «@ключ» (sourceLabel). */
  sourceKey: string;
  url: string | null;
  completeness: string;
  snippet: string;
  facts: IPublicationFact[];
  moreFacts: number;
}

export type PartnerKind = 'contract' | 'corporate' | 'co_participation';

export interface IPartnerLink {
  kind: PartnerKind;
  role: string | null;
  ownRole: string | null;
  projectId: number | null;
  projectName: string | null;
  assertionId: number | null;
  modality: string | null;
  status: string | null;
}

export interface IPartnerRow {
  companyId: number;
  name: string;
  city: string | null;
  links: IPartnerLink[];
}

export interface IPipelineOverview {
  /** Состояния старого конвейера: новый путь их не меняет, экран по ним не строится. */
  queue: Array<{ status: string; n: number }>;
  /** Где сейчас последние редакции: почему текст не в карточках (этап 22). */
  revisions: Array<{ state: string; n: number }>;
  /** Причины падений за неделю, словами. */
  failures: Array<{ reason: string; n: number }>;
  /** Отвечает ли локальная модель. Не отвечает — разбор стоит, данные целы. */
  model: { ok: boolean; error: string | null; models: string[] };
  extractions: Array<{ promptVersion: string; model: string; status: string; n: number }>;
  rejectedEvents: Array<{ type: string; n: number }>;
  worker: {
    ingestEnabled: boolean;
    pipelineEnabled: boolean;
    autoPublish: boolean;
    metricsAutoRefresh: boolean;
    retryEnabled: boolean;
    retryMax: number;
  };
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
  quotes: Array<{ evidenceId: number; quote: string; sourceTitle: string; publishedAt: string | null; stance: string;
    revisionId?: number; sourceKey?: string; sourceKind?: string; url?: string | null; observedAt?: string; title?: string | null }>;
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

/** Этап 17 (negotiation-brief@1): краткое досье для переговоров. */
export interface IBriefItem {
  code: string;
  status: string;
  statusLabel: string;
  text: string;
  scope: string | null;
  asOf: string | null;
  sources: { publications: number; textFamilies: number; independence: string; label: string };
  pendingRevision: boolean;
  assertionIds: number[];
  evidenceIds: number[];
}

export interface IBriefSection {
  key: string;
  title: string;
  items: IBriefItem[];
  empty: string;
}

export interface INegotiationBrief {
  version: string;
  sections: IBriefSection[];
  background: IBriefSection;
  questions: Array<{ code: string; text: string; basedOn: string }>;
  dataLimits: string[];
}

export interface ICaseDossier {
  /** Снимки до dossier-template@3 — без поля. */
  brief?: INegotiationBrief;
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
  registry: IRegistryView | null;
  /** Своего снимка нет — похожие объекты со сведениями реестра. Старый сервер поля не присылает. */
  registryLookalikes?: IRegistryLookalike[];
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

// Первое досье: ручная вставка и постановка запуска по одной редакции
/** Исход сохранения текста. Сохранение — не разбор: разбор портал выполняет сам. */
export type ManualPasteOutcome =
  | 'inserted'
  | 'duplicate'
  | 'new_revision'
  | 'unchanged'
  | 'stale'
  | 'too_short'
  | 'edited_skipped';

export interface IManualPasteResult {
  outcome: ManualPasteOutcome;
  /** Legacy-документ с цитатами; null — текст не сохранён (too_short, edited_skipped). */
  documentId: number | null;
  sourceItemId: number | null;
  revisionId: number | null;
  revisionNo: number | null;
}

/** Ответ постановки, повтора и отмены запуска. Неуспешные исходы приходят с `error` и `code`. */
export interface IEnqueueResult {
  outcome: string;
  runId?: number;
  reason?: string;
  note?: string;
  error?: string;
  code?: string;
  /** false — поставленное выполнит только `npm run pipeline:once`. */
  pipelineEnabled?: boolean;
}

// ─── Пользователи и права (ADR-014) ──────────────────────────────────────────

/** Роль пользователя портала. Не путать с `Role` — ролью компании на объекте. */
export type UserRole = 'admin' | 'operator' | 'viewer';

export type AccessPermission =
  | 'portal.read'
  | 'admin.view'
  | 'sources.manage'
  | 'pipeline.manage'
  | 'review.decide'
  | 'entities.merge'
  | 'dossier.view'
  | 'dossier.manage'
  | 'users.manage'
  | 'llm.manage'
  | 'focus.manage'
  | 'parserapi.manage'
  | 'companies.manage';

export interface IAuthUser {
  id: number;
  login: string;
  displayName: string;
  role: UserRole;
  permissions: AccessPermission[];
  mustChangePassword: boolean;
}

export interface ISessionInfo {
  /** Нужен ли вход вообще: локально (AUTH_MODE=none) — нет, на сервере — да. */
  authRequired: boolean;
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: string;
  user?: IAuthUser;
  /** Сервер принимает вход по ключу доступа (passkey): есть публичный адрес-домен. */
  passkeys?: boolean;
}

/** Ключ доступа (passkey): только подпись и даты — открытый ключ и идентификаторы на экран не приходят. */
export interface IPasskeyRow {
  id: number;
  name: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Заявка на доступ (самостоятельная регистрация): approved — обычный пользователь, pending — ждёт
 * решения администратора, rejected — отклонена. Заявка и отклонённая заявка не входят.
 */
export type RegistrationState = 'pending' | 'approved' | 'rejected';

export interface IUserRow {
  id: number;
  login: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  version: number;
  registration: RegistrationState;
  liveSessions?: number;
  /** Живых ключей доступа. */
  passkeys?: number;
}

export interface IUserSessionRow {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  /** Сессия, из которой смотрит сам администратор. */
  current: boolean;
}

export interface IAuthEventRow {
  id: number;
  at: string;
  event: string;
  userId: number | null;
  userLogin: string | null;
  actor: string;
  ip: string | null;
  details: Record<string, unknown>;
}

export interface IRolesInfo {
  permissions: AccessPermission[];
  roles: Array<{ role: UserRole; permissions: AccessPermission[] }>;
}

// ─── Модель (вкладка админки «Модель») ───────────────────────────────────────

export type LlmProvider = 'lmstudio' | 'openrouter';

/** Откуда ключ OpenRouter: админка главнее .env. */
export type LlmKeySource = 'admin' | 'env' | 'none';

export type LlmKeyProblem = 'store_missing' | 'undecryptable';

/** Сам ключ сервер не отдаёт никогда: только источник и четыре последних символа. */
export interface ILlmKeyStatus {
  source: LlmKeySource;
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  envKeySet: boolean;
  problem: LlmKeyProblem | null;
  /** В DATABASE_URL есть пароль — ключ в базе есть чем зашифровать. */
  canStore: boolean;
}

export interface ILlmSettings {
  provider: LlmProvider;
  model: string;
  routeProviders: string[];
  key: ILlmKeyStatus;
  connection: { ok: boolean; error: string | null };
}

/** accepted — принят; exhausted — принят, но лимит исчерпан; unreachable — проверить не удалось. */
export type LlmKeyVerdict = 'accepted' | 'exhausted' | 'unreachable';

export interface ILlmKeySaved {
  key: ILlmKeyStatus;
  check: { verdict: LlmKeyVerdict; error: string | null };
}

// ─── Контур.Фокус (ADR-015) ──────────────────────────────────────────────────

/** Ключ Фокуса устроен как ключ OpenRouter: источник, четыре последних символа, кто и когда задал. */
export type IFocusKeyStatus = ILlmKeyStatus;

export interface IFocusField {
  key: string;
  label: string;
  value: string;
}

export interface IFocusChangeEntry {
  fetchedAt: string;
  changes: Array<{ label: string; from: string | null; to: string | null }>;
}

/** no_identifier — у компании нет ИНН/ОГРН; several_identifiers — их несколько разных. */
export type FocusTargetProblem = 'no_identifier' | 'several_identifiers';

/** Сведения ЕГРЮЛ/ЕГРИП о компании по данным Контур.Фокуса. */
export interface IFocusView {
  configured: boolean;
  scheduled: boolean;
  refreshDays: number;
  identifier: { type: 'inn' | 'ogrn'; value: string } | null;
  problem: FocusTargetProblem | null;
  check: {
    outcome: 'found' | 'not_found' | null;
    checkedAt: string | null;
    nextCheckAt: string;
    attemptCount: number;
    lastError: string | null;
  } | null;
  fetchedAt: string | null;
  fields: IFocusField[];
  summary: { status: string | null; head: string | null; address: string | null } | null;
  focusHref: string | null;
  changes: IFocusChangeEntry[];
  coverage: { loaded: number; truncated: boolean };
  attribution: string;
}

export interface IFocusRefreshed {
  outcome: 'found' | 'not_found';
  saved: number;
  view: IFocusView;
}

export type FocusRequestOutcome =
  | 'ok'
  | 'key_rejected'
  | 'method_forbidden'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'bad_response'
  | 'http_error'
  | 'network';

export interface IFocusRequestRow {
  requestedAt: string;
  method: 'req' | 'egrDetails' | 'stat' | 'suggest';
  identifiersCount: number;
  httpStatus: number | null;
  outcome: FocusRequestOutcome;
  error: string | null;
  actor: string;
}

export interface IFocusSettings {
  key: IFocusKeyStatus;
  enabled: boolean;
  dailyLimit: number;
  refreshDays: number;
  usedLastDay: number;
  coverage: { companies: number; identifiers: number; found: number; notFound: number; due: number; failing: number };
  recent: IFocusRequestRow[];
}

/** accepted — Фокус принял ключ; unknown — проверить не удалось, ключ сохранён. */
export interface IFocusKeySaved {
  key: IFocusKeyStatus;
  check: { verdict: 'accepted' | 'unknown'; error: string | null };
}

// ─── parser-api.com (этап 24A) ───────────────────────────────────────────────

export type ParserApiDataset = 'finance' | 'tax' | 'courts' | 'fssp' | 'bankruptcy';
export type ParserApiMethod = 'bo_search' | 'bo_details' | 'pb_org' | 'kad_search' | 'fssp_ur' | 'fedresurs_ur' | 'fedresurs_org' | 'key_check';
export type ParserApiRequestOutcome =
  | 'pending'
  | 'ok'
  | 'key_rejected'
  | 'subscription_expired'
  | 'ip_rejected'
  | 'daily_limit'
  | 'monthly_limit'
  | 'bad_request'
  | 'bad_response'
  | 'http_error'
  | 'network';

export interface IParserApiRequestRow {
  requestedAt: string;
  method: ParserApiMethod;
  inn: string | null;
  page: number | null;
  httpStatus: number | null;
  apiCode: number | null;
  outcome: ParserApiRequestOutcome;
  billable: boolean;
  error: string | null;
  actor: string;
}

export type ParserApiConnectionState = 'none' | 'unverified' | 'connected' | 'key_rejected' | 'subscription_expired' | 'ip_rejected';

export interface IParserApiSettings {
  key: ILlmKeyStatus;
  /** Подключение по журналу запросов после последней смены ключа; у старого сервера поля нет. */
  connection?: { state: ParserApiConnectionState; at: string | null };
  enabled: boolean;
  limits: { daily: number; monthly: number };
  kadMaxPages: number;
  usage: { day: number; month: number };
  coverage: { watched: number; checked: number; failing: number; due: number };
  recent: IParserApiRequestRow[];
}

/** Состояние набора сведений компании: не проверяли (outcome null без ошибки), есть, нет, часть, ошибка. */
export interface IParserApiDatasetState {
  dataset: ParserApiDataset;
  outcome: 'found' | 'not_found' | 'partial' | null;
  checkedAt: string | null;
  nextCheckAt: string | null;
  attemptCount: number;
  lastError: string | null;
  record: { fetchedAt: string; complete: boolean; missing: string[] } | null;
}

/** Финансы компании (этап 24B): GET /api/companies/:id/finance. Все суммы — в рублях. */
export type FinanceLine =
  | 'revenue'
  | 'salesProfit'
  | 'pretaxProfit'
  | 'netProfit'
  | 'interestPayable'
  | 'assets'
  | 'equity'
  | 'longBorrowings'
  | 'shortBorrowings'
  | 'payables'
  | 'receivables'
  | 'cash';

export type IFinanceYear = {
  year: number;
  source: { period: number; publishedDate: string | null; actualDate: string | null; correctionNumber: number; audited: boolean; pdfUrl: string | null };
} & Record<FinanceLine, number | null>;

export interface IFinanceView {
  format: string;
  recognized: boolean;
  problems: string[];
  unit: 'RUB';
  years: IFinanceYear[];
}

export interface ITaxView {
  format: string;
  recognized: boolean;
  problems: string[];
  unit: 'RUB';
  headcount: Array<{ year: number; count: number }>;
  incomeExpenses: Array<{ year: number; income: number | null; expense: number | null }>;
  taxesPaid: Array<{ year: number; total: number; lines: number }>;
  arrears: { year: number; period: number | null; total: number; arrear: number; penalty: number; fine: number; items: Array<{ name: string; total: number }> } | null;
  arrearsHistory: Array<{ year: number; period: number | null; total: number }>;
  flags: { bailiffDebt: boolean | null; noReporting: boolean | null; asOf: string | null };
  taxModes: string[];
  msp: string | null;
}

export interface IParserApiBlock<TView> {
  state: IParserApiDatasetState;
  view: TView | null;
}

export interface ICompanyFinanceResponse {
  inn: string | null;
  problem: 'no_inn' | 'several_inns' | null;
  configured: boolean;
  scheduled: boolean;
  finance: IParserApiBlock<IFinanceView> | null;
  tax: IParserApiBlock<ITaxView> | null;
}

/** Суды, ФССП и банкротство (этап 24C): GET /api/companies/:id/registry-checks. */
export type CourtCaseType = 'economic' | 'administrative' | 'bankruptcy' | 'unknown';
export type CourtRole = 'respondent' | 'plaintiff' | 'third' | 'other' | 'unknown';

export interface ICourtCase {
  id: string | null;
  number: string;
  startDate: string | null;
  court: string | null;
  type: CourtCaseType;
  roles: CourtRole[];
  counterparties: string[];
  counterpartiesTotal: number;
  url: string | null;
}

export interface ICourtsView {
  format: string;
  recognized: boolean;
  problems: string[];
  window: { from: string } | null;
  complete: boolean;
  total: number;
  byRole: Record<CourtRole, number>;
  byType: Record<CourtCaseType, number>;
  last12m: { from: string; total: number; respondent: number; plaintiff: number } | null;
  cases: ICourtCase[];
}

export interface IFsspProceeding {
  number: string;
  date: string | null;
  subject: string | null;
  debt: number | null;
  remaining: number | null;
  department: string | null;
  issuer: string | null;
  stopDate: string | null;
  stopReason: string | null;
}

export interface IFsspView {
  format: string;
  recognized: boolean;
  problems: string[];
  totalRows: number | null;
  loaded: number;
  complete: boolean;
  open: { count: number; debt: number; remaining: number; remainingCovered: number; fee: number };
  ended: { count: number; byReason: Array<{ reason: string; count: number }> };
  unknownStatus: number;
  openedByYear: Array<{ year: number; count: number }>;
  last12m: { from: string; count: number } | null;
  bySubject: Array<{ subject: string; count: number }>;
  recent: IFsspProceeding[];
}

export interface IBankruptcyView {
  format: string;
  recognized: boolean;
  problems: string[];
  found: boolean;
  record: { name: string | null; category: string | null; region: string | null; address: string | null } | null;
}

export interface ICompanyChecksResponse {
  inn: string | null;
  problem: 'no_inn' | 'several_inns' | null;
  configured: boolean;
  scheduled: boolean;
  courts: IParserApiBlock<ICourtsView> | null;
  fssp: IParserApiBlock<IFsspView> | null;
  bankruptcy: IParserApiBlock<IBankruptcyView> | null;
}

// ─── Найдено на ДОМ.РФ (этап 20D) ────────────────────────────────────────────

export type DomRfCardKind = 'developer' | 'group';

export type DomRfCandidateState = 'pending' | 'confirmed' | 'rejected' | 'replaced';

/** Объект со страницы застройщика или группы; сам не собирается, ждёт решения оператора. */
export interface IDomRfCandidate {
  id: number;
  externalRef: string;
  url: string;
  label: string | null;
  details: string | null;
  foundViaKind: DomRfCardKind;
  foundViaRef: string;
  state: DomRfCandidateState;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  replacementRef: string | null;
  firstSeenAt: string;
}

/** Страница, на которой нашлись объекты, и заказчик портала с тем же ИНН. */
export interface IDomRfCandidateSource {
  kind: DomRfCardKind;
  externalRef: string;
  url: string;
  name: string | null;
  inn: string | null;
  scannedAt: string | null;
  companyId: number | null;
  companyName: string | null;
  pending: number;
}

export interface IDomRfCandidates {
  items: IDomRfCandidate[];
  sources: IDomRfCandidateSource[];
}

export type DomRfCompanyLinkState = 'pending' | 'confirmed' | 'rejected';

export type DomRfFoundBy = 'inn' | 'name' | 'manual';

export type DomRfHintVerdict = 'match' | 'no_match' | 'unsure';

/** Подсказка модели к совпадению (domrf-hint@1): не решение, на экране подписана как подсказка. */
export interface IDomRfLinkHint {
  verdict: DomRfHintVerdict | null;
  reason: string | null;
  /** Ответ не по форме — подсказки нет. */
  error: string | null;
  model: string;
  at: string;
}

/** Застройщик или группа из реестра, найденные для заказчика; решение — за оператором. */
export interface IDomRfCompanyLink {
  id: number;
  kind: DomRfCardKind;
  externalRef: string;
  url: string;
  name: string | null;
  /** Строки карточки результата поиска рядом с названием: реквизиты, регион. */
  details: string | null;
  foundBy: DomRfFoundBy;
  rank: number | null;
  state: DomRfCompanyLinkState;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Закрыто без отдельного решения: «выбрана другая запись». */
  decisionNote: string | null;
  hint: IDomRfLinkHint | null;
}

/** Итог решения по записи: что ещё закрылось, вернулось и ушло из «Объектов». */
export interface IDomRfDecisionResult {
  ok: true;
  closed: number;
  reopened: number;
  withdrawnObjects: number;
}

/** Компания портала и её поиск в едином реестре застройщиков. */
export interface IDomRfCompanyRow {
  companyId: number;
  name: string;
  /** Текущие роли на объектах; заказчики и застройщики — в начале списка и очереди поиска. */
  roles: string[];
  query: string | null;
  foundBy: 'inn' | 'name' | null;
  searchedAt: string | null;
  resultCount: number | null;
  lastError: string | null;
  links: IDomRfCompanyLink[];
}

export type DomRfCompanyFilter = 'pending' | 'notFound' | 'confirmed' | 'several' | 'all';

/** Страница ДОМ.РФ: числа вкладок и состояние подсказок модели. */
export interface IDomRfSummary {
  companies: IDomRfCompanies['totals'];
  objects: { pending: number };
  cards: { waiting: number; total: number };
  hints: {
    /** Задание разбора и флаг подсказок включены: без них подсказок нет при любом допуске. */
    running: boolean;
    sourceId: number | null;
    /** ИИ-обработка источника наш.дом.рф разрешена. */
    allowed: boolean;
    reason: string | null;
    provider: LlmProvider;
    model: string;
    hinted: number;
    waiting: number;
  };
}

export interface IDomRfCompanies {
  items: IDomRfCompanyRow[];
  /** Сколько компаний подошло под фильтр и поиск; в items — первые из них. */
  matched: number;
  totals: { companies: number; searched: number; withPending: number; confirmed: number; notFound: number; several: number };
}

// ─── Сайты компаний (этап 25A, ADR-018) ──────────────────────────────────────────────────────

/** Поиск сайтов: выключен владельцем, включён без OpenRouter (веб-поиска нет) или идёт. */
export type SiteSearchMode = 'off' | 'needs_openrouter' | 'on';
export type SiteCheckStatus = 'not_checked' | 'ok' | 'unreachable' | 'blocked' | 'redirect_other_host' | 'js_only' | 'not_html';
export type SiteCandidateState = 'pending' | 'confirmed' | 'rejected';
export type SiteFoundVia = 'web_search' | 'operator';
export type SiteSearchOutcome = 'found' | 'none' | 'no_citations';
export type CompanySitesFilter = 'pending' | 'confirmed' | 'notFound' | 'all';

export interface ISiteCandidate {
  id: number;
  companyId: number;
  host: string;
  url: string;
  foundVia: SiteFoundVia;
  /** Заголовок и фрагмент найденной поиском страницы. */
  title: string | null;
  snippet: string | null;
  /** Почему модель считает это сайтом компании — объяснение, не решение. */
  modelReason: string | null;
  model: string | null;
  checkStatus: SiteCheckStatus;
  checkedAt: string | null;
  checkError: string | null;
  pageTitle: string | null;
  /** null — не проверялось (нет реквизита или страница не открылась). */
  innOnPage: boolean | null;
  ogrnOnPage: boolean | null;
  nameOnPage: boolean | null;
  /** Другие ИНН на страницах сайта. */
  otherInns: string[];
  state: SiteCandidateState;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  firstSeenAt: string;
  /** Тот же сайт подтверждён у других компаний. */
  sharedWith: Array<{ companyId: number; name: string }>;
  /** Чтение подтверждённого сайта (25B); null — ещё не заведено. У старого сервера поля нет. */
  source?: ISiteSourceState | null;
}

export interface ISiteSourceState {
  id: number;
  status: 'active' | 'paused' | 'broken';
  health: string | null;
  healthReason: string | null;
  lastOkAt: string | null;
  lastAttemptAt: string | null;
}

export interface ISiteSearchState {
  query: string | null;
  outcome: SiteSearchOutcome | null;
  resultCount: number | null;
  searchedAt: string | null;
  nextSearchAt: string;
  lastError: string | null;
  requestedBy: string | null;
}

export interface IFamilySite {
  companyId: number;
  companyName: string;
  host: string;
  url: string;
}

export interface ICompanySites {
  mode: SiteSearchMode;
  candidates: ISiteCandidate[];
  /** Подтверждённые сайты групп, в которые входит компания. */
  familySites: IFamilySite[];
  search: ISiteSearchState | null;
}

export interface ICompanySitesRow {
  companyId: number;
  name: string;
  roles: string[];
  search: ISiteSearchState | null;
  candidates: ISiteCandidate[];
}

export interface ICompanySitesList {
  mode: SiteSearchMode;
  dailyLimit: number;
  items: ICompanySitesRow[];
  matched: number;
  totals: { searched: number; withPending: number; confirmed: number; notFound: number; usedLastDay: number };
}

// ─── Проекты с сайта компании (этап 25B) ─────────────────────────────────────────────────────

export type SiteProjectStatus = 'selling' | 'construction' | 'completed' | 'planned' | 'unknown';

export interface ICompanySiteProjectRow {
  name: string;
  status: SiteProjectStatus;
  completion: string | null;
  city: string | null;
  address: string | null;
  /** Дословно со страницы сайта. */
  quote: string;
  host: string;
  pageUrl: string;
  pageTitle: string | null;
  /** Дата снимка страницы. */
  seenAt: string;
  /** Впервые замечен на сайте. */
  firstSeenAt: string;
  /** Нет на портале и замечен впервые за последние 90 дней. */
  isNew: boolean;
  /** Объект портала с тем же названием. */
  match: { projectId: number; name: string } | null;
}

export interface ICompanySiteRead {
  host: string;
  url: string;
  status: 'active' | 'paused' | 'broken';
  health: string | null;
  healthReason: string | null;
  lastReadAt: string | null;
  pages: number;
}

export interface ICompanySiteProjects {
  sites: ICompanySiteRead[];
  projects: ICompanySiteProjectRow[];
  /** Страниц, которые модель ещё не разбирала. */
  waiting: number;
}
