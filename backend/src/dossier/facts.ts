// Опубликованные утверждения с доказательствами для досье (этап 08A). Только чтение базы: модель не вызывается,
// досье строится из уже собранного и опубликованного — работает при выключенной LM Studio и без сети.

import type { DbExecutor } from '../db/pool.js';

export interface IFactEvidence {
  id: number;
  stance: 'supports' | 'contradicts' | 'mentions';
  quote: string;
  revisionId: number;
  sourceItemId: number;
  sourceTitle: string;
  publishedAt: string | null;
  dedupHash: string;
  /** Этап 17: у публикации есть более новая редакция, чем та, на которой основано доказательство. */
  pendingRevision?: boolean;
}

/**
 * Решение аналитика по исходному утверждению, которое слияние сущностей перенесло в это (evidence.copied_from_evidence_id,
 * merge_id). Решение не переносится и не меняет статус: оно показывается как история того же утверждения, требующая пересмотра.
 */
export interface IPriorDecision {
  assertionId: number;
  mergeId: number;
  decisionId: number;
  decision: string;
  reviewer: string;
  decidedAt: string;
}

export interface IFact {
  assertionId: number;
  version: number;
  predicate: string;
  role: string | null;
  eventType: string | null;
  status: string;
  origin: string;
  needsRevalidation: boolean;
  polarity: 'positive' | 'negative';
  modality: string;
  subjectCompanyId: number | null;
  subjectCompanyName: string | null;
  subjectProjectId: number | null;
  objectCompanyId: number | null;
  objectCompanyName: string | null;
  objectProjectId: number | null;
  objectProjectName: string | null;
  counterpartyCompanyId: number | null;
  counterpartyCompanyName: string | null;
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
  attributedTo: string | null;
  evidence: IFactEvidence[];
  /** Решения по утверждениям, из которых это перенесено слиянием (не отменённым). Пусто — переноса не было. */
  priorDecisions: IPriorDecision[];
}

const COLUMNS = `
  a.id AS "assertionId", a.version, a.predicate, a.role, a.event_type AS "eventType", a.status::text AS status, a.origin,
  a.needs_revalidation AS "needsRevalidation", a.polarity, a.modality::text AS modality,
  a.subject_company_id AS "subjectCompanyId", sc.name AS "subjectCompanyName", a.subject_project_id AS "subjectProjectId",
  a.object_company_id AS "objectCompanyId", oc.name AS "objectCompanyName",
  a.object_project_id AS "objectProjectId", op.name AS "objectProjectName",
  a.counterparty_company_id AS "counterpartyCompanyId", cc.name AS "counterpartyCompanyName",
  a.context_project_id AS "contextProjectId", a.scope_building AS "scopeBuilding", a.work_package AS "workPackage",
  a.work_package_label AS "workPackageLabel", a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo",
  a.period_precision AS "periodPrecision", a.case_number AS "caseNumber", a.procedural_role AS "proceduralRole",
  a.counterparty_role AS "counterpartyRole", a.event_stage AS "eventStage", a.event_outcome AS "eventOutcome",
  a.value_type AS "valueType", a.value_numeric::text AS "valueNumeric", a.value_currency AS "valueCurrency",
  a.attributed_to AS "attributedTo"`;

const FROM = `
  FROM assertions a
  LEFT JOIN companies sc ON sc.id = a.subject_company_id
  LEFT JOIN companies oc ON oc.id = a.object_company_id
  LEFT JOIN projects op ON op.id = a.object_project_id
  LEFT JOIN companies cc ON cc.id = a.counterparty_company_id`;

/** Утверждения по фильтру и их активные доказательства. Без активной поддержки утверждение в досье не попадает. */
/**
 * Покрытие выборки (coverage@1, этап 13): сколько загружено, есть ли ещё и сколько всего, если известно.
 * Ограниченная выборка не может утверждать «других сведений нет».
 */
export interface ICoverage {
  source: string;
  limit: number;
  loaded: number;
  /** Известное общее число; null — неизвестно (не подменяется числом загруженных). */
  total: number | null;
  truncated: boolean;
}

export const COVERAGE_VERSION = 'coverage@1';

