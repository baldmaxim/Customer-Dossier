// Backfill: legacy mentions / events / project_participants → утверждения и доказательства.
//
// Правила этапа 03A:
//  - утверждение переносится только с реально найденным доказательством:
//    цитата legacy-строки должна однозначно находиться в тексте редакции
//    (этап 02). Первое из нескольких совпадений не берётся, фиктивные цитаты
//    из названия компании не создаются;
//  - автоматический статус не становится reviewed_supported;
//  - ручные статусы событий (confirmed / rejected) переносятся решением с
//    reviewer = legacy_unknown и provenance_gap = true — даже если доказательство
//    не нашлось, статус не теряется;
//  - канонические ID сохраняются, legacy-строки не меняются;
//  - dry-run — транзакция с откатом; повтор — без дублей (уникальности + явные проверки);
//  - checkpoint по каждому виду legacy-строк.

import type { Pool, PoolClient } from 'pg';

import type { IAssertionContent } from './model.js';
import { addEvidence, recordReviewDecision, upsertAssertion } from './repository.js';
import { locateQuote, type IEvidenceSpan } from './span.js';

type LegacyKind = 'project_participant' | 'mention' | 'event';

export interface IKindReport {
  scanned: number;
  assertionsCreated: number;
  assertionsReused: number;
  evidenceCreated: number;
  evidenceExisting: number;
  noEvidenceDocument: number;
  noRevision: number;
  quoteNotFound: number;
  quoteAmbiguous: number;
  manualStatusesMigrated: number;
  manualStatusesExisting: number;
  manualWithoutEvidence: number;
}

export interface IAssertionBackfillReport {
  dryRun: boolean;
  kinds: Record<LegacyKind, IKindReport>;
  checkpoints: Record<string, number>;
}

export interface IAssertionBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  fromStart?: boolean;
}

const emptyKind = (): IKindReport => ({
  scanned: 0,
  assertionsCreated: 0,
  assertionsReused: 0,
  evidenceCreated: 0,
  evidenceExisting: 0,
  noEvidenceDocument: 0,
  noRevision: 0,
  quoteNotFound: 0,
  quoteAmbiguous: 0,
  manualStatusesMigrated: 0,
  manualStatusesExisting: 0,
  manualWithoutEvidence: 0,
});

const baseContent = (): Omit<IAssertionContent, 'predicate'> => ({
  role: null,
  eventType: null,
  subjectCompanyId: null,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: null,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  // Модальность старого извлечения не записывалась — неизвестна.
  modality: 'unknown',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
});

/**
 * Редакция с тем же текстом, что у legacy-документа. Предпочтение — публикации
 * того же источника; перепечатки с тем же текстом равноценны по содержанию.
 */
const findRevision = async (client: PoolClient, documentId: number): Promise<{ id: number; body: string } | null> =>
  (
    await client.query<{ id: number; body: string }>(
      `SELECT r.id, r.body
       FROM document_revisions r
       JOIN source_items i ON i.id = r.source_item_id
       JOIN raw_documents d ON d.id = r.legacy_document_id
       WHERE r.legacy_document_id = $1 AND r.body = d.body
       ORDER BY (i.source_id = d.source_id) DESC, r.id
       LIMIT 1`,
      [documentId],
    )
  ).rows[0] ?? null;

type Located = { kind: 'ok'; revisionId: number; span: IEvidenceSpan } | { kind: 'no_revision' | 'not_found' | 'ambiguous' };

const locate = async (client: PoolClient, documentId: number, quote: string): Promise<Located> => {
  const revision = await findRevision(client, documentId);
  if (!revision) return { kind: 'no_revision' };
  const location = locateQuote(revision.body, quote);
  if (location.kind === 'unique') return { kind: 'ok', revisionId: revision.id, span: location.span };
  return { kind: location.kind === 'ambiguous' ? 'ambiguous' : 'not_found' };
};

const countLocation = (report: IKindReport, located: Located): void => {
  if (located.kind === 'no_revision') report.noRevision += 1;
  else if (located.kind === 'not_found') report.quoteNotFound += 1;
  else if (located.kind === 'ambiguous') report.quoteAmbiguous += 1;
};

