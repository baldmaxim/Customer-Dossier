// Backfill: legacy raw_documents / document_sightings → публикации и редакции.
//
// Правила:
//  - только расширение: legacy-строки не меняются и не удаляются;
//  - история, которой не было, не выдумывается: публикация получает
//    history_before_import = 'unknown', редакция — chronology = 'unknown',
//    полнота — 'unknown', представление — legacy_raw_documents_body;
//  - идемпотентность: повтор (в том числе с начала, без checkpoint) не
//    создаёт дублей; существующее учитывается в отчёте, а не молча пропускается;
//  - неоднозначные случаи попадают в отчёт и не записываются вслепую;
//  - пакет — одна транзакция; checkpoint сдвигается вместе с пакетом;
//  - dry-run выполняет всё в транзакции и откатывает её.

import type { Pool, PoolClient } from 'pg';

import { computeHashes } from '../ingest/dedup.js';
import { itemIdentity, revisionHash } from './identity.js';

export const CHECKPOINT_SIGHTINGS = 'revisions_legacy_sightings';
export const CHECKPOINT_ORPHANS = 'revisions_legacy_documents_without_sightings';
const LEGACY_REPRESENTATION = 'legacy_raw_documents_body';
const MAX_AMBIGUOUS_IN_REPORT = 200;

export interface IBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  /** Предел пакетов за запуск; undefined — до конца. */
  maxBatches?: number;
  /** Игнорировать checkpoint и пройти всё заново (проверка идемпотентности). */
  fromStart?: boolean;
}

export interface IAmbiguity {
  sightingId: number | null;
  documentId: number;
  sourceId: number;
  itemKey: string;
  reason: string;
}

export interface IBackfillReport {
  dryRun: boolean;
  rowsScanned: number;
  sightingsScanned: number;
  documentsWithoutSightings: number;
  itemsCreated: number;
  itemsReused: number;
  revisionsCreated: number;
  revisionsReused: number;
  observationsCreated: number;
  observationsExisting: number;
  ambiguousCount: number;
  ambiguous: IAmbiguity[];
  checkpoints: Record<string, number | null>;
  batches: number;
}

interface ILegacyRow {
  row_id: number;
  sighting_id: number | null;
  document_id: number;
  source_id: number;
  external_id: string | null;
  url: string | null;
  body: string;
  title: string | null;
  published_at: Date | null;
  fetched_at: Date;
  seen_at: Date;
}

class DryRunRollback extends Error {}

const emptyReport = (dryRun: boolean): IBackfillReport => ({
  dryRun,
  rowsScanned: 0,
  sightingsScanned: 0,
  documentsWithoutSightings: 0,
  itemsCreated: 0,
  itemsReused: 0,
  revisionsCreated: 0,
  revisionsReused: 0,
  observationsCreated: 0,
  observationsExisting: 0,
  ambiguousCount: 0,
  ambiguous: [],
  checkpoints: {},
  batches: 0,
});

const noteAmbiguity = (report: IBackfillReport, entry: IAmbiguity): void => {
  report.ambiguousCount += 1;
  if (report.ambiguous.length < MAX_AMBIGUOUS_IN_REPORT) report.ambiguous.push(entry);
};

const readCheckpoint = async (client: PoolClient, name: string): Promise<number> =>
  (await client.query<{ last_id: number }>('SELECT last_id FROM backfill_checkpoints WHERE name = $1', [name])).rows[0]
    ?.last_id ?? 0;

const writeCheckpoint = async (client: PoolClient, name: string, lastId: number): Promise<void> => {
  await client.query(
    `INSERT INTO backfill_checkpoints (name, last_id) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET last_id = EXCLUDED.last_id, updated_at = now()`,
    [name, lastId],
  );
};

const SIGHTINGS_SQL = `
  SELECT s.id AS row_id, s.id AS sighting_id, d.id AS document_id, s.source_id,
         s.external_id, s.url, d.body, d.title, d.published_at, d.fetched_at, s.seen_at
  FROM document_sightings s
  JOIN raw_documents d ON d.id = s.document_id
  WHERE s.id > $1
  ORDER BY s.id
  LIMIT $2`;

const ORPHANS_SQL = `
  SELECT d.id AS row_id, NULL::bigint AS sighting_id, d.id AS document_id, d.source_id,
         d.external_id, d.url, d.body, d.title, d.published_at, d.fetched_at, d.fetched_at AS seen_at
  FROM raw_documents d
  WHERE d.id > $1
    AND NOT EXISTS (SELECT 1 FROM document_sightings s WHERE s.document_id = d.id)
  ORDER BY d.id
  LIMIT $2`;

