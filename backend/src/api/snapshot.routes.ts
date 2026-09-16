// Схема связей и снимки досье (этап 08B). Доступ — после входа оператора; изменяющие запросы — с CSRF.
// Выгрузки строятся из выбранного снимка, отдаются как вложение без кэширования; публичной папки нет.
// Флаг GRAPH_EXPORT_ENABLED=false отключает схему, создание снимков, вымарывание и экспорт; прежние снимки читаются.

import { z } from 'zod';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { buildGraph, GRAPH_EDGE_TYPES, type NodeKey } from '../graph/graph.js';
import { graphLoader } from '../graph/load.js';
import { HistoricalCutoffError } from '../snapshot/build.js';
import { snapshotToHtml, snapshotToJson, snapshotToMarkdown } from '../snapshot/export.js';
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

const graphSchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  caseId: z.coerce.number().int().positive().optional(),
  types: z
    .string()
    .optional()
    .transform(v => (v ? v.split(',').filter((t): t is (typeof GRAPH_EDGE_TYPES)[number] => (GRAPH_EDGE_TYPES as readonly string[]).includes(t)) : undefined)),
  reviewedOnly: z.enum(['true', 'false']).optional(),
  includeUnconfirmed: z.enum(['true', 'false']).optional(),
  filterProjectId: z.coerce.number().int().positive().optional(),
  building: z.string().trim().max(120).optional(),
  from: date.optional(),
  to: date.optional(),
  depth: z.coerce.number().int().min(0).max(3).optional(),
  limit: z.coerce.number().int().min(1).max(150).optional(),
});

snapshotRouter.get('/graph', async (req, res) => {
  if (disabled(res)) return;
  const parsed = graphSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры схемы' });
    return;
  }
  const q = parsed.data;
  const seeds: NodeKey[] = [];
  if (q.caseId) {
    const row = (await getPool().query<{ company_id: number | null; project_id: number | null }>('SELECT company_id, project_id FROM dossier_cases WHERE id = $1', [q.caseId])).rows[0];
    if (!row) {
      res.status(404).json({ error: 'Обращение не найдено' });
      return;
    }
    // Приоритет текущему обращению: его компания и объект — узлы-основы.
    if (row.company_id) seeds.push(`c:${row.company_id}`);
    if (row.project_id) seeds.push(`p:${row.project_id}`);
  }
  if (q.companyId) seeds.push(`c:${q.companyId}`);
  if (q.projectId) seeds.push(`p:${q.projectId}`);
  if (seeds.length === 0) {
    res.status(400).json({ error: 'Укажите companyId, projectId или caseId' });
    return;
  }
  const graph = await buildGraph(
    seeds,
    {
      ...(q.types && q.types.length > 0 ? { types: q.types } : {}),
      reviewedOnly: q.reviewedOnly === 'true',
      includeUnconfirmed: q.includeUnconfirmed === 'true',
      projectId: q.filterProjectId ?? null,
      building: q.building || null,
      from: q.from ?? null,
      to: q.to ?? null,
      ...(q.depth !== undefined ? { depth: q.depth } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    },
    graphLoader(getPool()),
  );
  res.json(graph);
});

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