/** Предел выборки фактов досье. Не снимается: при превышении выборка помечается неполной. */
export const FACTS_LIMIT = 1000;

export const coverageOf = (source: string, limit: number, fetched: number, total: number | null): ICoverage => ({
  source,
  limit,
  loaded: Math.min(fetched, limit),
  total: fetched > limit ? total : Math.min(fetched, limit),
  truncated: fetched > limit,
});

export interface IFactPage {
  facts: IFact[];
  coverage: ICoverage;
}

const loadFactsPage = async (
  exec: DbExecutor,
  source: string,
  where: string,
  params: unknown[],
  options: { preferProjectId?: number | null; limit?: number } = {},
): Promise<IFactPage> => {
  const limit = options.limit ?? FACTS_LIMIT;
  const scopeFilter = `(${where})
         AND a.predicate IN ('participates_in_project', 'contract', 'corporate_relation', 'event')
         AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')`;
  const preferIndex = params.length + 1;
  // Сначала сведения по объекту обращения, затем новые: при усечении теряется дальний фон, а не предмет обращения.
  const rows = (
    await exec.query<Omit<IFact, 'evidence' | 'priorDecisions'>>(
      `SELECT ${COLUMNS} ${FROM}
       WHERE ${scopeFilter}
       ORDER BY ($${preferIndex}::bigint IS NOT NULL AND $${preferIndex}::bigint IN (a.object_project_id, a.subject_project_id, a.context_project_id)) DESC,
                a.id DESC
       LIMIT ${limit + 1}`,
      [...params, options.preferProjectId ?? null],
    )
  ).rows;
  const total =
    rows.length > limit
      ? (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM assertions a WHERE ${scopeFilter}`, params)).rows[0]!.n
      : null;
  const facts = await withEvidence(exec, rows.slice(0, limit));
  return { facts: facts.sort((a, b) => a.assertionId - b.assertionId), coverage: coverageOf(source, limit, rows.length, total) };
};

const withEvidence = async (exec: DbExecutor, rows: Array<Omit<IFact, 'evidence' | 'priorDecisions'>>): Promise<IFact[]> => {
  if (rows.length === 0) return [];
  const evidence = (
    await exec.query<IFactEvidence & { assertionId: number }>(
      `SELECT e.assertion_id AS "assertionId", e.id, e.stance::text AS stance, e.quote, e.revision_id AS "revisionId",
              r.source_item_id AS "sourceItemId", s.title AS "sourceTitle",
              to_char(r.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt",
              encode(r.dedup_hash, 'hex') AS "dedupHash",
              coalesce(si.latest_revision_id IS DISTINCT FROM r.id AND si.latest_revision_id IS NOT NULL, false) AS "pendingRevision"
       FROM evidence e
       JOIN document_revisions r ON r.id = e.revision_id
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE e.assertion_id = ANY($1::bigint[]) AND e.status = 'active'
       ORDER BY e.id`,
      [rows.map(r => r.assertionId)],
    )
  ).rows;
  const prior = await loadPriorDecisions(exec, rows.map(r => r.assertionId));
  return rows.map(r => ({
    ...r,
    evidence: evidence.filter(e => e.assertionId === r.assertionId).map(({ assertionId: _a, ...e }) => e),
    priorDecisions: prior.filter(d => d.forAssertionId === r.assertionId).map(({ forAssertionId: _f, ...d }) => d),
  }));
};

/**
 * Линия слияний: активное доказательство утверждения скопировано слиянием из доказательства исходного утверждения;
 * рекурсивно — через несколько слияний. Отменённые слияния не учитываются. Только чтение.
 */
export const loadPriorDecisions = async (exec: DbExecutor, assertionIds: readonly number[]): Promise<Array<IPriorDecision & { forAssertionId: number }>> =>
  assertionIds.length === 0
    ? []
    : (
        await exec.query<IPriorDecision & { forAssertionId: number }>(
          `WITH RECURSIVE lineage (for_id, assertion_id, merge_id, depth) AS (
             SELECT DISTINCT e.assertion_id, src.assertion_id, e.merge_id, 1
             FROM evidence e
             JOIN evidence src ON src.id = e.copied_from_evidence_id
             JOIN entity_merges m ON m.id = e.merge_id AND m.undone_at IS NULL
             WHERE e.assertion_id = ANY($1::bigint[]) AND e.status = 'active' AND e.merge_id IS NOT NULL
             UNION
             SELECT l.for_id, src.assertion_id, e.merge_id, l.depth + 1
             FROM lineage l
             JOIN evidence e ON e.assertion_id = l.assertion_id AND e.merge_id IS NOT NULL
             JOIN evidence src ON src.id = e.copied_from_evidence_id
             JOIN entity_merges m ON m.id = e.merge_id AND m.undone_at IS NULL
             WHERE l.depth < 10
           )
           -- Этап 15A: одно решение, достижимое несколькими путями (цепочка слияний), показывается один раз —
           -- по ближайшему слиянию; вес не удваивается. Разные решения остаются отдельными строками.
           SELECT DISTINCT ON (l.for_id, d.id) l.for_id AS "forAssertionId", l.assertion_id AS "assertionId", l.merge_id AS "mergeId",
                  d.id AS "decisionId", d.decision, d.reviewer,
                  to_char(d.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "decidedAt"
           FROM lineage l JOIN review_decisions d ON d.assertion_id = l.assertion_id
           WHERE l.assertion_id <> l.for_id
           ORDER BY l.for_id, d.id, l.depth, l.merge_id`,
          [[...assertionIds]],
        )
      ).rows;

/** Утверждения компании и их активные доказательства. Без активной поддержки утверждение в досье не попадает. */
export const loadCompanyFactsPage = (exec: DbExecutor, companyId: number, options: { preferProjectId?: number | null; limit?: number } = {}): Promise<IFactPage> =>
  loadFactsPage(exec, 'company_facts', '$1 IN (a.subject_company_id, a.object_company_id, a.counterparty_company_id)', [companyId], options);

export const loadProjectFactsPage = (exec: DbExecutor, projectId: number, options: { limit?: number } = {}): Promise<IFactPage> =>
  loadFactsPage(exec, 'project_facts', '$1 IN (a.object_project_id, a.subject_project_id, a.context_project_id)', [projectId], { ...options, preferProjectId: projectId });

export const loadCompanyFacts = async (exec: DbExecutor, companyId: number): Promise<IFact[]> => (await loadCompanyFactsPage(exec, companyId)).facts;

export const loadProjectFacts = async (exec: DbExecutor, projectId: number): Promise<IFact[]> => (await loadProjectFactsPage(exec, projectId)).facts;

/** Одноимённые живые компании: ключ имени тот же, что у резолвера. Для выбора, а не для подстановки. */
export const loadHomonyms = async (
  exec: DbExecutor,
  nameKey: string,
  excludeId: number | null,
): Promise<Array<{ id: number; name: string; entityType: string; legalForm: string | null; city: string | null; identifiers: string[] }>> =>
  (
    await exec.query<{ id: number; name: string; entityType: string; legalForm: string | null; city: string | null; identifiers: string[] }>(
      `SELECT c.id, c.name, c.entity_type AS "entityType", c.legal_form AS "legalForm", c.city,
              coalesce((SELECT array_agg(i.identifier_type || ' ' || i.value ORDER BY i.id) FROM entity_identifiers i
                        WHERE i.company_id = c.id AND i.status = 'active'), '{}') AS identifiers
       FROM companies c
       WHERE c.merged_into_id IS NULL AND c.name_key = $1 AND ($2::bigint IS NULL OR c.id <> $2::bigint)
       ORDER BY c.id LIMIT 20`,
      [nameKey, excludeId],
    )
  ).rows;

export const loadOpenQueue = async (exec: DbExecutor, assertionIds: readonly number[]): Promise<Array<{ kind: string; assertionId: number; priority: number }>> =>
  assertionIds.length === 0
    ? []
    : (
        await exec.query<{ kind: string; assertionId: number; priority: number }>(
          `SELECT kind, assertion_id AS "assertionId", priority FROM review_queue_v WHERE assertion_id = ANY($1::bigint[]) ORDER BY priority, assertion_id`,
          [[...assertionIds]],
        )
      ).rows;