const importRow = async (client: PoolClient, row: ILegacyRow, report: IBackfillReport): Promise<void> => {
  const identity = itemIdentity({ externalId: row.external_id, url: row.url, body: row.body });
  const hash = revisionHash(row.body);

  // Публикация: создать как legacy_import либо найти существующую.
  const item = (
    await client.query<{ id: number; inserted: boolean; origin: string; latest_revision_id: number | null }>(
      `INSERT INTO source_items
         (source_id, item_key, item_key_kind, external_id, canonical_url, original_url, published_at,
          first_observed_at, last_observed_at, history_before_import, origin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, 'unknown', 'legacy_import')
       ON CONFLICT (source_id, item_key) DO UPDATE SET last_observed_at = source_items.last_observed_at
       RETURNING id, (xmax = 0) AS inserted, origin, latest_revision_id`,
      [row.source_id, identity.key, identity.kind, identity.externalId, identity.canonicalUrl, row.url, row.published_at, row.seen_at],
    )
  ).rows[0]!;
  if (item.inserted) report.itemsCreated += 1;
  else report.itemsReused += 1;

  // Редакция: та же legacy-строка или тот же текст — переиспользуем.
  let revision = (
    await client.query<{ id: number }>(
      `SELECT id FROM document_revisions
       WHERE source_item_id = $1 AND (legacy_document_id = $2 OR body_hash = $3)
       ORDER BY (legacy_document_id = $2) DESC NULLS LAST, revision_no
       LIMIT 1`,
      [item.id, row.document_id, hash],
    )
  ).rows[0];

  if (revision) {
    report.revisionsReused += 1;
  } else {
    const existingCount = (
      await client.query<{ n: number }>('SELECT count(*)::int AS n FROM document_revisions WHERE source_item_id = $1', [
        item.id,
      ])
    ).rows[0]?.n ?? 0;

    if (existingCount > 0 && item.origin !== 'legacy_import') {
      // Публикация уже ведётся новым сбором, а legacy-текст другой: порядок
      // редакций неизвестен. Записать вслепую — выдумать хронологию.
      noteAmbiguity(report, {
        sightingId: row.sighting_id,
        documentId: row.document_id,
        sourceId: row.source_id,
        itemKey: identity.key,
        reason: 'item_has_ingest_revisions_with_different_text',
      });
      return;
    }
    if (existingCount > 0) {
      noteAmbiguity(report, {
        sightingId: row.sighting_id,
        documentId: row.document_id,
        sourceId: row.source_id,
        itemKey: identity.key,
        reason: 'several_legacy_documents_for_one_item_order_unknown',
      });
    }

    revision = (
      await client.query<{ id: number }>(
        `INSERT INTO document_revisions
           (source_item_id, revision_no, title, body, body_representation, body_hash, dedup_hash,
            completeness, completeness_reason, published_at, first_observed_at, chronology,
            legacy_document_id, origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'unknown', 'legacy_import', $8, $9, 'unknown', $10, 'legacy_import')
         RETURNING id`,
        [
          item.id,
          existingCount + 1,
          row.title,
          row.body,
          LEGACY_REPRESENTATION,
          hash,
          computeHashes(row.body).contentHash,
          row.published_at,
          row.fetched_at,
          row.document_id,
        ],
      )
    ).rows[0]!;
    report.revisionsCreated += 1;

    if (item.latest_revision_id === null) {
      await client.query('UPDATE source_items SET latest_revision_id = $2 WHERE id = $1', [item.id, revision.id]);
    }
  }

  // Наблюдение: одно на legacy-sighting; у документа без sightings — одно на редакцию.
  const observationExists =
    row.sighting_id !== null
      ? (await client.query('SELECT 1 FROM source_observations WHERE legacy_sighting_id = $1', [row.sighting_id]))
          .rowCount! > 0
      : (
          await client.query(
            `SELECT 1 FROM source_observations
             WHERE revision_id = $1 AND outcome = 'legacy_import' AND legacy_sighting_id IS NULL`,
            [revision.id],
          )
        ).rowCount! > 0;

  if (observationExists) {
    report.observationsExisting += 1;
    return;
  }

  await client.query(
    `INSERT INTO source_observations
       (source_id, source_item_id, revision_id, observed_at, fetched_at, observed_url, outcome, legacy_sighting_id)
     VALUES ($1, $2, $3, $4, $4, $5, 'legacy_import', $6)`,
    [row.source_id, item.id, revision.id, row.seen_at, row.url, row.sighting_id],
  );
  report.observationsCreated += 1;
};

const runPass = async (
  pool: Pool,
  name: string,
  sql: string,
  options: IBackfillOptions,
  report: IBackfillReport,
): Promise<void> => {
  let cursor: number | null = null;

  for (let batch = 0; options.maxBatches === undefined || batch < options.maxBatches; batch += 1) {
    const client = await pool.connect();
    let processed = 0;
    try {
      await client.query('BEGIN');
      // Один backfill за раз: параллельный запуск той же команды ждёт.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [name]);

      const start: number = cursor ?? (options.fromStart ? 0 : await readCheckpoint(client, name));
      const rows: ILegacyRow[] = (await client.query<ILegacyRow>(sql, [start, options.batchSize])).rows;
      processed = rows.length;

      for (const row of rows) {
        await importRow(client, row, report);
        report.rowsScanned += 1;
        if (row.sighting_id !== null) report.sightingsScanned += 1;
        else report.documentsWithoutSightings += 1;
      }

      const last: ILegacyRow | undefined = rows[rows.length - 1];
      cursor = last ? last.row_id : start;
      if (last && !options.dryRun) await writeCheckpoint(client, name, last.row_id);
      report.checkpoints[name] = cursor;

      if (options.dryRun) throw new DryRunRollback();
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!(err instanceof DryRunRollback)) throw err;
    } finally {
      client.release();
    }
    report.batches += 1;
    if (processed < options.batchSize) return;
  }
};

export const runLegacyRevisionBackfill = async (pool: Pool, options: IBackfillOptions): Promise<IBackfillReport> => {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 5000) {
    throw new Error('batchSize: от 1 до 5000');
  }
  const report = emptyReport(options.dryRun);
  await runPass(pool, CHECKPOINT_SIGHTINGS, SIGHTINGS_SQL, options, report);
  await runPass(pool, CHECKPOINT_ORPHANS, ORPHANS_SQL, options, report);
  return report;
};
