// Новый конвейер: запуски, предпросмотр набора кандидатов и публикация.
// Доступ — после входа оператора; публикация — с CSRF (app.ts).

import { z } from 'zod';

import { query } from '../db/pool.js';
import {
  NotPublishableError,
  PublicationConflictError,
  previewCandidateSet,
  publishCandidateSet,
} from '../reprocess/publish.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const reprocessRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const runsSchema = z.object({
  sourceItemId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

reprocessRouter.get('/reprocess/runs', async (req, res) => {
  const parsed = runsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const runs = await query(
    `SELECT er.id, er.revision_id AS "revisionId", r.source_item_id AS "sourceItemId", r.revision_no AS "revisionNo",
            er.status, er.covered_chars AS "coveredChars", er.total_chars AS "totalChars", er.relevant, er.error,
            er.fingerprint, er.fingerprint_json->>'model' AS model, er.fingerprint_json->>'promptVersion' AS "promptVersion",
            er.requested_by AS "requestedBy", er.created_at AS "createdAt", er.finished_at AS "finishedAt",
            cs.id AS "candidateSetId", cs.status AS "candidateSetStatus",
            (SELECT count(*)::int FROM extraction_chunks c WHERE c.run_id = er.id) AS "chunks",
            (SELECT count(*)::int FROM extraction_chunks c WHERE c.run_id = er.id AND c.status = 'ok') AS "chunksOk"
     FROM extraction_runs er
     JOIN document_revisions r ON r.id = er.revision_id
     LEFT JOIN candidate_sets cs ON cs.run_id = er.id
     WHERE ($1::bigint IS NULL OR r.source_item_id = $1)
     ORDER BY er.id DESC LIMIT $2`,
    [parsed.data.sourceItemId ?? null, parsed.data.limit],
  );
  res.json({ runs });
});

reprocessRouter.get('/reprocess/sets/:id/preview', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный набор' });
    return;
  }
  try {
    res.json(await previewCandidateSet(id));
  } catch (err) {
    if (err instanceof NotPublishableError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const publishSchema = z.object({
  expectedVersion: z.number().int().min(0),
  allowStale: z.boolean().default(false),
});

reprocessRouter.post('/reprocess/sets/:id/publish', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = publishSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ожидаемую версию публикации' });
    return;
  }
  try {
    const result = await publishCandidateSet({ setId: id, actor: 'operator', ...parsed.data });
    // Отказ политики или устаревший разбор — не ошибка запроса, а решение: 200 с outcome.
    res.json(result);
  } catch (err) {
    if (err instanceof PublicationConflictError) {
      res.status(409).json({ error: err.message, code: 'version_conflict', currentVersion: err.currentVersion });
      return;
    }
    if (err instanceof NotPublishableError) {
      res.status(422).json({ error: err.message, code: 'not_publishable' });
      return;
    }
    throw err;
  }
});
