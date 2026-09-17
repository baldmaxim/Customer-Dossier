// Новый конвейер: запуски, предпросмотр набора кандидатов и публикация.
// Доступ — после входа оператора; изменяющие запросы — с CSRF (app.ts).
// Этап 15B: список с фильтрами и курсором, карточка запуска, точечные enqueue/retry/cancel, публикация с токеном предпросмотра.

import { z } from 'zod';

import { env } from '../config/env.js';
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

reprocessRouter.post('/reprocess/revisions/:id/runs', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректная редакция' });
    return;
  }
  // Постановка не вызывает модель: выполнит worker (PIPELINE_ENABLED) или `pipeline:once`.
  const result = await enqueueRevision(id, lmStudioProvider(), 'operator');
  res.status(ENQUEUE_STATUS[result.outcome] ?? 200).json({ ...result, pipelineEnabled: env.PIPELINE_ENABLED });
});

reprocessRouter.post('/reprocess/runs/:id/retry', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный запуск' });
    return;
  }
  const result = await retryRunOnce(id, lmStudioProvider(), 'operator');
  res.status(ENQUEUE_STATUS[result.outcome] ?? 200).json({ ...result, pipelineEnabled: env.PIPELINE_ENABLED });
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
