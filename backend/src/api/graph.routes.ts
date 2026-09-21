// Схема связей — ядро продукта, поэтому у неё свой роутер и свой флаг.
// Раньше `GET /graph` жил в маршрутах снимков и гас вместе с ними.
//
// Правила обхода — ADR-011 и graph/graph.ts: глубина не больше трёх, узлов не
// больше 150, путь А→Б→В не даёт ребра А→В. Здесь только разбор параметров.

import { z } from 'zod';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { buildGraph, GRAPH_EDGE_TYPES, type NodeKey } from '../graph/graph.js';
import { graphLoader } from '../graph/load.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const graphRouter = asyncRouter();

const disabled = (res: import('express').Response): boolean => {
  if (env.GRAPH_ENABLED) return false;
  res.status(404).json({ error: 'Схема связей отключена (GRAPH_ENABLED=false)', code: 'feature_disabled' });
  return true;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const graphSchema = z.object({
  companyId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
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

graphRouter.get('/graph', async (req, res) => {
  if (disabled(res)) return;
  const parsed = graphSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры схемы' });
    return;
  }
  const q = parsed.data;
  // Ровно один центр обхода. Два узла-основы в одном обходе визуально склеивают
  // несвязанные подграфы и читаются как «эти компании связаны» — такого не делаем.
  const seeds: NodeKey[] = [];
  if (q.companyId) seeds.push(`c:${q.companyId}`);
  else if (q.projectId) seeds.push(`p:${q.projectId}`);
  if (seeds.length === 0) {
    res.status(400).json({ error: 'Укажите companyId или projectId' });
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
