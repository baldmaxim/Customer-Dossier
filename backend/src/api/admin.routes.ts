// Админка: источники, их допуск и очередь слияний.
//
// Все маршруты — только для вошедшего оператора (см. app.ts, auth.ts).
// Изменяющие канон операции (слияние, удаление с документами) заблокированы
// до безопасного пути записи — см. pipeline/guard.ts.

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { query, execute } from '../db/pool.js';
import { rejectMerge, listPendingMerges } from '../resolve/merge.js';
import {
  SourcePolicyValidationError,
  addTelegramSource,
  addWebsiteSource,
  deleteSource,
  updateSourcePolicy,
} from '../ingest/sources.js';
import { PERMISSION_STATUSES, evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';
import { refreshCompanyMetrics } from '../metrics/refresh.js';
import { DELETE_WITH_DOCUMENTS_BLOCK_REASON } from '../pipeline/guard.js';

export const adminRouter = asyncRouter();

interface ISourceAdminRow {
  id: number;
  key: string;
  accessStatus: PermissionStatus;
  aiProcessingStatus: PermissionStatus;
  policyExpiresAt: string | null;
  [column: string]: unknown;
}

adminRouter.get('/sources', async (_req, res) => {
  const rows = await query<ISourceAdminRow>(
    `SELECT s.id, s.kind, s.key, s.title, s.status, s.cursor,
            s.poll_interval_sec AS "pollIntervalSec",
            s.next_run_at AS "nextRunAt", s.last_ok_at AS "lastOkAt",
            s.fail_streak AS "failStreak",
            s.access_status AS "accessStatus", s.ai_processing_status AS "aiProcessingStatus",
            s.policy_scope AS "policyScope", s.policy_basis AS "policyBasis",
            s.policy_reference AS "policyReference", s.policy_owner AS "policyOwner",
            s.policy_decided_at AS "policyDecidedAt", s.policy_expires_at AS "policyExpiresAt",
            s.is_synthetic AS "isSynthetic",
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

  // Причины блокировки считает тот же код, что и gate на входах.
  const items = rows.map(row => ({
    ...row,
    collectBlockedReason: evaluateSourcePolicy(row, 'collect').reason,
    aiBlockedReason: evaluateSourcePolicy(row, 'ai_processing').reason,
  }));
  res.json({ items });
});

/**
 * Здоровье источника: запуски, публикации, редакции, полнота текущих версий.
 * Нулевое число публикаций — не «источник пуст», а повод смотреть запуски и допуск.
 */
adminRouter.get('/sources/:id/health', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const source = await query<ISourceAdminRow>(
    `SELECT id, key, status, fail_streak AS "failStreak", last_ok_at AS "lastOkAt",
            access_status AS "accessStatus", ai_processing_status AS "aiProcessingStatus",
            policy_expires_at AS "policyExpiresAt"
     FROM sources WHERE id = $1`,
    [id],
  );
  const row = source[0];
  if (!row) {
    res.status(404).json({ error: 'Источник не найден' });
    return;
  }
  const runs = await query(
    `SELECT started_at AS "startedAt", finished_at AS "finishedAt", status, items_seen AS "itemsSeen",
            items_new AS "itemsNew", http_status AS "httpStatus", error, layout_stats AS "layoutStats"
     FROM source_runs WHERE source_id = $1 ORDER BY started_at DESC LIMIT 10`,
    [id],
  );
  const items = await query(
    `SELECT count(*)::int AS items,
            count(*) FILTER (WHERE i.state = 'deleted_observed')::int AS "deletedObserved",
            count(*) FILTER (WHERE i.history_before_import = 'unknown')::int AS "historyUnknown",
            count(*) FILTER (WHERE (SELECT count(*) FROM document_revisions r WHERE r.source_item_id = i.id) > 1)::int
              AS "withSeveralRevisions",
            max(i.last_observed_at) AS "lastObservedAt"
     FROM source_items i WHERE i.source_id = $1`,
    [id],
  );
  const completeness = await query(
    `SELECT lr.completeness, count(*)::int AS n
     FROM source_items i JOIN document_revisions lr ON lr.id = i.latest_revision_id
     WHERE i.source_id = $1 GROUP BY lr.completeness ORDER BY n DESC`,
    [id],
  );
  res.json({
    source: row,
    collectBlockedReason: evaluateSourcePolicy(row, 'collect').reason,
    aiBlockedReason: evaluateSourcePolicy(row, 'ai_processing').reason,
    runs,
    items: items[0] ?? null,
    latestCompleteness: completeness,
  });
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
  // Сам по себе active сбор не разрешает — нужен допуск (access_status).
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

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform(v => (v === undefined || v === null || v.trim() === '' ? null : v.trim()));

const policySchema = z.object({
  accessStatus: z.enum(PERMISSION_STATUSES),
  aiProcessingStatus: z.enum(PERMISSION_STATUSES),
  scope: optionalText(2000),
  basis: optionalText(2000),
  reference: optionalText(1000),
  owner: optionalText(200),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullish()
    .transform(v => (v ? new Date(v) : null)),
});

adminRouter.patch('/sources/:id/policy', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = policySchema.safeParse(req.body);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры допуска' });
    return;
  }
  try {
    const source = await updateSourcePolicy(id, parsed.data, 'operator');
    if (!source) {
      res.status(404).json({ error: 'Источник не найден' });
      return;
    }
    res.json({ source });
  } catch (err) {
    if (err instanceof SourcePolicyValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
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
  /** Прямой адрес ленты. Пусто — найдётся при первом разрешённом проходе. */
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
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    res.status(400).json({ error: 'Допустимы только http и https' });
    return;
  }

  // Никаких сетевых запросов при добавлении: поиск ленты — уже сбор, а допуска
  // у нового источника ещё нет.
  const key = url.hostname.replace(/^www\./, '');
  const source = await addWebsiteSource(
    key,
    parsed.data.title ?? key,
    url.origin,
    parsed.data.rss ? { rss: parsed.data.rss } : {},
  );
  res.status(201).json({ source, feedUrl: parsed.data.rss ?? null });
});

adminRouter.delete('/sources/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  if (req.query.withDocuments === 'true') {
    res.status(423).json({ error: DELETE_WITH_DOCUMENTS_BLOCK_REASON, code: 'blocked' });
    return;
  }
  const result = await deleteSource(id, false);

  if (!result.deleted) {
    res.status(409).json({ error: result.reason, documentCount: result.documentCount });
    return;
  }
  res.json({ ok: true, documentCount: 0 });
});

adminRouter.get('/merges', async (_req, res) => {
  res.json({ items: await listPendingMerges() });
});

const decisionSchema = z.object({ decidedBy: z.string().min(1).max(100).default('operator') });

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
