// TC-018: legacy-backfill идемпотентен, история не выдумывается,
// несовпадения попадают в отчёт.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { computeHashes } from '../ingest/dedup.js';
import { storeDocument } from '../ingest/store.js';
import { runLegacyRevisionBackfill } from './backfill.js';

let s1 = 0;
let s2 = 0;
let manual = 0;

/** Legacy-строка «как до миграции 011»: только raw_documents (+ sighting). */
const legacyDocument = async (
  sourceId: number,
  externalId: string | null,
  body: string,
  withSighting: boolean,
): Promise<number> => {
  const { contentHash, leadHash } = computeHashes(body);
  const id = (
    await getPool().query<{ id: number }>(
      `INSERT INTO raw_documents (source_id, external_id, url, body, content_hash, lead_hash, body_len, published_at, status)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, NULL, 'extracted') RETURNING id`,
      [sourceId, externalId, body, contentHash, leadHash, body.length],
    )
  ).rows[0]!.id;
  if (withSighting) await legacySighting(id, sourceId, externalId);
  return id;
};

const legacySighting = async (documentId: number, sourceId: number, externalId: string | null): Promise<void> => {
  await getPool().query('INSERT INTO document_sightings (document_id, source_id, external_id) VALUES ($1, $2, $3)', [
    documentId,
    sourceId,
    externalId,
  ]);
};

const counts = async () =>
  (
    await getPool().query<{ items: number; revisions: number; observations: number; legacy: number }>(
      `SELECT (SELECT count(*)::int FROM source_items) AS items,
              (SELECT count(*)::int FROM document_revisions) AS revisions,
              (SELECT count(*)::int FROM source_observations) AS observations,
              (SELECT count(*)::int FROM raw_documents) AS legacy`,
    )
  ).rows[0]!;

let doc1 = 0;

beforeAll(async () => {
  await resetAndMigrate();
  s1 = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_legacy_a' });
  s2 = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_legacy_b' });
  manual = (await getPool().query<{ id: number }>(`SELECT id FROM sources WHERE kind = 'manual' AND key = 'form'`)).rows[0]!.id;

  // doc1: пост канала A, перепечатан каналом B (sighting с другим external_id).
  doc1 = await legacyDocument(s1, 'legacy_a/1', 'Синтетический legacy-пост про корпус 2 ЖК «Берег-Демо».', true);
  await legacySighting(doc1, s2, 'legacy_b/77');
  // doc2: второй пост канала A.
  await legacyDocument(s1, 'legacy_a/2', 'Второй синтетический legacy-пост про поставку арматуры.', true);
  // doc3: ручная вставка без sighting (осиротевший документ).
  await legacyDocument(manual, null, 'Синтетическая ручная вставка без адреса и внешнего идентификатора.', false);
});

afterAll(async () => {
  await closeDb();
});

describe('runLegacyRevisionBackfill', () => {
  it('dry-run считает, но ничего не пишет', async () => {
    const before = await counts();
    const report = await runLegacyRevisionBackfill(getPool(), { dryRun: true, batchSize: 2 });
    expect(report.rowsScanned).toBe(4);
    expect(report.revisionsCreated).toBeGreaterThan(0);
    expect(await counts()).toEqual(before);
    const checkpoints = await getPool().query('SELECT * FROM backfill_checkpoints');
    expect(checkpoints.rowCount).toBe(0);
  });

  it('первый запуск: публикации по источникам, история неизвестна, legacy не тронут', async () => {
    const report = await runLegacyRevisionBackfill(getPool(), { dryRun: false, batchSize: 2 });
    expect(report).toMatchObject({
      sightingsScanned: 3,
      documentsWithoutSightings: 1,
      itemsCreated: 4,
      revisionsCreated: 4,
      observationsCreated: 4,
      ambiguousCount: 0,
    });
    expect(await counts()).toMatchObject({ items: 4, revisions: 4, observations: 4, legacy: 3 });

    // Перепечатка — отдельная публикация канала B, текст общий с doc1.
    const repost = await getPool().query<{ legacy_document_id: number }>(
      `SELECT r.legacy_document_id FROM source_items i JOIN document_revisions r ON r.source_item_id = i.id
       WHERE i.source_id = $1 AND i.item_key = 'ext:legacy_b/77'`,
      [s2],
    );
    expect(repost.rows[0]?.legacy_document_id).toBe(doc1);

    const invented = await getPool().query(
      `SELECT 1 FROM source_items WHERE history_before_import <> 'unknown' OR origin <> 'legacy_import'
       UNION ALL
       SELECT 1 FROM document_revisions WHERE chronology <> 'unknown' OR completeness <> 'unknown'`,
    );
    expect(invented.rowCount).toBe(0);
  });

  it('повтор с checkpoint — ничего не делает', async () => {
    const report = await runLegacyRevisionBackfill(getPool(), { dryRun: false, batchSize: 2 });
    expect(report.rowsScanned).toBe(0);
    expect(await counts()).toMatchObject({ items: 4, revisions: 4, observations: 4 });
  });

  it('повтор с начала — тот же итог, всё найдено существующим (TC-018)', async () => {
    const report = await runLegacyRevisionBackfill(getPool(), { dryRun: false, batchSize: 3, fromStart: true });
    expect(report).toMatchObject({
      rowsScanned: 4,
      itemsCreated: 0,
      revisionsCreated: 0,
      observationsCreated: 0,
      observationsExisting: 4,
    });
    expect(await counts()).toMatchObject({ items: 4, revisions: 4, observations: 4 });
  });

  it('публикация, уже ведущаяся новым сбором с другим текстом, попадает в отчёт, а не пишется вслепую', async () => {
    // Legacy знает пост с одним текстом; новый сбор видит его с другим —
    // публикация создаётся новым сбором, legacy-текст в неё не подмешивается.
    await legacyDocument(s1, 'legacy_a/5', 'Старый синтетический текст до исправления поста.', true);
    const fresh = await storeDocument({
      sourceId: s1,
      sourceRunId: null,
      externalId: 'legacy_a/5',
      url: null,
      title: null,
      body: 'Исправленный синтетический текст того же поста после правки автором.',
      publishedAt: null,
      forwardFrom: null,
    });
    expect(fresh.outcome).toBe('new_revision');

    const report = await runLegacyRevisionBackfill(getPool(), { dryRun: false, batchSize: 10 });
    expect(report.ambiguousCount).toBe(1);
    expect(report.ambiguous[0]?.reason).toBe('item_has_ingest_revisions_with_different_text');

    const revisions = await getPool().query(
      `SELECT r.body FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id
       WHERE i.source_id = $1 AND i.item_key = 'ext:legacy_a/5'`,
      [s1],
    );
    expect(revisions.rowCount).toBe(1);
    const history = await getPool().query<{ history_before_import: string }>(
      `SELECT history_before_import FROM source_items WHERE source_id = $1 AND item_key = 'ext:legacy_a/5'`,
      [s1],
    );
    expect(history.rows[0]?.history_before_import).toBe('unknown');
  });
});
