// Чтение публикаций, их редакций, полноты и различий между версиями.
// Только чтение; доступ — после входа оператора (app.ts).

import { z } from 'zod';

import { query, queryOne } from '../db/pool.js';
import { diffLines } from '../revisions/diff.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const revisionsRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const ITEM_COLUMNS = `
  i.id, i.source_id AS "sourceId", s.title AS "sourceTitle", s.kind AS "sourceKind", s.key AS "sourceKey",
  i.item_key AS "itemKey", i.item_key_kind AS "itemKeyKind", i.external_id AS "externalId",
  i.canonical_url AS "canonicalUrl", i.original_url AS "originalUrl",
  i.published_at AS "publishedAt", i.state, i.deleted_observed_at AS "deletedObservedAt",
  i.first_observed_at AS "firstObservedAt", i.last_observed_at AS "lastObservedAt",
  i.latest_revision_id AS "latestRevisionId", i.latest_state_observed_at AS "latestStateObservedAt",
  i.history_before_import AS "historyBeforeImport", i.origin,
  (SELECT count(*)::int FROM document_revisions r WHERE r.source_item_id = i.id) AS "revisionCount",
  lr.completeness AS "latestCompleteness", lr.completeness_reason AS "latestCompletenessReason"
`;

const ITEM_FROM = `
  FROM source_items i
  JOIN sources s ON s.id = i.source_id
  LEFT JOIN document_revisions lr ON lr.id = i.latest_revision_id
`;

/**
 * Лента последнего: что вообще пришло в портал за последнее время.
 * Порядок — по дате публикации источника, а при её отсутствии по наблюдению:
 * момент, когда портал увидел текст, датой публикации не притворяется.
 */
revisionsRouter.get('/feed', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 100);
  const items = await query(
    `SELECT i.id, s.title AS "sourceTitle", s.kind AS "sourceKind", s.key AS "sourceKey",
            i.published_at AS "publishedAt", i.first_observed_at AS "firstObservedAt",
            i.canonical_url AS "canonicalUrl", i.state,
            lr.title, lr.completeness, lr.revision_no AS "revisionNo",
            lr.legacy_document_id AS "documentId",
            length(lr.body) AS "bodyChars",
            (SELECT count(*)::int FROM document_revisions r WHERE r.source_item_id = i.id) AS "revisionCount"
     FROM source_items i
     JOIN sources s ON s.id = i.source_id
     LEFT JOIN document_revisions lr ON lr.id = i.latest_revision_id
     ORDER BY coalesce(i.published_at, i.first_observed_at) DESC, i.id DESC
     LIMIT $1`,
    [limit],
  );
  res.json({ items, limit });
});

/** Публикации, связанные с legacy-документом (из карточки: упоминание → документ → версии). */
revisionsRouter.get('/documents/:id/items', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const items = await query(
    `SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
     WHERE i.id IN (SELECT source_item_id FROM document_revisions WHERE legacy_document_id = $1)
     ORDER BY i.first_observed_at, i.id`,
    [id],
  );
  res.json({ items });
});

revisionsRouter.get('/items/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const item = await queryOne(`SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE i.id = $1`, [id]);
  if (!item) {
    res.status(404).json({ error: 'Публикация не найдена' });
    return;
  }
  const observations = await query(
    `SELECT o.id, o.revision_id AS "revisionId", o.observed_at AS "observedAt", o.fetched_at AS "fetchedAt",
            o.outcome, o.observed_url AS "observedUrl", o.forward_origin AS "forwardOrigin"
     FROM source_observations o WHERE o.source_item_id = $1
     ORDER BY o.observed_at DESC, o.id DESC LIMIT 50`,
    [id],
  );
  res.json({ item, observations });
});

/** Список редакций без текстов: номер, даты, полнота, хэш. */
revisionsRouter.get('/items/:id/revisions', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const revisions = await query(
    `SELECT r.id, r.revision_no AS "revisionNo", r.title, length(r.body)::int AS "bodyLength",
            encode(r.body_hash, 'hex') AS "bodyHash", r.body_representation AS "representation",
            r.completeness, r.completeness_reason AS "completenessReason", r.attachments,
            r.published_at AS "publishedAt", r.source_modified_at AS "sourceModifiedAt",
            r.first_observed_at AS "firstObservedAt", r.chronology,
            r.same_content_as_revision_id AS "sameContentAsRevisionId",
            r.legacy_document_id AS "legacyDocumentId", r.origin,
            (SELECT count(*)::int FROM source_observations o WHERE o.revision_id = r.id) AS "observationCount"
     FROM document_revisions r WHERE r.source_item_id = $1
     ORDER BY r.revision_no`,
    [id],
  );
  res.json({ items: revisions });
});

revisionsRouter.get('/revisions/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const revision = await queryOne(
    `SELECT r.id, r.source_item_id AS "sourceItemId", r.revision_no AS "revisionNo", r.title, r.body,
            r.body_representation AS "representation", encode(r.body_hash, 'hex') AS "bodyHash",
            r.completeness, r.completeness_reason AS "completenessReason", r.attachments,
            r.published_at AS "publishedAt", r.source_modified_at AS "sourceModifiedAt",
            r.first_observed_at AS "firstObservedAt", r.chronology,
            r.same_content_as_revision_id AS "sameContentAsRevisionId",
            r.legacy_document_id AS "legacyDocumentId", r.origin
     FROM document_revisions r WHERE r.id = $1`,
    [id],
  );
  if (!revision) {
    res.status(404).json({ error: 'Редакция не найдена' });
    return;
  }
  res.json({ revision });
});

const diffSchema = z.object({ against: z.coerce.number().int().positive() });

/** Diff двух редакций одной публикации. Текст сравнивается как строки, без HTML. */
revisionsRouter.get('/revisions/:id/diff', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = diffSchema.safeParse(req.query);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ?against=<id редакции>' });
    return;
  }
  const rows = await query<{ id: number; source_item_id: number; body: string; revision_no: number }>(
    'SELECT id, source_item_id, body, revision_no FROM document_revisions WHERE id = ANY($1::bigint[])',
    [[parsed.data.against, id]],
  );
  const before = rows.find(r => r.id === parsed.data.against);
  const after = rows.find(r => r.id === id);
  if (!before || !after) {
    res.status(404).json({ error: 'Редакция не найдена' });
    return;
  }
  if (before.source_item_id !== after.source_item_id) {
    res.status(400).json({ error: 'Сравниваются только редакции одной публикации' });
    return;
  }
  const diff = diffLines(before.body, after.body);
  res.json({ from: before.revision_no, to: after.revision_no, diff });
});
