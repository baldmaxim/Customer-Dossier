// Сайты компаний (этап 25A, ADR-018): карточка компании, очередь «Сайты компаний» и решения оператора.
// Чтение карточки — portal.read, очереди — admin.view; поиск, «Указать вручную» и решения — sources.manage
// (auth/routePolicy.ts): поиск стоит денег, а подтверждённый сайт в 25B станет источником.
// Сети здесь нет: поиск ставит компанию в начало очереди, проверку делает проход в тике сбора.

import type { Response } from 'express';
import { z } from 'zod';

import { env } from '../config/env.js';
import { loadCompanySiteProjects } from '../companySites/readModel.js';
import { siteSearchMode } from '../companySites/search.js';
import {
  CompanySiteError,
  companySitesTotals,
  confirmSiteCandidate,
  linkSiteManually,
  listCompanySites,
  loadCompanySites,
  rejectSiteCandidate,
  requestSiteSearch,
  type CompanySitesFilter,
} from '../companySites/store.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { actorOf } from './auth.js';

const STATUS: Record<CompanySiteError['code'], number> = { not_found: 404, already_decided: 409, invalid: 422 };

const FILTERS: readonly CompanySitesFilter[] = ['pending', 'confirmed', 'notFound', 'all'];

const manualSchema = z.object({ url: z.string().trim().min(1).max(1000) }).strict();
const rejectSchema = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();

const idOf = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const sendError = (res: Response, err: unknown): void => {
  if (err instanceof CompanySiteError) {
    res.status(STATUS[err.code]).json({ error: err.message, code: err.code });
    return;
  }
  throw err;
};

export const companySitesRouter = asyncRouter();

companySitesRouter.get('/companies/:id/site', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный номер компании' });
    return;
  }
  res.json({ mode: siteSearchMode(), ...(await loadCompanySites(id)) });
});

/** Для входа на вкладке «Сайты»: включён ли поиск, расход за сутки и счётчики — без списка компаний. */
/** Проекты с подтверждённых сайтов компании (25B): для вкладки «Объекты» и строки на «Сведениях». */
companySitesRouter.get('/companies/:id/site-projects', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный номер компании' });
    return;
  }
  res.json(await loadCompanySiteProjects(id));
});

companySitesRouter.get('/admin/company-sites/summary', async (_req, res) => {
  res.json({ mode: siteSearchMode(), dailyLimit: env.SITE_SEARCH_DAILY_LIMIT, totals: await companySitesTotals() });
});

companySitesRouter.get('/admin/company-sites', async (req, res) => {
  const filter = FILTERS.find(f => f === req.query.filter) ?? 'pending';
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
  const list = await listCompanySites({ filter, q });
  res.json({ mode: siteSearchMode(), dailyLimit: env.SITE_SEARCH_DAILY_LIMIT, ...list });
});

/** «Искать снова» / «Искать сейчас»: компания — в начало очереди. Поиск выключен — встанет, но пойдёт после включения. */
companySitesRouter.post('/admin/company-sites/:companyId/search', async (req, res) => {
  const companyId = idOf(req.params.companyId);
  if (companyId === null || !(await requestSiteSearch(companyId, actorOf(req)))) {
    res.status(404).json({ error: 'Компания не найдена', code: 'not_found' });
    return;
  }
  res.json({ queued: true, mode: siteSearchMode() });
});

companySitesRouter.post('/admin/company-sites/:companyId/manual', async (req, res) => {
  const companyId = idOf(req.params.companyId);
  const parsed = manualSchema.safeParse(req.body);
  if (companyId === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите адрес сайта' });
    return;
  }
  try {
    res.json(await linkSiteManually(companyId, parsed.data.url, actorOf(req)));
  } catch (err) {
    sendError(res, err);
  }
});

companySitesRouter.post('/admin/company-site-candidates/:id/confirm', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный номер кандидата' });
    return;
  }
  try {
    res.json(await confirmSiteCandidate(id, actorOf(req)));
  } catch (err) {
    sendError(res, err);
  }
});

companySitesRouter.post('/admin/company-site-candidates/:id/reject', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  try {
    res.json(await rejectSiteCandidate(id, actorOf(req), parsed.data.note ?? null));
  } catch (err) {
    sendError(res, err);
  }
});
