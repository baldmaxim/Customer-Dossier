// «Новое» на портале (этап 24F): лента за окно дней — новые объекты, переносы сроков ДОМ.РФ, новые дела и
// производства ФССП. Только чтение (portal.read): «просмотрено до» хранит браузер читателя, сервер не пишет ничего.

import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { loadNews, NEWS_KINDS, type NewsKind } from '../news/feed.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const newsRouter = asyncRouter();

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
  const feed = await loadNews(getPool(), { since: new Date(Date.now() - days * 86_400_000), scope, kinds: kind ? [kind as NewsKind] : undefined });
  res.json({ ...feed, days });
});
