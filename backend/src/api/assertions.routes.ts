// Утверждения: чтение с поддерживающими и опровергающими доказательствами,
// история решений, новое решение и отзыв доказательства.
// Доступ — после входа оператора; изменяющие запросы — с CSRF (app.ts).

import { z } from 'zod';

import { query, queryOne, withTransaction } from '../db/pool.js';
import { ASSERTION_STATUSES, PREDICATES, REVIEW_DECISIONS } from '../assertions/model.js';
import {
  IdempotencyMismatchError,
  NotFoundError,
  VersionConflictError,
  recordReviewDecision,
  withdrawEvidence,
} from '../assertions/repository.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const assertionsRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const ASSERTION_COLUMNS = `
  a.id, a.predicate, a.role, a.event_type AS "eventType",
  a.subject_company_id AS "subjectCompanyId", sc.name AS "subjectCompanyName",
  a.subject_project_id AS "subjectProjectId", sp.name AS "subjectProjectName", a.subject_text AS "subjectText",
  a.object_company_id AS "objectCompanyId", oc.name AS "objectCompanyName",
  a.object_project_id AS "objectProjectId", op.name AS "objectProjectName", a.object_text AS "objectText",
  a.counterparty_company_id AS "counterpartyCompanyId", cc.name AS "counterpartyCompanyName",
  a.context_project_id AS "contextProjectId", xp.name AS "contextProjectName",
  a.polarity, a.work_package_label AS "workPackageLabel", a.attributed_to AS "attributedTo",
  a.case_number AS "caseNumber", a.procedural_role AS "proceduralRole", a.counterparty_role AS "counterpartyRole",
  a.event_stage AS "eventStage", a.event_outcome AS "eventOutcome", a.tax_basis AS "taxBasis",
  a.scope_building AS "scopeBuilding", a.work_package AS "workPackage",
  a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo", a.period_precision AS "periodPrecision",
  a.modality, a.value_type AS "valueType", a.value_numeric::text AS "valueNumeric", a.value_currency AS "valueCurrency",
  a.status, a.needs_revalidation AS "needsRevalidation", a.version,
  a.confidence_extraction AS "confidenceExtraction", a.confidence_identity AS "confidenceIdentity",
  a.supersedes_assertion_id AS "supersedesAssertionId", a.origin, a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports') AS "supportsCount",
  (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'contradicts') AS "contradictsCount"
`;

const ASSERTION_FROM = `
  FROM assertions a
  LEFT JOIN companies sc ON sc.id = a.subject_company_id
  LEFT JOIN projects sp ON sp.id = a.subject_project_id
  LEFT JOIN companies oc ON oc.id = a.object_company_id
  LEFT JOIN projects op ON op.id = a.object_project_id
  LEFT JOIN companies cc ON cc.id = a.counterparty_company_id
  LEFT JOIN projects xp ON xp.id = a.context_project_id
