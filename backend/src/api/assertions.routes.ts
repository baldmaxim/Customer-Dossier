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
import { actorOf } from './auth.js';

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
            i.id AS "sourceItemId", s.title AS "sourceTitle", s.key AS "sourceKey", s.kind AS "sourceKind", i.original_url AS "url", r.published_at AS "publishedAt",
            (SELECT c.run_id FROM extraction_chunks c WHERE c.id = e.extraction_chunk_id) AS "runId"
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

// Причина необязательна для любого решения (решение владельца 06.10.2026: приёмка — «Да / Нет»).
// Прежде отклонение, спор и возврат без причины не принимались (этап 08A).
export const reviewSchema = z.object({
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
    res.status(400).json({ error: 'Некорректное решение', code: 'invalid' });
    return;
  }
  try {
    const result = await withTransaction(client =>
      recordReviewDecision(client, { assertionId: id, reviewer: actorOf(req), ...parsed.data }),
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
