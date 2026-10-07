// «Новое» на портале (этап 24F): лента за окно дней — новые объекты, переносы сроков ДОМ.РФ, новые дела и
// производства ФССП. Только чтение (portal.read): «просмотрено до» хранит браузер читателя, сервер не пишет ничего.

import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { loadNews, NEWS_KINDS, type NewsKind, type NewsScope } from '../news/feed.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { registerReadCache } from '../utils/readCaches.js';
import { ttlCache } from '../utils/ttlCache.js';

export const newsRouter = asyncRouter();

/**
 * Лента одна для всех читателей и считается по снимкам реестра и проверок: одинаковый запрос минуту отдаётся из
 * памяти (07.10.2026) — её запрашивает и счётчик меню при каждом открытии портала. Окно отсчитывается от момента
 * расчёта; изменение через API сбрасывает кэш сразу (utils/readCaches.ts).
 */
const newsCache = ttlCache(
  (q: { days: number; scope: NewsScope; kind: NewsKind | undefined }) =>
    loadNews(getPool(), { since: new Date(Date.now() - q.days * 86_400_000), scope: q.scope, kinds: q.kind ? [q.kind] : undefined }),
  { ttlMs: 60_000, max: 18, keyOf: q => JSON.stringify([q.days, q.scope, q.kind ?? null]) },
);
registerReadCache(newsCache.clear);

/** Окна ленты, дней. */
export const NEWS_WINDOWS = [7, 14, 30] as const;
const DEFAULT_DAYS = 14;

const feedSchema = z.object({
  days: z.coerce.number().int().refine(d => (NEWS_WINDOWS as readonly number[]).includes(d)).default(DEFAULT_DAYS),
  scope: z.enum(['all', 'watched']).default('all'),
  kind: z.enum(NEWS_KINDS).optional(),
});

newsRouter.get('/news', async (req, res) => {
  const parsed = feedSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры', code: 'bad_request' });
    return;
  }
  const { days, scope, kind } = parsed.data;
  const feed = await newsCache.get({ days, scope, kind: kind as NewsKind | undefined });
  res.json({ ...feed, days });
});
