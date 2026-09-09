// Админка: источники и очередь слияний.
//
// Аутентификации в MVP нет — портал крутится в локальной сети. Перед выносом
// на VPS сюда обязателен auth-middleware: слияние сущностей необратимо, а
// правка источников открывает исходящие запросы с сервера.

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { query, execute } from '../db/pool.js';
import { applyMerge, rejectMerge, listPendingMerges } from '../resolve/merge.js';
import { addTelegramSource, addWebsiteSource, deleteSource } from '../ingest/sources.js';
import { refreshCompanyMetrics } from '../metrics/refresh.js';
import { discoverFeedUrl } from '../ingest/website.js';

export const adminRouter = asyncRouter();

adminRouter.get('/sources', async (_req, res) => {
  const rows = await query(
    `SELECT s.id, s.kind, s.key, s.title, s.status, s.cursor,
            s.poll_interval_sec AS "pollIntervalSec",
            s.next_run_at AS "nextRunAt", s.last_ok_at AS "lastOkAt",
            s.fail_streak AS "failStreak",
            r.started_at AS "lastRunAt", r.status AS "lastRunStatus",
            r.items_seen AS "lastItemsSeen", r.items_new AS "lastItemsNew",
            r.error AS "lastError", r.layout_stats AS "layoutStats"
     FROM sources s
     LEFT JOIN LATERAL (
       SELECT * FROM source_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1
     ) r ON true
     ORDER BY
       -- сломанные наверх: они требуют внимания
       CASE s.status WHEN 'broken' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
       s.kind, s.key`,
  );
  res.json({ items: rows });
});

const statusSchema = z.object({ status: z.enum(['active', 'paused', 'broken']) });

adminRouter.patch('/sources/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = statusSchema.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  // Возврат в active сбрасывает счётчик неудач и снимает отсрочку: иначе
  // источник, починенный вручную, будет ещё час ждать next_run_at.
  const updated = await execute(
    `UPDATE sources
     SET status = $2::source_status,
         fail_streak = CASE WHEN $2 = 'active' THEN 0 ELSE fail_streak END,
         next_run_at = CASE WHEN $2 = 'active' THEN now() ELSE next_run_at END,
         updated_at = now()
     WHERE id = $1`,
    [id, parsed.data.status],
  );
  if (updated === 0) {
    res.status(404).json({ error: 'Источник не найден' });
    return;
  }
  res.json({ ok: true });
});

const addSourceSchema = z.object({
  channel: z.string().min(2).max(120),
  title: z.string().max(200).optional(),
});

adminRouter.post('/sources/telegram', async (req, res) => {
  const parsed = addSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите channel' });
    return;
  }
  const source = await addTelegramSource(parsed.data.channel, parsed.data.title);
  res.status(201).json({ source });
});

const addSiteSchema = z.object({
  url: z.string().min(4).max(300),
  title: z.string().max(200).optional(),
  /** Прямой адрес ленты. Пусто — ищем сами. */
  rss: z.string().url().max(500).optional(),
});

adminRouter.post('/sources/website', async (req, res) => {
  const parsed = addSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите адрес сайта' });
    return;
  }

  const raw = parsed.data.url.trim();
  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    res.status(400).json({ error: 'Некорректный адрес' });
    return;
  }

  const key = url.hostname.replace(/^www\./, '');
  const feed = parsed.data.rss ?? (await discoverFeedUrl(url.origin));
  if (!feed) {
    res.status(422).json({
      error:
        'RSS-лента не найдена. Найдите её адрес на сайте и укажите вручную — ' +
        'обычно это /rss, /feed или ссылка в подвале.',
    });
    return;
  }

  const source = await addWebsiteSource(key, parsed.data.title ?? key, url.origin, { rss: feed });
  res.status(201).json({ source, feedUrl: feed });
});

adminRouter.delete('/sources/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  // Удаление вместе с документами подтверждается явно: оно необратимо и
  // уносит извлечённые упоминания и события.
  const withDocuments = req.query.withDocuments === 'true';
  const result = await deleteSource(id, withDocuments);

  if (!result.deleted) {
    res.status(409).json({ error: result.reason, documentCount: result.documentCount });
    return;
  }
  res.json({ ok: true, documentCount: withDocuments ? result.documentCount : 0 });
});

adminRouter.get('/merges', async (_req, res) => {
  res.json({ items: await listPendingMerges() });
});

const decisionSchema = z.object({ decidedBy: z.string().min(1).max(100).default('admin') });

adminRouter.post('/merges/:id/merge', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  try {
    const result = await applyMerge({ queueId: id, decidedBy: parsed.data.decidedBy });
    res.json(result);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

adminRouter.post('/merges/:id/reject', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = decisionSchema.safeParse(req.body ?? {});
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  try {
    await rejectMerge(id, parsed.data.decidedBy);
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

adminRouter.post('/metrics/refresh', async (_req, res) => {
  const ms = await refreshCompanyMetrics();
  res.json({ ok: true, durationMs: ms, skipped: ms === null });
});

/** Состояние пайплайна: что в очереди и насколько плох текущий промпт. */
adminRouter.get('/pipeline', async (_req, res) => {
  const queue = await query(
    `SELECT status, count(*)::int AS n FROM raw_documents GROUP BY status ORDER BY n DESC`,
  );
  const extractions = await query(
    `SELECT prompt_version AS "promptVersion", model, status, count(*)::int AS n
     FROM extractions GROUP BY prompt_version, model, status
     ORDER BY prompt_version DESC, n DESC`,
  );
  const rejected = await query(
    `SELECT type, count(*)::int AS n FROM events WHERE status = 'rejected' GROUP BY type`,
  );
  res.json({ queue, extractions, rejectedEvents: rejected });
});
