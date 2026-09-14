// TC-025: перенос legacy-канона в утверждения.
// Автостатус не становится подтверждением; ручные статусы сохраняются с
// reviewer = legacy_unknown и provenance_gap; неоднозначные и ненайденные цитаты
// не создают фиктивных доказательств; повтор не дублирует.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument } from '../ingest/store.js';
import { runLegacyAssertionBackfill } from './backfill.js';

const BODY =
  'Синтетика: «Демо-Альфа» — подрядчик по ВК на ЖК «Берег-Демо». ' +
  'Сообщается: суд принял иск к «Демо-Альфа». Повтор: суд принял иск к «Демо-Альфа». ' +
  'Работы на ЖК «Берег-Демо» идут по графику.';

let companyId = 0;
let projectId = 0;
let documentId = 0;
const events: Record<string, number> = {};

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await getPool().query<T>(sql, params)).rows[0]!;

const counts = async () =>
  one<{ assertions: number; evidence: number; reviews: number }>(
    `SELECT (SELECT count(*)::int FROM assertions) AS assertions,
            (SELECT count(*)::int FROM evidence) AS evidence,
            (SELECT count(*)::int FROM review_decisions) AS reviews`,
  );

beforeAll(async () => {
  await resetAndMigrate();
  const source = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_legacy_canon' });
  const stored = await storeDocument({
    sourceId: source,
    sourceRunId: null,
    externalId: 'synthetic_legacy_canon/1',
    url: null,
    title: null,
    body: BODY,
    publishedAt: null,
    forwardFrom: null,
  });
  documentId = stored.documentId!;

  companyId = (await one<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Альфа','демо альфа','demo alfa') RETURNING id`)).id;
  projectId = (await one<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ('Берег-Демо','берег демо','bereg demo') RETURNING id`)).id;

  // Упоминание с ролью и точной цитатой; упоминание с цитатой, которой в тексте нет.
  await getPool().query(
    `INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, role, quote, quote_verified, confidence, published_at)
     VALUES ($1, 'company', $2, 'Демо-Альфа', 'contractor', '«Демо-Альфа» — подрядчик по ВК на ЖК «Берег-Демо»', true, 0.9, now()),
            ($1, 'project', $3, 'Берег-Демо', NULL, 'пересказ, которого нет в тексте', false, 0.8, now())`,
    [documentId, companyId, projectId],
  );
  await getPool().query(
    `INSERT INTO project_participants (project_id, company_id, role, confidence, evidence_document_id)
     VALUES ($1, $2, 'contractor', 0.9, $3)`,
    [projectId, companyId, documentId],
  );

  const event = async (key: string, type: string, quote: string, status: string, company: number | null) => {
    events[key] = (
      await one<{ id: number }>(
        `INSERT INTO events (type, company_id, project_id, document_id, quote, confidence, status)
         VALUES ($1, $2, $3, $4, $5, 0.9, $6) RETURNING id`,
        [type, company, projectId, documentId, quote, status],
      )
    ).id;
  };
  // Авто-событие с однозначной цитатой; ручное confirmed; ручное rejected без цитаты в тексте;
  // авто-событие с цитатой, которая встречается дважды.
  await event('auto', 'milestone', 'Работы на ЖК «Берег-Демо» идут по графику', 'auto', null);
  await event('confirmed', 'delay', '«Демо-Альфа» — подрядчик по ВК', 'confirmed', companyId);
  await event('rejected', 'bankruptcy', 'текст, которого нет в документе', 'rejected', companyId);
  await event('ambiguous', 'court_case', 'суд принял иск к «Демо-Альфа»', 'auto', companyId);
});

afterAll(async () => {
  await closeDb();
});

describe('runLegacyAssertionBackfill', () => {
  it('dry-run: сводка есть, данных нет', async () => {
    const report = await runLegacyAssertionBackfill(getPool(), { dryRun: true, batchSize: 2 });
    expect(report.kinds.event.scanned).toBe(4);
    expect(await counts()).toEqual({ assertions: 0, evidence: 0, reviews: 0 });
  });

  it('запись: только с найденными доказательствами, ручные статусы перенесены', async () => {
    const report = await runLegacyAssertionBackfill(getPool(), { dryRun: false, batchSize: 2 });

    expect(report.kinds.project_participant).toMatchObject({ scanned: 1, assertionsCreated: 1, evidenceCreated: 1 });
    expect(report.kinds.mention).toMatchObject({ scanned: 2, assertionsCreated: 1, quoteNotFound: 1 });
    expect(report.kinds.event).toMatchObject({
      scanned: 4,
      assertionsCreated: 3,
      evidenceCreated: 2,
      quoteNotFound: 1,
      quoteAmbiguous: 1,
      manualStatusesMigrated: 2,
      manualWithoutEvidence: 1,
    });
  });

  it('контрольная выборка ручных статусов совпадает с legacy', async () => {
    const reviews = (
      await getPool().query<{ legacy_id: number; decision: string; reviewer: string; provenance_gap: boolean }>(
        `SELECT legacy_id, decision, reviewer, provenance_gap FROM review_decisions WHERE legacy_kind = 'event' ORDER BY legacy_id`,
      )
    ).rows;
    const legacy = (
      await getPool().query<{ id: number; status: string }>(
        `SELECT id, status FROM events WHERE status <> 'auto' ORDER BY id`,
      )
    ).rows;
    expect(reviews.map(r => r.legacy_id)).toEqual(legacy.map(e => e.id));
    for (const r of reviews) {
      const status = legacy.find(e => e.id === r.legacy_id)!.status;
      expect(r.decision).toBe(status === 'confirmed' ? 'reviewed_supported' : 'rejected');
      expect(r.reviewer).toBe('legacy_unknown');
      expect(r.provenance_gap).toBe(true);
    }
  });

  it('автостатус не становится подтверждением', async () => {
    const auto = await one<{ status: string; reviews: number }>(
      `SELECT a.status, (SELECT count(*)::int FROM review_decisions r WHERE r.assertion_id = a.id) AS reviews
       FROM assertions a WHERE a.predicate = 'event' AND a.event_type = 'milestone'`,
    );
    expect(auto).toEqual({ status: 'text_grounded', reviews: 0 });
  });

  it('повторяющаяся цитата не даёт доказательства по первому совпадению', async () => {
    expect(BODY.split('суд принял иск к «Демо-Альфа»').length - 1).toBe(2);
    const court = await getPool().query(`SELECT 1 FROM evidence WHERE legacy_kind = 'event' AND legacy_id = $1`, [
      events.ambiguous,
    ]);
    expect(court.rowCount).toBe(0);
    const assertion = await getPool().query(`SELECT 1 FROM assertions WHERE event_type = 'court_case'`);
    expect(assertion.rowCount).toBe(0);
  });

  it('фиктивных цитат нет: каждое доказательство совпадает с текстом редакции', async () => {
    const broken = await getPool().query(
      `SELECT e.id FROM evidence e JOIN document_revisions r ON r.id = e.revision_id
       WHERE substring(r.body FROM e.span_start + 1 FOR e.span_end - e.span_start) <> e.quote`,
    );
    expect(broken.rowCount).toBe(0);
  });

  it('повтор с checkpoint и с начала не создаёт дублей', async () => {
    const before = await counts();
    await runLegacyAssertionBackfill(getPool(), { dryRun: false, batchSize: 2 });
    const again = await runLegacyAssertionBackfill(getPool(), { dryRun: false, batchSize: 3, fromStart: true });
    expect(again.kinds.event.manualStatusesExisting).toBe(2);
    expect(again.kinds.event.manualStatusesMigrated).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('канонические legacy-строки не изменены', async () => {
    const legacy = await one<{ events: number; mentions: number; participants: number }>(
      `SELECT (SELECT count(*)::int FROM events) AS events,
              (SELECT count(*)::int FROM mentions) AS mentions,
              (SELECT count(*)::int FROM project_participants) AS participants`,
    );
    expect(legacy).toEqual({ events: 4, mentions: 2, participants: 1 });
  });
});