const attach = async (
  client: PoolClient,
  report: IKindReport,
  content: IAssertionContent,
  confidence: number | null,
  evidence: Array<{ located: Located; extractionId: number | null }>,
  legacy: { kind: LegacyKind; id: number },
): Promise<number | null> => {
  const found = evidence.filter((e): e is { located: Extract<Located, { kind: 'ok' }>; extractionId: number | null } =>
    e.located.kind === 'ok',
  );
  for (const e of evidence) countLocation(report, e.located);
  if (found.length === 0) return null;

  const assertion = await upsertAssertion(client, content, {
    origin: 'legacy_import',
    confidenceExtraction: confidence,
    // Сопоставление сущностей legacy-резолвером отдельной оценки не имело.
    confidenceIdentity: null,
  });
  if (assertion.created) report.assertionsCreated += 1;
  else report.assertionsReused += 1;

  for (const e of found) {
    const added = await addEvidence(client, {
      assertionId: assertion.id,
      revisionId: e.located.revisionId,
      stance: 'supports',
      span: e.located.span,
      origin: 'legacy_import',
      extractionId: e.extractionId,
      legacyKind: legacy.kind,
      legacyId: legacy.id,
    });
    if (added.created) report.evidenceCreated += 1;
    else report.evidenceExisting += 1;
  }
  return assertion.id;
};

interface IParticipantRow {
  id: number;
  company_id: number;
  project_id: number;
  role: string;
  started_on: string | null;
  ended_on: string | null;
  confidence: number;
  evidence_document_id: number | null;
}

const importParticipant = async (client: PoolClient, row: IParticipantRow, report: IKindReport): Promise<void> => {
  if (row.evidence_document_id === null) {
    report.noEvidenceDocument += 1;
    return;
  }
  // У роли своей цитаты не было: основание — упоминания той же компании с той же ролью в том же документе.
  const quotes = (
    await client.query<{ quote: string; extraction_id: number | null }>(
      `SELECT DISTINCT quote, extraction_id FROM mentions
       WHERE document_id = $1 AND entity_kind = 'company' AND entity_id = $2 AND role = $3`,
      [row.evidence_document_id, row.company_id, row.role],
    )
  ).rows;
  if (quotes.length === 0) {
    report.quoteNotFound += 1;
    return;
  }
  const evidence = [];
  for (const q of quotes) {
    evidence.push({ located: await locate(client, row.evidence_document_id, q.quote), extractionId: q.extraction_id });
  }
  const dated = row.started_on !== null || row.ended_on !== null;
  await attach(
    client,
    report,
    {
      ...baseContent(),
      predicate: 'participates_in_project',
      role: row.role,
      subjectCompanyId: row.company_id,
      objectProjectId: row.project_id,
      validFrom: row.started_on,
      validTo: row.ended_on,
      periodPrecision: dated ? 'day' : 'unknown',
    },
    row.confidence,
    evidence,
    { kind: 'project_participant', id: row.id },
  );
};

interface IMentionRow {
  id: number;
  document_id: number;
  extraction_id: number | null;
  entity_kind: 'company' | 'project';
  entity_id: number;
  quote: string;
  confidence: number;
}

const importMention = async (client: PoolClient, row: IMentionRow, report: IKindReport): Promise<void> => {
  const located = await locate(client, row.document_id, row.quote);
  await attach(
    client,
    report,
    row.entity_kind === 'company'
      ? { ...baseContent(), predicate: 'company_mentioned', subjectCompanyId: row.entity_id }
      : { ...baseContent(), predicate: 'project_mentioned', subjectProjectId: row.entity_id },
    row.confidence,
    [{ located, extractionId: row.extraction_id }],
    { kind: 'mention', id: row.id },
  );
};

interface IEventRow {
  id: number;
  type: string;
  occurred_on: string | null;
  project_id: number | null;
  company_id: number | null;
  counterparty_id: number | null;
  amount_rub: string | null;
  document_id: number;
  extraction_id: number | null;
  quote: string;
  confidence: number;
  status: 'auto' | 'confirmed' | 'rejected';
}

const MANUAL_DECISION: Record<'confirmed' | 'rejected', 'reviewed_supported' | 'rejected'> = {
  confirmed: 'reviewed_supported',
  rejected: 'rejected',
};

