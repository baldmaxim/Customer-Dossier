// Публикации об объекте (ADR-016, этап 23C): общей ленты в портале нет — публикации живут в компании
// и в объекте. Объект — вместе с очередями и корпусами (дерево parent_project_id до трёх уровней):
// о корпусе пишут как об объекте, и пост про «корпус 3» — пост про комплекс.
//
// Берутся публикации, где объект назван в опубликованном утверждении (объект, сторона или контекст),
// и legacy-упоминания. Снимки реестра ДОМ.РФ сюда не входят — они в паспорте объекта. Строки — той же
// формы, что лента компании; сведений под постом здесь нет (facts пусты): что сказано об объекте —
// в разделах страницы и на самой публикации.

import { z } from 'zod';

import { query } from '../db/pool.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { keysetCursor, parseKeysetCursor } from '../utils/keysetCursor.js';
import type { IItemRow, IPublicationRow } from './companyPublications.js';
import { liveMentionSql } from './legacyMentions.js';

// Тот же список колонок и порядок, что у ленты компании (companyPublications.ts): текст запроса —
// целиком здесь, чтобы проверка плейсхолдеров (sql-sanity.test.ts) видела его полностью.
const ITEMS_SQL = `
  WITH RECURSIVE tree AS (
    SELECT id, 0 AS depth FROM projects WHERE id = $1
    UNION ALL
    SELECT p.id, t.depth + 1 FROM projects p JOIN tree t ON p.parent_project_id = t.id
    WHERE t.depth < 3 AND p.merged_into_id IS NULL
  ),
  touched AS (
    SELECT DISTINCT pa.source_item_id AS item_id
    FROM published_assertions_v pa
    WHERE pa.object_project_id IN (SELECT id FROM tree)
       OR pa.subject_project_id IN (SELECT id FROM tree)
       OR pa.context_project_id IN (SELECT id FROM tree)
    UNION
    SELECT DISTINCT r.source_item_id
    FROM mentions m
    JOIN document_revisions r ON r.legacy_document_id = m.document_id
    WHERE m.entity_kind = 'project' AND m.entity_id IN (SELECT id FROM tree) AND ${liveMentionSql('m')}
  )
  SELECT si.id AS "itemId",
         rev.id AS "revisionId",
         rev.legacy_document_id AS "documentId",
         rev.title,
         (SELECT h.topic FROM revision_headlines h
           WHERE h.revision_id = rev.id ORDER BY h.created_at DESC LIMIT 1) AS topic,
         si.published_at AS "publishedAt",
         si.first_observed_at AS "observedAt",
         s.title AS "sourceTitle",
         s.kind AS "sourceKind",
         s.key AS "sourceKey",
         coalesce(si.canonical_url, si.original_url) AS url,
         rev.completeness::text AS completeness,
         left(rev.body, 300) AS snippet,
         coalesce(si.published_at, si.first_observed_at) AS "sortAt"
  FROM touched t
  JOIN source_items si ON si.id = t.item_id
  JOIN sources s ON s.id = si.source_id
  JOIN LATERAL (
    SELECT r2.id, r2.title, r2.body, r2.completeness, r2.legacy_document_id
    FROM document_revisions r2
    WHERE r2.source_item_id = si.id
    ORDER BY r2.revision_no DESC
    LIMIT 1
  ) rev ON true
  WHERE ($3::timestamptz IS NULL
         OR (coalesce(si.published_at, si.first_observed_at), si.id) < ($3::timestamptz, $4::bigint))
  ORDER BY coalesce(si.published_at, si.first_observed_at) DESC, si.id DESC
  LIMIT $2`;

export const loadProjectPublications = async (
  projectId: number,
  limit: number,
  cursor: string | undefined,
): Promise<{ items: IPublicationRow[]; nextCursor: string | null }> => {
  const [cursorAt, cursorId] = parseKeysetCursor(cursor);
  const items = await query<IItemRow>(ITEMS_SQL, [projectId, limit, cursorAt, cursorId]);
  const last = items[items.length - 1];
  return {
    items: items.map(({ sortAt: _sortAt, ...rest }) => ({ ...rest, facts: [], moreFacts: 0 })),
    nextCursor: items.length === limit && last ? keysetCursor(last.sortAt, last.itemId) : null,
  };
};

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

export const projectPublicationsRouter = asyncRouter();

projectPublicationsRouter.get('/projects/:id/publications', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = listSchema.safeParse(req.query);
  if (!Number.isFinite(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры', code: 'bad_query' });
    return;
  }
  res.json(await loadProjectPublications(id, parsed.data.limit, parsed.data.cursor));
});
