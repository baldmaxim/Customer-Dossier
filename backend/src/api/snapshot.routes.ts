// Схема связей и снимки досье (этап 08B). Доступ — после входа оператора; изменяющие запросы — с CSRF.
// Выгрузки строятся из выбранного снимка, отдаются как вложение без кэширования; публичной папки нет.
// Флаг GRAPH_EXPORT_ENABLED=false отключает схему, создание снимков, вымарывание и экспорт; прежние снимки читаются.

import { z } from 'zod';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { HistoricalCutoffError } from '../snapshot/build.js';
import { snapshotToHtml, snapshotToJson, snapshotToMarkdown } from '../snapshot/export.js';
import { SnapshotKeyConflictError } from '../snapshot/requestIdentity.js';
import { createSnapshot, listSnapshots, readSnapshot, redactSnapshotEvidence, SnapshotNotFoundError } from '../snapshot/repository.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const snapshotRouter = asyncRouter();

const idOf = (raw: string | undefined): number | null => {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const disabled = (res: import('express').Response): boolean => {
  if (env.GRAPH_EXPORT_ENABLED) return false;
  res.status(404).json({ error: 'Схема и выгрузки отключены (GRAPH_EXPORT_ENABLED=false)', code: 'feature_disabled' });
  return true;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  effectiveFrom: date.nullish().transform(v => v ?? null),
  effectiveTo: date.nullish().transform(v => v ?? null),
  /** Только текущий момент: срез прошлого без истории не создаётся. */
  knowledgeCutoff: z.string().datetime({ offset: true }).nullish().transform(v => v ?? null),
  idempotencyKey: z.string().min(8).max(200).nullish().transform(v => v ?? null),
});

snapshotRouter.post('/cases/:id/snapshots', async (req, res) => {
  if (disabled(res)) return;
  const caseId = idOf(req.params.id);
  const parsed = createSchema.safeParse(req.body ?? {});
  if (caseId === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры снимка' });
    return;
  }
  if (parsed.data.effectiveFrom && parsed.data.effectiveTo && parsed.data.effectiveTo < parsed.data.effectiveFrom) {
    res.status(400).json({ error: 'Конец периода раньше начала' });
    return;
  }
  try {
    const result = await createSnapshot({ caseId, ...parsed.data, actor: 'operator' });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof HistoricalCutoffError) {
      res.status(422).json({ error: err.message, code: 'historical_cutoff_unsupported' });
      return;
    }
    if (err instanceof SnapshotKeyConflictError) {
      res.status(409).json({ error: err.message, code: 'idempotency_key_conflict' });
      return;
    }
    if (err instanceof SnapshotNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

snapshotRouter.get('/cases/:id/snapshots', async (req, res) => {
  const caseId = idOf(req.params.id);
  if (caseId === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json({ items: await listSnapshots(caseId) });
});

snapshotRouter.get('/snapshots/:id', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const view = await readSnapshot(id);
  if (!view) {
    res.status(404).json({ error: 'Снимок не найден' });
    return;
  }
  res.json(view);
});

const FORMATS = {
  md: { type: 'text/markdown; charset=utf-8', ext: 'md' },
  json: { type: 'application/json; charset=utf-8', ext: 'json' },
  html: { type: 'text/html; charset=utf-8', ext: 'html' },
} as const;

snapshotRouter.get('/snapshots/:id/export.:format', async (req, res) => {
  if (disabled(res)) return;
  const id = idOf(req.params.id);
  const format = req.params.format as keyof typeof FORMATS;
  if (id === null || !(format in FORMATS)) {
    res.status(400).json({ error: 'Некорректный формат выгрузки' });
    return;
  }
  const view = await readSnapshot(id);
  if (!view) {
    res.status(404).json({ error: 'Снимок не найден' });
    return;
  }
  const body =
    format === 'md' ? snapshotToMarkdown(view.meta, view.payload) : format === 'json' ? snapshotToJson(view.meta, view.payload, view.availability) : snapshotToHtml(view.meta, view.payload);
  res.setHeader('Content-Type', FORMATS[format].type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // HTML «Версия для печати» открывается во вкладке; остальное — файлом. Скрипты в HTML запрещены и заголовком.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'; sandbox");
  res.setHeader('Content-Disposition', `${format === 'html' && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="dossier-snapshot-${id}.${FORMATS[format].ext}"`);
  res.send(body);
});

const redactSchema = z.object({ evidenceId: z.number().int().positive(), reason: z.string().trim().min(3).max(2000) });

snapshotRouter.post('/snapshots/:id/redactions', async (req, res) => {
  if (disabled(res)) return;
  const id = idOf(req.params.id);
  const parsed = redactSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите доказательство и причину вымарывания' });
    return;
  }
  try {
    const result = await redactSnapshotEvidence({ snapshotId: id, ...parsed.data, actor: 'operator' });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof SnapshotNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});