const importEvent = async (client: PoolClient, row: IEventRow, report: IKindReport): Promise<void> => {
  if (row.company_id === null && row.project_id === null) {
    report.noEvidenceDocument += 1;
    return;
  }
  const content: IAssertionContent = {
    ...baseContent(),
    predicate: 'event',
    eventType: row.type,
    subjectCompanyId: row.company_id,
    subjectProjectId: row.company_id === null ? row.project_id : null,
    objectProjectId: row.company_id === null ? null : row.project_id,
    counterpartyCompanyId: row.counterparty_id,
    validFrom: row.occurred_on,
    validTo: row.occurred_on,
    periodPrecision: row.occurred_on ? 'day' : 'unknown',
    valueType: row.amount_rub !== null ? 'amount' : null,
    valueNumeric: row.amount_rub,
    valueCurrency: row.amount_rub !== null ? 'RUB' : null,
  };

  const located = await locate(client, row.document_id, row.quote);
  let assertionId = await attach(client, report, content, row.confidence, [{ located, extractionId: row.extraction_id }], {
    kind: 'event',
    id: row.id,
  });

  if (row.status === 'auto') return;

  // Ручной статус переносится всегда: без доказательства — утверждение-кандидат
  // и решение с provenance_gap, статус не теряется.
  if (assertionId === null) {
    const created = await upsertAssertion(client, content, {
      origin: 'legacy_import',
      confidenceExtraction: row.confidence,
      confidenceIdentity: null,
    });
    assertionId = created.id;
    if (created.created) report.assertionsCreated += 1;
    report.manualWithoutEvidence += 1;
  }

  const existing = await client.query('SELECT 1 FROM review_decisions WHERE legacy_kind = $1 AND legacy_id = $2', [
    'event',
    row.id,
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    report.manualStatusesExisting += 1;
    return;
  }

  const current = (await client.query<{ version: number }>('SELECT version FROM assertions WHERE id = $1', [assertionId]))
    .rows[0]!;
  // Кто и почему ставил статус, неизвестно: reviewer = legacy_unknown, а не текущий оператор.
  await recordReviewDecision(client, {
    assertionId,
    decision: MANUAL_DECISION[row.status],
    scope: 'reflects_source',
    reason: null,
    reviewer: 'legacy_unknown',
    expectedVersion: current.version,
    idempotencyKey: `legacy:event:${row.id}`,
    provenanceGap: true,
    legacyKind: 'event',
    legacyId: row.id,
  });
  report.manualStatusesMigrated += 1;
};

interface IPass<T> {
  kind: LegacyKind;
  sql: string;
  run: (client: PoolClient, row: T, report: IKindReport) => Promise<void>;
}

const PASSES: Array<IPass<never>> = [
  {
    kind: 'project_participant',
    sql: `SELECT id, company_id, project_id, role, started_on::text, ended_on::text, confidence, evidence_document_id
          FROM project_participants WHERE id > $1 ORDER BY id LIMIT $2`,
    run: importParticipant as IPass<never>['run'],
  },
  {
    kind: 'mention',
    sql: `SELECT id, document_id, extraction_id, entity_kind, entity_id, quote, confidence
          FROM mentions WHERE id > $1 ORDER BY id LIMIT $2`,
    run: importMention as IPass<never>['run'],
  },
  {
    kind: 'event',
    sql: `SELECT id, type, occurred_on::text, project_id, company_id, counterparty_id, amount_rub::text, document_id,
                 extraction_id, quote, confidence, status
          FROM events WHERE id > $1 ORDER BY id LIMIT $2`,
    run: importEvent as IPass<never>['run'],
  },
];

class DryRunRollback extends Error {}

export const runLegacyAssertionBackfill = async (
  pool: Pool,
  options: IAssertionBackfillOptions,
): Promise<IAssertionBackfillReport> => {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 5000) {
    throw new Error('batchSize: от 1 до 5000');
  }
  const report: IAssertionBackfillReport = {
    dryRun: options.dryRun,
    kinds: { project_participant: emptyKind(), mention: emptyKind(), event: emptyKind() },
    checkpoints: {},
  };

  for (const pass of PASSES) {
    const checkpointName = `assertions_legacy_${pass.kind}`;
    let cursor: number | null = null;
    for (;;) {
      const client = await pool.connect();
      let processed = 0;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [checkpointName]);
        const start: number =
          cursor ??
          (options.fromStart
            ? 0
            : ((await client.query<{ last_id: number }>('SELECT last_id FROM backfill_checkpoints WHERE name = $1', [
                checkpointName,
              ])).rows[0]?.last_id ?? 0));
        const rows = (await client.query<{ id: number }>(pass.sql, [start, options.batchSize])).rows;
        processed = rows.length;
        for (const row of rows) {
          await pass.run(client, row as never, report.kinds[pass.kind]);
          report.kinds[pass.kind].scanned += 1;
        }
        const last = rows[rows.length - 1];
        cursor = last ? last.id : start;
        report.checkpoints[checkpointName] = cursor;
        if (last && !options.dryRun) {
          await client.query(
            `INSERT INTO backfill_checkpoints (name, last_id) VALUES ($1, $2)
             ON CONFLICT (name) DO UPDATE SET last_id = EXCLUDED.last_id, updated_at = now()`,
            [checkpointName, last.id],
          );
        }
        if (options.dryRun) throw new DryRunRollback();
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (!(err instanceof DryRunRollback)) throw err;
      } finally {
        client.release();
      }
      if (processed < options.batchSize) break;
    }
  }
  return report;
};
