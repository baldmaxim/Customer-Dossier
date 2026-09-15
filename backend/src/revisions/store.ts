// Запись наблюдения публикации: источник → публикация → редакция → наблюдение.
//
// Вызывается ТОЛЬКО внутри транзакции: upsert публикации блокирует её строку
// до конца транзакции, и два одновременных наблюдения одного состояния
// выстраиваются в очередь, а не создают две одинаковые редакции.

import type { PoolClient } from 'pg';

import { computeHashes } from '../ingest/dedup.js';
import { decideRevision, type ObservationOutcome } from './decide.js';
import { itemIdentity, revisionHash } from './identity.js';

export const TEXT_COMPLETENESS = ['full', 'excerpt', 'caption_only', 'failed', 'unknown'] as const;
export type TextCompleteness = (typeof TEXT_COMPLETENESS)[number];

export interface IAttachment {
  kind: string;
  /** unsupported — вложение есть, но его содержимое не читается. */
  status: 'unsupported' | 'read' | 'failed';
}

export interface IObservationInput {
  sourceId: number;
  sourceRunId: number | null;
  externalId: string | null;
  url: string | null;
  title: string | null;
  body: string;
  /** Адаптер и версия очистки текста: telegram_web_text@1, rss_text@1… */
  representation: string;
  completeness: TextCompleteness;
  completenessReason: string | null;
  attachments: IAttachment[];
  publishedAt: Date | null;
  sourceModifiedAt: Date | null;
  fetchedAt: Date;
  forwardOrigin: string | null;
  /** Точность даты публикации и сырой текст даты (этап 05A). */
  publishedAtPrecision?: PublishedAtPrecision | null;
  publishedAtRaw?: string | null;
  /** Версия парсера адаптера: смена вёрстки при том же тексте видна в наблюдении. */
  parserVersion?: string | null;
}

export type PublishedAtPrecision = 'exact' | 'local_tz' | 'date_only' | 'no_year' | 'relative' | 'unparsed';

export interface ILegacyLink {
  legacyDocumentId: number | null;
  /** Legacy-слой уже знает эту публикацию с другим текстом: прежние редакции не видели. */
  historyUnknown: boolean;
}

export interface IObservationResult {
  outcome: ObservationOutcome;
  sourceItemId: number;
  revisionId: number;
  revisionNo: number;
  legacyDocumentId: number | null;
}

interface IItemRow {
  id: number;
  inserted: boolean;
  latest_revision_id: number | null;
  latest_state_observed_at: Date | null;
  latest_source_modified_at: Date | null;
}

