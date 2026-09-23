// Чтение публикаций, их редакций, полноты и различий между версиями.
// Только чтение; доступ — после входа оператора (app.ts).

import { z } from 'zod';

import { query, queryOne } from '../db/pool.js';
import { loadItemOutcome } from '../reprocess/itemOutcome.js';
import { diffLines } from '../revisions/diff.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { keysetCursor, parseKeysetCursor } from '../utils/keysetCursor.js';

export const revisionsRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/**
 * Тема публикации (headline@1): последняя по времени для показываемой редакции.
 * Это машинная подпись строки, а не заголовок источника — интерфейс говорит это прямо.
 */
const HEADLINE_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT h.topic, h.model, h.headline_version AS version, h.created_at
    FROM revision_headlines h
    WHERE h.revision_id = lr.id
    ORDER BY h.created_at DESC, h.id DESC
    LIMIT 1
  ) hl ON true
`;

const ITEM_COLUMNS = `
  i.id, i.source_id AS "sourceId", s.title AS "sourceTitle", s.kind AS "sourceKind", s.key AS "sourceKey",
  i.item_key AS "itemKey", i.item_key_kind AS "itemKeyKind", i.external_id AS "externalId",
  i.canonical_url AS "canonicalUrl", i.original_url AS "originalUrl",
  i.published_at AS "publishedAt", i.state, i.deleted_observed_at AS "deletedObservedAt",
  i.first_observed_at AS "firstObservedAt", i.last_observed_at AS "lastObservedAt",
  i.latest_revision_id AS "latestRevisionId", i.latest_state_observed_at AS "latestStateObservedAt",
  i.history_before_import AS "historyBeforeImport", i.origin,
  (SELECT count(*)::int FROM document_revisions r WHERE r.source_item_id = i.id) AS "revisionCount",
  lr.title, lr.completeness AS "latestCompleteness", lr.completeness_reason AS "latestCompletenessReason",
  hl.topic, hl.model AS "topicModel", hl.version AS "topicVersion"
`;

const ITEM_FROM = `
  FROM source_items i
  JOIN sources s ON s.id = i.source_id
  LEFT JOIN document_revisions lr ON lr.id = i.latest_revision_id
  ${HEADLINE_LATERAL}
`;

const feedSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(80).optional(),
  /** Поиск по тексту публикации, её заголовку, теме и названию источника. */
  q: z.string().trim().min(2).max(200).optional(),
});

/** Спецсимволы LIKE в запросе — буквы, а не шаблон: «50%» ищет «50%», а не всё подряд. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;

/**
 * Лента публикаций и поиск по ним: что вообще пришло в портал.
 * Порядок — по дате публикации источника, а при её отсутствии по наблюдению:
 * момент, когда портал увидел текст, датой публикации не притворяется.
 *
 * Поиск — подстрокой без учёта регистра, а не морфологией: to_tsvector('russian') не знает
 * брендов вроде «А101» и «MR Group», а оператор ищет именно их. Индекса по тексту нет —
 * на локальной базе в тысячи публикаций это миллисекунды; при росте нужен gin_trgm_ops.
 */
revisionsRouter.get('/feed', async (req, res) => {
  const parsed = feedSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры ленты: q — от 2 символов, limit — до 100' });
    return;
  }
  const { limit, cursor, q } = parsed.data;
  const [cursorAt, cursorId] = parseKeysetCursor(cursor);
  const items = await query<{ id: number; sortAt: Date }>(
    `SELECT i.id, s.title AS "sourceTitle", s.kind AS "sourceKind", s.key AS "sourceKey",
            i.published_at AS "publishedAt", i.first_observed_at AS "firstObservedAt",
            i.canonical_url AS "canonicalUrl", coalesce(i.canonical_url, i.original_url) AS url, i.state,
            lr.id AS "revisionId", lr.title, lr.completeness, lr.revision_no AS "revisionNo",
            lr.legacy_document_id AS "documentId",
            length(lr.body)::int AS "bodyChars",
            left(lr.body, 300) AS snippet,
            hl.topic, hl.model AS "topicModel",
            (SELECT count(*)::int FROM document_revisions r WHERE r.source_item_id = i.id) AS "revisionCount",
            coalesce(i.published_at, i.first_observed_at) AS "sortAt"
     FROM source_items i
     JOIN sources s ON s.id = i.source_id
     LEFT JOIN document_revisions lr ON lr.id = i.latest_revision_id
     ${HEADLINE_LATERAL}
     WHERE ($2::text IS NULL OR lr.body ILIKE $2 OR lr.title ILIKE $2 OR hl.topic ILIKE $2 OR s.title ILIKE $2)
       AND ($3::timestamptz IS NULL
            OR (coalesce(i.published_at, i.first_observed_at), i.id) < ($3::timestamptz, $4::bigint))
     ORDER BY coalesce(i.published_at, i.first_observed_at) DESC, i.id DESC
     LIMIT $1`,
    [limit, q ? likePattern(q) : null, cursorAt, cursorId],
  );
  const last = items[items.length - 1];
  res.json({
    items: items.map(({ sortAt: _sortAt, ...rest }) => rest),
    limit,
    nextCursor: items.length === limit && last ? keysetCursor(last.sortAt, last.id) : null,
  });
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

/**
 * Что портал взял из публикации: состояние обработки словами и опубликованные
 * утверждения с цитатами. Пусто — с причиной, а не молча.
 */
revisionsRouter.get('/items/:id/extraction', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const outcome = await loadItemOutcome(id);
  if (!outcome) {
    res.status(404).json({ error: 'Публикация не найдена' });
    return;
  }
  res.json(outcome);
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
