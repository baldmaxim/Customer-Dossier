// Сборка payload снимка досье обращения (этап 08B). Всё, что нужно для показа и экспорта, копируется:
// формулировки, цитаты с точными редакциями, подписи сущностей, решения аналитика, схема связей, версии правил.
// Снимок описывает то, что система знала в момент создания; фильтр дат относится к событиям и ролям.

import type { PoolClient } from 'pg';

import { evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';
import { refreshState } from '../signals/refresh.js';
import { overlap } from '../signals/intervals.js';
import { SIGNAL_RULES_VERSION } from '../signals/types.js';
import { buildCaseDossier, DOSSIER_TEMPLATE_VERSION, type ICaseDossier } from '../dossier/caseDossier.js';
import { getCase, type ICaseRow } from '../dossier/cases.js';
import { loadCompanyFactsPage, loadHomonyms, loadOpenQueue, loadProjectFactsPage, type ICoverage, type IFact } from '../dossier/facts.js';
import { loadIdentityStatus, loadProjectState } from '../dossier/load.js';
import { normalizeName } from '../resolve/normalize.js';
import { buildGraph, type IGraph, type NodeKey } from '../graph/graph.js';
import { graphLoader } from '../graph/load.js';

// @2 (этап 13): покрытие выборок (coverage), усечение загрузки схемы, чтение сигналов в транзакции снимка.
export const SNAPSHOT_SCHEMA_VERSION = 'dossier-snapshot@2';
export const GRAPH_VERSION = 'graph@1';

export interface ISnapshotSource {
  evidenceId: number;
  assertionId: number;
  stance: string;
  status: string;
  /** null — цитата не включена: допуск источника на момент создания не позволял выдачу. */
  quote: string | null;
  withheldReason: string | null;
  spanStart: number;
  spanEnd: number;
  revisionId: number;
  revisionNo: number;
  sourceItemId: number;
  sourceId: number;
  sourceKey: string;
  sourceTitle: string;
  /** Только http/https; иначе null. */
  url: string | null;
  publishedAt: string | null;
  completeness: string;
}

export interface ISnapshotPayload {
  schemaVersion: string;
  generatedAt: string;
  knowledgeCutoff: string;
  effective: { from: string | null; to: string | null; undatedIncluded: number; excluded: number; note: string };
  versions: { template: string; signalsRules: string; graph: string; signalsCutoff: string | null; signalsStale: boolean };
  case: Pick<ICaseRow, 'id' | 'version' | 'title' | 'companyStatus' | 'companyNameClaimed' | 'projectNameClaimed' | 'scopeBuilding' | 'workPackage' | 'workPackageLabel' | 'claimedRole' | 'claimedClientName' | 'claimedTerms' | 'requestDate' | 'operatorNote' | 'status' | 'provenance'>;
  company: { id: number; name: string; legalForm: string | null; entityType: string; identifiers: string[] } | null;
  claimedClient: { id: number; name: string } | null;
  project: { id: number; name: string; level: string; levelLabel: string | null; city: string | null } | null;
  dossier: ICaseDossier;
  assertions: Array<{ id: number; version: number; predicate: string; role: string | null; eventType: string | null; status: string; needsRevalidation: boolean; polarity: string; modality: string; supports: number; contradicts: number }>;
  reviews: Array<{ id: number; assertionId: number; decision: string; scope: string; reason: string | null; assertionVersion: number; decidedAt: string }>;
  openQueue: Array<{ kind: string; assertionId: number; priority: number }>;
  sources: ISnapshotSource[];
  graph: Pick<IGraph, 'nodes' | 'edges' | 'truncated' | 'notes'>;
  selection: { assertionIds: number[]; evidenceIds: number[]; reviewIds: number[] };
  limitations: string[];
  /** Покрытие выборок и загрузки схемы (coverage@1). В снимках dossier-snapshot@1 поля нет — полнота неизвестна. */
  coverage?: ICoverage[];
}

export class HistoricalCutoffError extends Error {
  constructor() {
    super('Срез знаний на прошлую дату не создаётся: история статусов, решений и доказательств хранится не полностью. Снимок фиксирует то, что известно сейчас; для событий прошлого используйте фильтр дат.');
    this.name = 'HistoricalCutoffError';
  }
}

const safeUrl = (raw: string | null): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Фильтр дат событий и ролей: пересечение с периодом; без даты — включается и считается отдельно. */
export const withinEffective = (fact: Pick<IFact, 'validFrom' | 'validTo'>, from: string | null, to: string | null): 'in' | 'out' | 'undated' => {
  if (!from && !to) return 'in';
  if (!fact.validFrom) return 'undated';
  return overlap({ validFrom: from ?? '0001-01-01', validTo: to ?? '9999-12-31' }, fact) === 'no_overlap' ? 'out' : 'in';
};

export const buildSnapshotPayload = async (
  client: PoolClient,
  caseId: number,
  options: { effectiveFrom: string | null; effectiveTo: string | null; now: Date },
): Promise<ISnapshotPayload | null> => {
  const caseRow = await getCase(client, caseId);
  if (!caseRow) return null;
  // Состояние сигналов читается той же транзакцией снимка (REPEATABLE READ): одна точка данных для всех разделов.
  const refresh = await refreshState(client);
  const { effectiveFrom: from, effectiveTo: to, now } = options;

  let undatedIncluded = 0;
  let excluded = 0;
  const applyEffective = (facts: IFact[]): IFact[] =>
    facts.filter(f => {
      if (f.predicate === 'contract' || f.predicate === 'corporate_relation') return true;
      const w = withinEffective(f, from, to);
      if (w === 'out') excluded += 1;
      if (w === 'undated') undatedIncluded += 1;
      return w !== 'out';
    });

  const nameKey =
    caseRow.companyId !== null
      ? ((await client.query<{ name_key: string }>('SELECT name_key FROM companies WHERE id = $1', [caseRow.companyId])).rows[0]?.name_key ?? '')
      : normalizeName(caseRow.companyNameClaimed ?? '', 'company').key;
  const companyPage = caseRow.companyId !== null ? await loadCompanyFactsPage(client, caseRow.companyId, { preferProjectId: caseRow.projectId }) : null;
  const projectPage = caseRow.projectId !== null ? await loadProjectFactsPage(client, caseRow.projectId) : null;
  const coverage: ICoverage[] = [companyPage?.coverage, projectPage?.coverage].filter((cv): cv is ICoverage => cv !== undefined);
  const companyFacts = applyEffective(companyPage?.facts ?? []);
  const projectFacts = applyEffective(projectPage?.facts ?? []);
  const openQueue = await loadOpenQueue(client, companyFacts.map(f => f.assertionId));
  const dossier = buildCaseDossier({
    caseRow,
    generatedAt: now.toISOString(),
    refresh,
    identityStatus: caseRow.companyId !== null ? await loadIdentityStatus(client, caseRow.companyId, refresh.active?.id ?? null) : null,
    homonyms: nameKey ? await loadHomonyms(client, nameKey, caseRow.companyId) : [],
    companyFacts,
    projectFacts,
    projectState: caseRow.projectId !== null ? await loadProjectState(client, caseRow.projectId) : [],
    openQueue,
    coverage,
  });

  const statements = [
    ...dossier.subject,
    ...dossier.observations,
    ...dossier.role.established,
    ...dossier.role.otherBuildings,
    ...dossier.role.contradictions,
    ...(dossier.role.context ?? []),
    ...dossier.chain.documented,
    ...dossier.chain.subcontracts,
    ...dossier.chain.coParticipants,
    ...(dossier.chain.context ?? []),
    ...dossier.terms.fromSources,
    ...dossier.projectContext.events,
    ...dossier.companyEvents,
  ];
  const assertionIds = [...new Set(statements.flatMap(s => s.assertionIds))].sort((a, b) => a - b);

  const assertions = (
    await client.query<ISnapshotPayload['assertions'][number]>(
      `SELECT a.id, a.version, a.predicate, a.role, a.event_type AS "eventType", a.status::text AS status,
              a.needs_revalidation AS "needsRevalidation", a.polarity, a.modality::text AS modality,
              (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports') AS supports,
              (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'contradicts') AS contradicts
       FROM assertions a WHERE a.id = ANY($1::bigint[]) ORDER BY a.id`,
      [assertionIds],
    )
  ).rows;

  const sourceRows = (
    await client.query<Omit<ISnapshotSource, 'withheldReason' | 'url'> & { url: string | null; accessStatus: PermissionStatus; aiProcessingStatus: PermissionStatus; policyExpiresAt: Date | null }>(
      `SELECT e.id AS "evidenceId", e.assertion_id AS "assertionId", e.stance::text AS stance, e.status, e.quote,
              e.span_start AS "spanStart", e.span_end AS "spanEnd", r.id AS "revisionId", r.revision_no AS "revisionNo",
              si.id AS "sourceItemId", s.id AS "sourceId", s.key AS "sourceKey", s.title AS "sourceTitle",
              coalesce(si.canonical_url, si.original_url) AS url,
              to_char(r.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt",
              r.completeness::text AS completeness,
              s.access_status AS "accessStatus", s.ai_processing_status AS "aiProcessingStatus", s.policy_expires_at AS "policyExpiresAt"
       FROM evidence e
       JOIN document_revisions r ON r.id = e.revision_id
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE e.assertion_id = ANY($1::bigint[]) AND e.status = 'active'
       ORDER BY e.id`,
      [assertionIds],
    )
  ).rows;
  const sources: ISnapshotSource[] = sourceRows.map(({ accessStatus, aiProcessingStatus, policyExpiresAt, url, ...row }) => {
    const decision = evaluateSourcePolicy({ key: row.sourceKey, accessStatus, aiProcessingStatus, policyExpiresAt }, 'collect', now);
    return { ...row, url: safeUrl(url), quote: decision.allowed ? row.quote : null, withheldReason: decision.allowed ? null : decision.reason };
  });
  // Цитаты, недоступные на момент создания, не попадают и в формулировки.
  const withheld = new Set(sources.filter(s => s.quote === null).map(s => s.evidenceId));
  for (const s of statements) s.quotes = s.quotes.filter(q => !withheld.has(q.evidenceId));

  const reviews = (
    await client.query<ISnapshotPayload['reviews'][number]>(
      `SELECT id, assertion_id AS "assertionId", decision::text AS decision, scope, reason, assertion_version AS "assertionVersion",
              to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt"
       FROM review_decisions WHERE assertion_id = ANY($1::bigint[]) AND decided_at <= $2 ORDER BY id`,
      [assertionIds, now],
    )
  ).rows;

  const company =
    caseRow.companyId !== null
      ? (
          await client.query<NonNullable<ISnapshotPayload['company']>>(
            `SELECT c.id, c.name, c.legal_form AS "legalForm", c.entity_type AS "entityType",
                    coalesce((SELECT array_agg(i.identifier_type || ' ' || i.value ORDER BY i.id) FROM entity_identifiers i
                              WHERE i.company_id = c.id AND i.status = 'active'), '{}') AS identifiers
             FROM companies c WHERE c.id = $1`,
            [caseRow.companyId],
          )
        ).rows[0] ?? null
      : null;
  const project =
    caseRow.projectId !== null
      ? (
          await client.query<NonNullable<ISnapshotPayload['project']>>(
            'SELECT id, name, project_level AS level, level_label AS "levelLabel", city FROM projects WHERE id = $1',
            [caseRow.projectId],
          )
        ).rows[0] ?? null
      : null;

  const seeds: NodeKey[] = [
    ...(caseRow.companyId !== null ? [`c:${caseRow.companyId}` as NodeKey] : []),
    ...(caseRow.projectId !== null ? [`p:${caseRow.projectId}` as NodeKey] : []),
  ];
  const graph = seeds.length > 0 ? await buildGraph(seeds, { depth: 1, limit: 40, from, to }, graphLoader(client)) : { nodes: [], edges: [], truncated: false, loaderTruncated: [] as string[], notes: [] };
  for (const reason of graph.loaderTruncated ?? []) coverage.push({ source: `graph_${reason}`, limit: 0, loaded: 0, total: null, truncated: true });

  const limitations = [
    'Снимок фиксирует сведения, известные системе в момент создания; более поздние публикации, решения и слияния в него не попадают.',
    'Цитата подтверждает, что так написано в источнике, а не истинность сообщения. Это не проверка контрагента и не решение о сотрудничестве.',
    ...(from || to ? [`Фильтр дат событий и ролей: ${from ?? '…'} — ${to ?? '…'}. Это не документ, существовавший в прошлом.`] : []),
    ...(withheld.size > 0 ? [`Цитаты не включены из-за допуска источника: ${withheld.size}.`] : []),
    ...(refresh.stale ? [`Сигналы на момент снимка устарели: ${refresh.staleReasons.join('; ')}.`] : []),
    ...coverage.filter(cv => cv.truncated).map(cv => cv.source.startsWith('graph_')
      ? `Загрузка связей для схемы ограничена (${cv.source.slice(6)}): схема неполная, часть связей не просмотрена.`
      : `Выборка ограничена: ${cv.source} — загружено ${cv.loaded} из ${cv.total ?? 'неизвестного числа'}; «других сведений нет» по этому снимку утверждать нельзя.`),
  ];

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    knowledgeCutoff: now.toISOString(),
    effective: {
      from,
      to,
      undatedIncluded,
      excluded,
      note: from || to ? 'Роли и события без даты включены с пометкой; вне периода — исключены. Договоры и корпоративные связи не фильтруются.' : 'Фильтр дат не задан.',
    },
    versions: { template: DOSSIER_TEMPLATE_VERSION, signalsRules: SIGNAL_RULES_VERSION, graph: GRAPH_VERSION, signalsCutoff: refresh.active?.cutoffAt ?? null, signalsStale: refresh.stale },
    case: {
      id: caseRow.id,
      version: caseRow.version,
      title: caseRow.title,
      companyStatus: caseRow.companyStatus,
      companyNameClaimed: caseRow.companyNameClaimed,
      projectNameClaimed: caseRow.projectNameClaimed,
      scopeBuilding: caseRow.scopeBuilding,
      workPackage: caseRow.workPackage,
      workPackageLabel: caseRow.workPackageLabel,
      claimedRole: caseRow.claimedRole,
      claimedClientName: caseRow.claimedClientName,
      claimedTerms: caseRow.claimedTerms,
      requestDate: caseRow.requestDate,
      operatorNote: caseRow.operatorNote,
      status: caseRow.status,
      provenance: caseRow.provenance,
    },
    company,
    claimedClient: caseRow.claimedClientCompanyId !== null ? { id: caseRow.claimedClientCompanyId, name: caseRow.claimedClientCompanyName ?? `#${caseRow.claimedClientCompanyId}` } : null,
    project,
    dossier,
    assertions,
    reviews,
    openQueue,
    sources,
    graph: { nodes: graph.nodes, edges: graph.edges, truncated: graph.truncated, notes: graph.notes },
    selection: { assertionIds, evidenceIds: sources.map(s => s.evidenceId), reviewIds: reviews.map(r => r.id) },
    limitations,
    coverage,
  };
};
