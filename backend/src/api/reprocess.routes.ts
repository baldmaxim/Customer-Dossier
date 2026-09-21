// Новый конвейер: запуски, предпросмотр набора кандидатов и публикация.
// Доступ — после входа оператора; изменяющие запросы — с CSRF (app.ts).
// Этап 15B: список с фильтрами и курсором, карточка запуска, точечные enqueue/retry/cancel, публикация с токеном предпросмотра.

import type { Response } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import {
  NotPublishableError,
  PublicationConflictError,
  PublishPreviewStaleError,
  previewCandidateSet,
  publishCandidateSet,
} from '../reprocess/publish.js';
import { lmStudioProvider } from '../reprocess/provider.js';
import {
  RUN_PAGE_LIMIT,
  RUN_STATUSES,
  RunNotFoundError,
  cancelRun,
  enqueueRevision,
  getRunDetail,
  listRuns,
  retryRunOnce,
} from '../reprocess/workbench.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const reprocessRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const runsSchema = z.object({
  sourceId: z.coerce.number().int().positive().optional(),
  sourceItemId: z.coerce.number().int().positive().optional(),
  revisionId: z.coerce.number().int().positive().optional(),
  status: z.enum(RUN_STATUSES).optional(),
  schemaVersion: z.string().trim().min(1).max(40).optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{4,64}$/).optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(RUN_PAGE_LIMIT).default(50),
});

reprocessRouter.get('/reprocess/runs', async (req, res) => {
  const parsed = runsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const page = await listRuns(parsed.data);
  // runs — прежнее имя поля (этап 03B); worker — кто выполнит поставленное.
  res.json({ ...page, runs: page.items, worker: { pipelineEnabled: env.PIPELINE_ENABLED, autoPublish: env.REPROCESS_AUTO_PUBLISH } });
});

/**
 * Журнал публикаций: что ушло в карточки, что не ушло и почему.
 * Таблица append-only (миграция 013) — здесь только чтение.
 */
reprocessRouter.get('/reprocess/publications', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const items = await query(
    `SELECT h.id, h.action, h.actor, h.note, h.created_at AS "createdAt",
            h.from_set_id AS "fromSetId", h.to_set_id AS "toSetId",
            h.source_item_id AS "sourceItemId",
            s.title AS "sourceTitle", s.key AS "sourceKey",
            cs.run_id AS "runId"
     FROM publication_history h
     JOIN source_items i ON i.id = h.source_item_id
     JOIN sources s ON s.id = i.source_id
     LEFT JOIN candidate_sets cs ON cs.id = h.to_set_id
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT $1`,
    [limit],
  );
  res.json({ items, limit });
});

reprocessRouter.get('/reprocess/runs/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный запуск' });
    return;
  }
  try {
    res.json(await getRunDetail(id));
  } catch (err) {
    if (err instanceof RunNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

const ENQUEUE_STATUS: Record<string, number> = { queued: 201, already_live: 200, already_retried: 200, refused_policy: 422, not_found: 404, not_retryable: 409 };

const ENQUEUE_ERROR: Record<string, string> = {
  refused_policy: 'ИИ-обработка источника не допущена',
  not_found: 'Редакция или запуск не найдены',
  not_retryable: 'Этот запуск не повторяется',
};

/**
 * Отказ — не молчаливый номер статуса: причина словами в `error` и машинный код в `code`, как в остальных
 * маршрутах. Тело успешных исходов не меняется: клиент читает `outcome`, `runId` и `pipelineEnabled`.
 */
const sendEnqueue = (res: Response, result: { outcome: string; reason?: string }): void => {
  const status = ENQUEUE_STATUS[result.outcome] ?? 200;
  const body: Record<string, unknown> = { ...result, pipelineEnabled: env.PIPELINE_ENABLED };
  if (status >= 400) {
    body.code = result.outcome;
    body.error = result.reason ?? ENQUEUE_ERROR[result.outcome] ?? 'Запуск не поставлен';
  }
  res.status(status).json(body);
};

reprocessRouter.post('/reprocess/revisions/:id/runs', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректная редакция' });
    return;
  }
  // Постановка не вызывает модель: выполнит worker (PIPELINE_ENABLED) или `pipeline:once`.
  const result = await enqueueRevision(id, lmStudioProvider(), 'operator');
  sendEnqueue(res, result);
});

reprocessRouter.post('/reprocess/runs/:id/retry', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный запуск' });
    return;
  }
  const result = await retryRunOnce(id, lmStudioProvider(), 'operator');
  sendEnqueue(res, result);
});

reprocessRouter.post('/reprocess/runs/:id/cancel', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный запуск' });
    return;
  }
  const result = await cancelRun(id, 'operator');
  if (result.outcome === 'not_found') {
    res.status(404).json({ error: `Запуск #${id} не найден` });
  } else if (result.outcome === 'not_cancellable') {
    res.status(409).json({ ...result, error: `Запуск в статусе ${result.status} уже завершён`, code: 'not_cancellable' });
  } else {
    res.json({
      ...result,
      note: result.inFlight
        ? 'Запрос к модели мог уже уйти: отменить его нельзя, но ответ не будет записан и следующий чанк не отправится.'
        : 'Дальнейших вызовов модели по этому запуску не будет.',
    });
  }
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
  // Этап 15B: публикуется ровно то, что оператор видел в предпросмотре.
  expectedPreviewToken: z.string().regex(/^[0-9a-f]{64}$/),
  allowStale: z.boolean().default(false),
});

reprocessRouter.post('/reprocess/sets/:id/publish', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = publishSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ожидаемую версию публикации и токен предпросмотра' });
    return;
  }
  try {
    const result = await publishCandidateSet({ setId: id, actor: 'operator', ...parsed.data });
    // Отказ политики или устаревший разбор — не ошибка запроса, а решение: 200 с outcome.
    res.json(result);
  } catch (err) {
    if (err instanceof PublicationConflictError) {
      res.status(409).json({ error: err.message, code: 'version_conflict', currentVersion: err.currentVersion, nextStep: 'Обновите предпросмотр.' });
      return;
    }
    if (err instanceof PublishPreviewStaleError) {
      res.status(409).json({ error: err.message, code: 'preview_stale', nextStep: err.nextStep });
      return;
    }
    if (err instanceof NotPublishableError) {
      res.status(422).json({ error: err.message, code: 'not_publishable', nextStep: err.nextStep });
      return;
    }
    throw err;
  }
});