`;

const listSchema = z.object({
  status: z.enum(ASSERTION_STATUSES).optional(),
  needsRevalidation: z.enum(['true', 'false']).optional(),
  predicate: z.enum(PREDICATES).optional(),
  companyId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  // Keyset: утверждения с id меньше указанного.
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

assertionsRouter.get('/assertions', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const f = parsed.data;
  const items = await query(
    `SELECT ${ASSERTION_COLUMNS} ${ASSERTION_FROM}
     WHERE ($1::assertion_status IS NULL OR a.status = $1::assertion_status)
       AND ($2::boolean IS NULL OR a.needs_revalidation = $2::boolean)
       AND ($3::text IS NULL OR a.predicate = $3::text)
       AND ($4::bigint IS NULL OR $4::bigint IN (a.subject_company_id, a.object_company_id, a.counterparty_company_id))
       AND ($5::bigint IS NULL OR $5::bigint IN (a.subject_project_id, a.object_project_id, a.context_project_id))
       AND ($6::bigint IS NULL OR a.id < $6::bigint)
     ORDER BY a.id DESC
     LIMIT $7`,
    [
      f.status ?? null,
      f.needsRevalidation === undefined ? null : f.needsRevalidation === 'true',
      f.predicate ?? null,
      f.companyId ?? null,
      f.projectId ?? null,
      f.before ?? null,
      f.limit,
    ],
  );
  res.json({ items });
});

// Очередь проверки по приоритету (этап 06): идентичность, конфликт ролей и периодов, исправление, оспаривание.
const queueSchema = z.object({
  kind: z.enum(['identity', 'polarity_conflict', 'role_period_conflict', 'correction', 'dispute']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

assertionsRouter.get('/review-queue', async (req, res) => {
  const parsed = queueSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const items = await query(
    `SELECT priority, kind, ref_id AS "refId", assertion_id AS "assertionId", detail, since
     FROM review_queue_v
     WHERE ($1::text IS NULL OR kind = $1::text)
     ORDER BY priority, since DESC, ref_id DESC
     LIMIT $2`,
    [parsed.data.kind ?? null, parsed.data.limit],
  );
  res.json({ items });
});

// История состояния объекта в действительном времени и текущее состояние по корпусам.
assertionsRouter.get('/projects/:id/state-history', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const history = await query(
    `SELECT scope_building AS "scopeBuilding", state, valid_from::text AS "validFrom", valid_to::text AS "validTo",
            period_precision AS "periodPrecision", assertion_id AS "assertionId", recorded_at AS "recordedAt"
     FROM project_state_history_v WHERE project_id = $1
     ORDER BY coalesce(scope_building, ''), valid_from, recorded_at`,
    [id],
  );
  const current = await query(
    `SELECT scope_building AS "scopeBuilding", state, valid_from::text AS "validFrom", period_precision AS "periodPrecision",
            assertion_id AS "assertionId"
     FROM project_current_state_v WHERE project_id = $1`,
    [id],
  );
  res.json({ history, current });
});

// Судебные и банкротные события компании: стадии одного дела сгруппированы по номеру.
assertionsRouter.get('/companies/:id/legal-cases', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const rows = await query<{ caseKey: string }>(
    `SELECT case_key AS "caseKey", assertion_id AS "assertionId", event_type AS "eventType",
            subject_company_id AS "subjectCompanyId", procedural_role AS "proceduralRole",
            counterparty_company_id AS "counterpartyCompanyId", counterparty_role AS "counterpartyRole",
            case_number AS "caseNumber", event_stage AS "eventStage", event_outcome AS "eventOutcome",
            valid_from::text AS "validFrom", period_precision AS "periodPrecision",
            value_type AS "valueType", value_numeric::text AS "valueNumeric", value_currency AS "valueCurrency",
            tax_basis AS "taxBasis", modality, status
     FROM legal_case_events_v
     WHERE subject_company_id = $1 OR counterparty_company_id = $1
     ORDER BY case_key, valid_from NULLS FIRST, assertion_id
     LIMIT 500`,
    [id],
  );
  const cases = new Map<string, typeof rows>();
  for (const row of rows) cases.set(row.caseKey, [...(cases.get(row.caseKey) ?? []), row]);
  res.json({ cases: [...cases.entries()].map(([caseKey, stages]) => ({ caseKey, stages })) });
});

assertionsRouter.get('/assertions/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const assertion = await queryOne<{ version: number }>(`SELECT ${ASSERTION_COLUMNS} ${ASSERTION_FROM} WHERE a.id = $1`, [id]);
  if (!assertion) {
    res.status(404).json({ error: 'Утверждение не найдено' });
    return;
  }
  const evidence = await query(
    `SELECT e.id, e.stance, e.status, e.status_reason AS "statusReason", e.status_changed_at AS "statusChangedAt",
            e.quote, e.context_before AS "contextBefore", e.context_after AS "contextAfter",
            e.span_start AS "spanStart", e.span_end AS "spanEnd", e.origin, e.created_at AS "createdAt",
            r.id AS "revisionId", r.revision_no AS "revisionNo", r.completeness, r.legacy_document_id AS "legacyDocumentId",
            i.id AS "sourceItemId", s.title AS "sourceTitle", i.original_url AS "url", r.published_at AS "publishedAt"
     FROM evidence e
     JOIN document_revisions r ON r.id = e.revision_id
     JOIN source_items i ON i.id = r.source_item_id
     JOIN sources s ON s.id = i.source_id
     WHERE e.assertion_id = $1
     ORDER BY e.stance, e.id
     LIMIT 500`,
    [id],
  );
  const reviews = await query(
    `SELECT id, decision, scope, reviewer, reason, assertion_version AS "assertionVersion",
            evidence_set_hash AS "evidenceSetHash", provenance_gap AS "provenanceGap", decided_at AS "decidedAt"
     FROM review_decisions WHERE assertion_id = $1 ORDER BY id DESC LIMIT 200`,
    [id],
  );
  res.setHeader('ETag', `"v${assertion.version}"`);
  res.json({ assertion, evidence, reviews });
});

const reviewSchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  scope: z.enum(['reflects_source', 'fact_confirmed']).default('reflects_source'),
  reason: z.string().trim().max(2000).nullish().transform(v => (v ? v : null)),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
});

const sendDomainError = (res: import('express').Response, err: unknown): boolean => {
  if (err instanceof VersionConflictError) {
    res.status(409).json({ error: err.message, code: 'version_conflict', currentVersion: err.currentVersion });
    return true;
  }
  if (err instanceof IdempotencyMismatchError) {
    res.status(422).json({ error: err.message, code: 'idempotency_mismatch' });
    return true;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
};

assertionsRouter.post('/assertions/:id/reviews', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = reviewSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректное решение' });
    return;
  }
  try {
    const result = await withTransaction(client =>
      recordReviewDecision(client, { assertionId: id, reviewer: 'operator', ...parsed.data }),
    );
    res.setHeader('ETag', `"v${result.assertion.version}"`);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (!sendDomainError(res, err)) throw err;
  }
});

const withdrawSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  expectedVersion: z.number().int().positive(),
});

assertionsRouter.post('/evidence/:id/withdraw', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = withdrawSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите причину отзыва и версию утверждения' });
    return;
  }
  try {
    const assertion = await withTransaction(client => withdrawEvidence(client, { evidenceId: id, ...parsed.data }));
    res.setHeader('ETag', `"v${assertion.version}"`);
    res.json({ assertion });
  } catch (err) {
    if (!sendDomainError(res, err)) throw err;
  }
});
