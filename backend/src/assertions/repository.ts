// Запись утверждений, доказательств и решений. Все функции — внутри транзакции.
//
// Состояние утверждения (status, needs_revalidation) всегда пересчитывается из
// доказательств и последнего решения; версия растёт при каждом изменении и
// служит оптимистичной блокировкой для двух вкладок одного оператора.

import type { PoolClient } from 'pg';

import {
  assertionContentKey,
  deriveAssertionState,
  evidenceSetHash,
  type EvidenceStance,
  type IAssertionContent,
  type IEvidenceRef,
  type ReviewDecisionValue,
} from './model.js';
import type { IEvidenceSpan } from './span.js';

export class VersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Утверждение изменилось после загрузки (другая вкладка или новое доказательство). Обновите и решите заново.');
    this.name = 'VersionConflictError';
  }
}

export class IdempotencyMismatchError extends Error {
  constructor() {
    super('Ключ идемпотентности уже использован для другого решения');
    this.name = 'IdempotencyMismatchError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} не найдено`);
    this.name = 'NotFoundError';
  }
}

export interface IAssertionRow {
  id: number;
  status: string;
  needs_revalidation: boolean;
  version: number;
}

export const upsertAssertion = async (
  client: PoolClient,
  content: IAssertionContent,
  meta: {
    origin: 'extraction' | 'legacy_import' | 'manual';
    confidenceExtraction: number | null;
    confidenceIdentity: number | null;
    supersedesAssertionId?: number | null;
  },
): Promise<{ id: number; created: boolean }> => {
  const key = assertionContentKey(content);
  const res = await client.query<{ id: number; created: boolean }>(
    `INSERT INTO assertions
       (predicate, role, event_type, subject_company_id, subject_project_id, subject_text,
        object_company_id, object_project_id, object_text, scope_building, work_package,
        valid_from, valid_to, period_precision, modality, value_type, value_numeric, value_currency,
        content_key, supersedes_assertion_id, origin, confidence_extraction, confidence_identity,
        counterparty_company_id, event_discriminator)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::assertion_modality, $16, $17, $18,
             $19, $20, $21, $22, $23, $24, $25)
     ON CONFLICT (content_key) DO UPDATE SET updated_at = assertions.updated_at
     RETURNING id, (xmax = 0) AS created`,
    [
      content.predicate,
      content.role,
      content.eventType,
      content.subjectCompanyId,
      content.subjectProjectId,
      content.subjectText,
      content.objectCompanyId,
      content.objectProjectId,
      content.objectText,
      content.scopeBuilding,
      content.workPackage,
      content.validFrom,
      content.validTo,
      content.periodPrecision,
      content.modality,
      content.valueType,
      content.valueNumeric,
      content.valueCurrency,
      key,
      meta.supersedesAssertionId ?? null,
      meta.origin,
      meta.confidenceExtraction,
      meta.confidenceIdentity,
      content.counterpartyCompanyId,
      content.eventDiscriminator ?? null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error('assertions: upsert не вернул строку');
  return row;
};

const loadEvidenceRefs = async (client: PoolClient, assertionId: number): Promise<IEvidenceRef[]> =>
  (
    await client.query<IEvidenceRef>('SELECT id, stance, status FROM evidence WHERE assertion_id = $1', [assertionId])
  ).rows;

const lockAssertion = async (client: PoolClient, assertionId: number): Promise<IAssertionRow> => {
  const row = (
    await client.query<IAssertionRow>(
      'SELECT id, status, needs_revalidation, version FROM assertions WHERE id = $1 FOR UPDATE',
      [assertionId],
    )
  ).rows[0];
  if (!row) throw new NotFoundError('Утверждение');
  return row;
};

/** Пересчитать состояние из доказательств и последнего решения; версия растёт только при изменении. */
export const refreshAssertionState = async (client: PoolClient, assertionId: number): Promise<IAssertionRow> => {
  const current = await lockAssertion(client, assertionId);
  const evidence = await loadEvidenceRefs(client, assertionId);
  const latest = (
    await client.query<{ decision: ReviewDecisionValue; evidence_set_hash: string }>(
      'SELECT decision, evidence_set_hash FROM review_decisions WHERE assertion_id = $1 ORDER BY id DESC LIMIT 1',
      [assertionId],
    )
  ).rows[0];

  const state = deriveAssertionState(
    evidence,
    latest ? { decision: latest.decision, evidenceSetHash: latest.evidence_set_hash } : null,
  );
  if (state.status === current.status && state.needsRevalidation === current.needs_revalidation) {
    return current;
  }
  const updated = await client.query<IAssertionRow>(
    `UPDATE assertions SET status = $2::assertion_status, needs_revalidation = $3, version = version + 1, updated_at = now()
     WHERE id = $1 RETURNING id, status, needs_revalidation, version`,
    [assertionId, state.status, state.needsRevalidation],
  );
  return updated.rows[0]!;
};

export interface IEvidenceInput {
  assertionId: number;
  revisionId: number;
  stance: EvidenceStance;
  span: IEvidenceSpan;
  origin: 'extraction' | 'legacy_import' | 'manual';
  extractionId: number | null;
  legacyKind: 'mention' | 'event' | 'project_participant' | null;
  legacyId: number | null;
  /** Чанк запуска извлечения (этап 03B): evidence → chunk → run → revision. */
  extractionChunkId?: number | null;
}

/**
 * Новое основание добавляется к утверждению; существующие не заменяются.
 * Та же позиция, замещённая прежним разбором (superseded), снова становится
 * активной; отозванная аналитиком (withdrawn) — нет.
 */
export const addEvidence = async (client: PoolClient, input: IEvidenceInput): Promise<{ id: number; created: boolean }> => {
  await lockAssertion(client, input.assertionId);
  const existing = (
    await client.query<{ id: number; status: string }>(
      `SELECT id, status FROM evidence
       WHERE assertion_id = $1 AND revision_id = $2 AND span_start = $3 AND span_end = $4 AND stance = $5::evidence_stance`,
      [input.assertionId, input.revisionId, input.span.start, input.span.end, input.stance],
    )
  ).rows[0];
  if (existing) {
    if (existing.status === 'superseded') {
      await client.query(
        `UPDATE evidence SET status = 'active', status_reason = NULL, status_changed_at = now() WHERE id = $1`,
        [existing.id],
      );
      await refreshAssertionState(client, input.assertionId);
    }
    return { id: existing.id, created: false };
  }

  const res = await client.query<{ id: number }>(
    `INSERT INTO evidence
       (assertion_id, revision_id, stance, span_start, span_end, quote, context_before, context_after,
        origin, extraction_id, legacy_kind, legacy_id, extraction_chunk_id)
     VALUES ($1, $2, $3::evidence_stance, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      input.assertionId,
      input.revisionId,
      input.stance,
      input.span.start,
      input.span.end,
      input.span.quote,
      input.span.contextBefore,
      input.span.contextAfter,
      input.origin,
      input.extractionId,
      input.legacyKind,
      input.legacyId,
      input.extractionChunkId ?? null,
    ],
  );
  await refreshAssertionState(client, input.assertionId);
  return { id: res.rows[0]!.id, created: true };
};

/** Отзыв основания: строка остаётся, решение аналитика остаётся, утверждение может потребовать пересмотра. */
export const withdrawEvidence = async (
  client: PoolClient,
  input: { evidenceId: number; reason: string; expectedVersion: number },
): Promise<IAssertionRow> => {
  const ev = (
    await client.query<{ assertion_id: number; status: string }>('SELECT assertion_id, status FROM evidence WHERE id = $1', [
      input.evidenceId,
    ])
  ).rows[0];
  if (!ev) throw new NotFoundError('Доказательство');

  const assertion = await lockAssertion(client, ev.assertion_id);
  if (assertion.version !== input.expectedVersion) throw new VersionConflictError(assertion.version);
  if (ev.status === 'withdrawn') return assertion;

  await client.query(
    `UPDATE evidence SET status = 'withdrawn', status_reason = $2, status_changed_at = now() WHERE id = $1`,
    [input.evidenceId, input.reason],
  );
  return refreshAssertionState(client, ev.assertion_id);
};

export interface IReviewInput {
  assertionId: number;
  decision: ReviewDecisionValue;
  scope: 'reflects_source' | 'fact_confirmed';
  reason: string | null;
  reviewer: string;
  expectedVersion: number;
  idempotencyKey: string;
  /** Перенос старого ручного статуса без обоснования. */
  provenanceGap?: boolean;
  legacyKind?: string | null;
  legacyId?: number | null;
}

export interface IReviewResult {
  replayed: boolean;
  decisionId: number;
  assertion: IAssertionRow;
}

/**
 * Новое решение аналитика.
 *  - повтор с тем же ключом и тем же содержанием — прежний результат, без дубля;
 *  - тот же ключ с другим содержанием — ошибка;
 *  - устаревшая версия утверждения — конфликт: вторая вкладка не затирает первую.
 */
export const recordReviewDecision = async (client: PoolClient, input: IReviewInput): Promise<IReviewResult> => {
  const assertion = await lockAssertion(client, input.assertionId);

  const prior = (
    await client.query<{ id: number; assertion_id: number; decision: string; scope: string; reason: string | null }>(
      'SELECT id, assertion_id, decision, scope, reason FROM review_decisions WHERE idempotency_key = $1',
      [input.idempotencyKey],
    )
  ).rows[0];
  if (prior) {
    const same =
      prior.assertion_id === input.assertionId &&
      prior.decision === input.decision &&
      prior.scope === input.scope &&
      (prior.reason ?? null) === (input.reason ?? null);
    if (!same) throw new IdempotencyMismatchError();
    return { replayed: true, decisionId: prior.id, assertion };
  }

  if (assertion.version !== input.expectedVersion) throw new VersionConflictError(assertion.version);

  const hash = evidenceSetHash(await loadEvidenceRefs(client, input.assertionId));
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO review_decisions
       (assertion_id, decision, scope, reviewer, reason, assertion_version, evidence_set_hash, idempotency_key,
        provenance_gap, legacy_kind, legacy_id)
     VALUES ($1, $2::assertion_status, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.assertionId,
      input.decision,
      input.scope,
      input.reviewer,
      input.reason,
      assertion.version,
      hash,
      input.idempotencyKey,
      input.provenanceGap ?? false,
      input.legacyKind ?? null,
      input.legacyId ?? null,
    ],
  );

  // Решение — всегда событие состояния: версия растёт, даже если статус совпал.
  await client.query('UPDATE assertions SET version = version + 1, updated_at = now() WHERE id = $1', [input.assertionId]);
  const refreshed = await refreshAssertionState(client, input.assertionId);
  return { replayed: false, decisionId: inserted.rows[0]!.id, assertion: refreshed };
};
