// Что портал взял из одного текста — для страницы документа.
//
// Вопрос оператора звучит так: «я открыл пост, что тут важного и попало ли что-нибудь
// в карточки». Ответ собирается из уже существующих связей: публикация → активный набор
// → доказательства набора → утверждения. Своего знания здесь нет.
//
// Пустой результат объясняется словами и различает причины: текст не о стройке,
// связей в нём нет, разбор не удался, источник без ИИ-допуска, разбор ещё не начинался.
// «Ничего не показано» и «ничего нет» — разные вещи.

import { query, queryOne } from '../db/pool.js';
import { evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';

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

export interface IItemStateInput {
  policyAllowed: boolean;
  run: { status: string; relevant: boolean | null } | null;
  activeSetId: number | null;
  assertions: number;
}

/**
 * Состояние текста одним словом. Порядок проверок значим: опубликованный набор старше
 * отозванного допуска — сведения уже в карточках, и молчать об этом нельзя.
 */
export const decideItemState = (input: IItemStateInput): ItemState => {
  if (input.activeSetId !== null) {
    if (input.assertions > 0) return 'in_cards';
    return input.run?.relevant === false ? 'not_relevant' : 'nothing_found';
  }
  if (!input.policyAllowed && input.run === null) return 'no_policy';
  if (input.run === null) return 'no_run';
  if (input.run.status === 'queued') return 'queued';
  if (input.run.status === 'running') return 'running';
  if (input.run.status === 'completed') return input.run.relevant === false ? 'not_relevant' : 'built_not_in_cards';
  if (input.run.status === 'partial') return 'partial';
  if (input.run.status === 'cancelled') return 'cancelled';
  return 'failed';
};

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

interface IRunRow {
  id: number;
  status: string;
  error: string | null;
  finished_at: Date | null;
  covered_chars: number | null;
  total_chars: number | null;
  relevant: boolean | null;
  revision_no: number;
}

interface IPolicyRow {
  key: string;
  access_status: PermissionStatus;
  ai_processing_status: PermissionStatus;
  policy_expires_at: Date | null;
}

interface IEvidenceRow {
  id: number;
  predicate: string;
  role: string | null;
  event_type: string | null;
  polarity: string;
  modality: string;
  status: string;
  valid_from: string | null;
  period_precision: string;
  subject_company_id: number | null;
  subject_company_name: string | null;
  object_company_id: number | null;
  object_company_name: string | null;
  counterparty_company_id: number | null;
  counterparty_company_name: string | null;
  subject_project_id: number | null;
  subject_project_name: string | null;
  object_project_id: number | null;
  object_project_name: string | null;
  context_project_id: number | null;
  context_project_name: string | null;
  quote: string;
  span_start: number;
  span_end: number;
  stance: string;
}

const PARTY_COLUMNS = `
  a.subject_company_id, sc.name AS subject_company_name,
  a.object_company_id, oc.name AS object_company_name,
  a.counterparty_company_id, cc.name AS counterparty_company_name,
  a.subject_project_id, sp.name AS subject_project_name,
  a.object_project_id, op.name AS object_project_name,
  a.context_project_id, xp.name AS context_project_name
`;

/** Что попало в карточки из этой публикации: только активный набор и только активные доказательства. */
const loadAssertions = async (itemId: number): Promise<IEvidenceRow[]> =>
  query<IEvidenceRow>(
    `SELECT a.id, a.predicate, a.role, a.event_type, a.polarity, a.modality, a.status,
            a.valid_from::text AS valid_from, a.period_precision,
            ${PARTY_COLUMNS},
            e.quote, e.span_start, e.span_end, e.stance
     FROM item_publications p
     JOIN candidate_sets cs ON cs.id = p.active_set_id
     JOIN candidate_set_evidence cse ON cse.set_id = cs.id
     JOIN evidence e ON e.id = cse.evidence_id AND e.status = 'active'
     JOIN assertions a ON a.id = e.assertion_id AND a.status <> 'rejected'
     LEFT JOIN companies sc ON sc.id = a.subject_company_id
     LEFT JOIN companies oc ON oc.id = a.object_company_id
     LEFT JOIN companies cc ON cc.id = a.counterparty_company_id
     LEFT JOIN projects sp ON sp.id = a.subject_project_id
     LEFT JOIN projects op ON op.id = a.object_project_id
     LEFT JOIN projects xp ON xp.id = a.context_project_id
     WHERE p.source_item_id = $1
     ORDER BY a.id, e.id`,
    [itemId],
  );

const partiesOf = (row: IEvidenceRow): IItemAssertion['parties'] => {
  const all: Array<{ kind: 'company' | 'project'; id: number | null; name: string | null; side: string }> = [
    { kind: 'company', id: row.subject_company_id, name: row.subject_company_name, side: 'subject' },
    { kind: 'company', id: row.object_company_id, name: row.object_company_name, side: 'object' },
    { kind: 'company', id: row.counterparty_company_id, name: row.counterparty_company_name, side: 'counterparty' },
    { kind: 'project', id: row.subject_project_id, name: row.subject_project_name, side: 'subject' },
    { kind: 'project', id: row.object_project_id, name: row.object_project_name, side: 'object' },
    { kind: 'project', id: row.context_project_id, name: row.context_project_name, side: 'context' },
  ];
  return all
    .filter(p => p.id !== null && p.name !== null)
    .map(p => ({ kind: p.kind, id: p.id!, name: p.name!, side: p.side }));
};

/** Состояние и содержание одной публикации. Публикации нет — null (404 решает маршрут). */
export const loadItemOutcome = async (itemId: number): Promise<IItemOutcome | null> => {
  const policyRow = await queryOne<IPolicyRow>(
    `SELECT s.key, s.access_status, s.ai_processing_status, s.policy_expires_at
     FROM source_items i JOIN sources s ON s.id = i.source_id WHERE i.id = $1`,
    [itemId],
  );
  if (!policyRow) return null;
  const policy = evaluateSourcePolicy(
    {
      key: policyRow.key,
      accessStatus: policyRow.access_status,
      aiProcessingStatus: policyRow.ai_processing_status,
      policyExpiresAt: policyRow.policy_expires_at,
    },
    'ai_processing',
  );

  const runRow = await queryOne<IRunRow>(
    `SELECT r.id, r.status, r.error, r.finished_at, r.covered_chars, r.total_chars, r.relevant, dr.revision_no
     FROM extraction_runs r
     JOIN document_revisions dr ON dr.id = r.revision_id
     WHERE dr.source_item_id = $1
     ORDER BY r.id DESC LIMIT 1`,
    [itemId],
  );

  const publication = await queryOne<{ active_set_id: number | null }>(
    'SELECT active_set_id FROM item_publications WHERE source_item_id = $1',
    [itemId],
  );

  const rows = await loadAssertions(itemId);
  const byId = new Map<number, IItemAssertion>();
  for (const row of rows) {
    const quote = { quote: row.quote, spanStart: row.span_start, spanEnd: row.span_end, stance: row.stance };
    const existing = byId.get(row.id);
    if (existing) {
      existing.quotes.push(quote);
      continue;
    }
    byId.set(row.id, {
      id: row.id,
      predicate: row.predicate,
      role: row.role,
      eventType: row.event_type,
      polarity: row.polarity,
      modality: row.modality,
      status: row.status,
      validFrom: row.valid_from,
      periodPrecision: row.period_precision,
      parties: partiesOf(row),
      quotes: [quote],
    });
  }
  const assertions = [...byId.values()];

  const companies = new Map<number, string>();
  const projects = new Map<number, string>();
  for (const a of assertions) {
    for (const p of a.parties) (p.kind === 'company' ? companies : projects).set(p.id, p.name);
  }

  return {
    state: decideItemState({
      policyAllowed: policy.allowed,
      run: runRow ? { status: runRow.status, relevant: runRow.relevant } : null,
      activeSetId: publication?.active_set_id ?? null,
      assertions: assertions.length,
    }),
    policy,
    run: runRow
      ? {
          id: runRow.id,
          status: runRow.status,
          error: runRow.error,
          finishedAt: runRow.finished_at?.toISOString() ?? null,
          coveredChars: runRow.covered_chars,
          totalChars: runRow.total_chars,
          relevant: runRow.relevant,
          revisionNo: runRow.revision_no,
        }
      : null,
    activeSetId: publication?.active_set_id ?? null,
    assertions,
    companies: [...companies.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    projects: [...projects.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
};
