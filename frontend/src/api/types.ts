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
  bin: string | null;
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

export interface IMention {
  id: number;
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
  amountKzt: number | null;
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

export interface ISourceRow {
  id: number;
  kind: 'telegram' | 'website' | 'manual';
  key: string;
  title: string;
  status: 'active' | 'paused' | 'broken';
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