export const recordObservation = async (
  client: PoolClient,
  input: IObservationInput,
  /** Вызывается только для первой редакции новой публикации — завести или найти legacy-документ. */
  resolveLegacy: () => Promise<ILegacyLink>,
): Promise<IObservationResult> => {
  const identity = itemIdentity({ externalId: input.externalId, url: input.url, body: input.body });
  const hash = revisionHash(input.body);
  const hashHex = hash.toString('hex');

  const itemRes = await client.query<IItemRow>(
    `INSERT INTO source_items
       (source_id, item_key, item_key_kind, external_id, canonical_url, original_url,
        published_at, first_observed_at, last_observed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (source_id, item_key) DO UPDATE
       SET last_observed_at = greatest(source_items.last_observed_at, EXCLUDED.last_observed_at),
           published_at = coalesce(source_items.published_at, EXCLUDED.published_at)
     RETURNING id, (xmax = 0) AS inserted, latest_revision_id,
               latest_state_observed_at, latest_source_modified_at`,
    [
      input.sourceId,
      identity.key,
      identity.kind,
      identity.externalId,
      identity.canonicalUrl,
      input.url,
      input.publishedAt,
      input.fetchedAt,
    ],
  );
  const item = itemRes.rows[0];
  if (!item) throw new Error('source_items: upsert не вернул строку');

  // Строка публикации заблокирована upsert'ом до конца транзакции.
  const latest =
    item.latest_revision_id === null
      ? null
      : (
          await client.query<{ body_hash: Buffer }>('SELECT body_hash FROM document_revisions WHERE id = $1', [
            item.latest_revision_id,
          ])
        ).rows[0] ?? null;

  const sameText = (
    await client.query<{ id: number; revision_no: number }>(
      `SELECT id, revision_no FROM document_revisions
       WHERE source_item_id = $1 AND body_hash = $2
       ORDER BY revision_no LIMIT 1`,
      [item.id, hash],
    )
  ).rows[0];

  const decision = decideRevision(
    latest
      ? {
          bodyHashHex: latest.body_hash.toString('hex'),
          sourceModifiedAt: item.latest_source_modified_at,
          stateObservedAt: item.latest_state_observed_at,
        }
      : null,
    { bodyHashHex: hashHex, sourceModifiedAt: input.sourceModifiedAt, fetchedAt: input.fetchedAt },
    sameText !== undefined,
  );

  let revisionId: number;
  let revisionNo: number;
  let legacyDocumentId: number | null = null;

  if (decision.createsRevision) {
    let historyUnknown = false;
    if (decision.outcome === 'new_item') {
      const legacy = await resolveLegacy();
      legacyDocumentId = legacy.legacyDocumentId;
      historyUnknown = legacy.historyUnknown;
    }

    const next = await client.query<{ next: number }>(
      'SELECT coalesce(max(revision_no), 0) + 1 AS next FROM document_revisions WHERE source_item_id = $1',
      [item.id],
    );
    revisionNo = next.rows[0]?.next ?? 1;

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO document_revisions
         (source_item_id, revision_no, title, body, body_representation, body_hash, dedup_hash,
          completeness, completeness_reason, attachments, published_at, source_modified_at,
          first_observed_at, chronology, same_content_as_revision_id, legacy_document_id,
          published_at_precision, published_at_raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text_completeness, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        item.id,
        revisionNo,
        input.title,
        input.body,
        input.representation,
        hash,
        computeHashes(input.body).contentHash,
        input.completeness,
        input.completenessReason,
        JSON.stringify(input.attachments),
        input.publishedAt,
        input.sourceModifiedAt,
        input.fetchedAt,
        decision.chronology,
        sameText?.id ?? null,
        legacyDocumentId,
        input.publishedAtPrecision ?? null,
        input.publishedAtRaw ?? null,
      ],
    );
    revisionId = inserted.rows[0]!.id;

    if (historyUnknown) {
      await client.query(`UPDATE source_items SET history_before_import = 'unknown' WHERE id = $1`, [item.id]);
    }
  } else if (decision.outcome === 'unchanged') {
    revisionId = item.latest_revision_id!;
    revisionNo = (
      await client.query<{ revision_no: number }>('SELECT revision_no FROM document_revisions WHERE id = $1', [revisionId])
    ).rows[0]!.revision_no;
  } else {
    // Старое наблюдение уже известного текста — ссылка на ту редакцию.
    revisionId = sameText!.id;
    revisionNo = sameText!.revision_no;
  }

  if (decision.movesLatest) {
    await client.query(
      `UPDATE source_items
       SET latest_revision_id = $2,
           latest_state_observed_at = greatest(coalesce(latest_state_observed_at, $3), $3),
           latest_source_modified_at = coalesce($4, latest_source_modified_at),
           state = 'present', deleted_observed_at = NULL
       WHERE id = $1`,
      [item.id, revisionId, input.fetchedAt, input.sourceModifiedAt],
    );
  }

  await client.query(
    `INSERT INTO source_observations
       (source_id, source_item_id, revision_id, source_run_id, fetched_at, observed_url, outcome, forward_origin, parser_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.sourceId,
      item.id,
      revisionId,
      input.sourceRunId,
      input.fetchedAt,
      input.url,
      decision.outcome,
      input.forwardOrigin,
      input.parserVersion ?? null,
    ],
  );

  if (legacyDocumentId === null && decision.outcome !== 'new_item') {
    legacyDocumentId =
      (
        await client.query<{ legacy_document_id: number | null }>(
          `SELECT legacy_document_id FROM document_revisions
           WHERE source_item_id = $1 AND legacy_document_id IS NOT NULL
           ORDER BY revision_no LIMIT 1`,
          [item.id],
        )
      ).rows[0]?.legacy_document_id ?? null;
  }

  return { outcome: decision.outcome, sourceItemId: item.id, revisionId, revisionNo, legacyDocumentId };
};

/**
 * Удаление публикации, которое адаптер реально наблюдал (например, страница
 * поста отвечает «сообщение удалено»). «Не попала в выборку» сюда не ведёт.
 * Редакции и цитаты остаются; публикация получает состояние-tombstone.
 */
export const recordDeletionObserved = async (
  client: PoolClient,
  sourceItemId: number,
  evidence: { observedAt: Date; url: string | null; sourceRunId: number | null },
): Promise<void> => {
  const res = await client.query<{ source_id: number }>(
    `UPDATE source_items SET state = 'deleted_observed', deleted_observed_at = $2,
            last_observed_at = greatest(last_observed_at, $2)
     WHERE id = $1 RETURNING source_id`,
    [sourceItemId, evidence.observedAt],
  );
  const row = res.rows[0];
  if (!row) throw new Error(`публикация ${sourceItemId} не найдена`);
  await client.query(
    `INSERT INTO source_observations (source_id, source_item_id, revision_id, source_run_id, fetched_at, observed_url, outcome)
     VALUES ($1, $2, NULL, $3, $4, $5, 'deleted_observed')`,
    [row.source_id, sourceItemId, evidence.sourceRunId, evidence.observedAt, evidence.url],
  );
};
