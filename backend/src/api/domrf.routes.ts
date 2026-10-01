// Объекты, найденные на страницах застройщика и группы ДОМ.РФ, и заказчики портала в реестре застройщиков
// (этап 20D): списки и решения оператора.
// Чтение — admin.view, решения — sources.manage (auth/routePolicy.ts), как и ссылки ДОМ.РФ.
// Сети здесь нет: подтверждение ставит ссылку в очередь, страницу открывает браузерный работник.

import type { Response } from 'express';
import { z } from 'zod';

import {
  DomRfCandidateError,
  confirmDomRfCandidate,
  confirmDomRfCandidates,
  listDomRfCandidates,
  rejectDomRfCandidate,
  replaceDomRfCandidate,
} from '../ingest/registry/domrfCandidates.js';
import {
  DomRfCompanyError,
  confirmDomRfCompanyLink,
  linkDomRfCompanyManually,
  listDomRfCompanies,
  rejectDomRfCompanyLink,
  requestDomRfCompanySearch,
} from '../ingest/registry/domrfCompanies.js';
import { DomRfTargetError } from '../ingest/registry/domrfTargets.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { actorOf } from './auth.js';

const projectId = z.number().int().positive().nullable().optional();
const confirmSchema = z.object({ projectId }).strict();
const rejectSchema = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();
const replaceSchema = z.object({ url: z.string().trim().min(1).max(1000), projectId }).strict();
const batchSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).strict();

const STATUS: Record<DomRfCandidateError['code'], number> = { not_found: 404, already_decided: 409, invalid: 422 };

const idOf = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Отказ решения — словами оператору; прочее — внутренняя ошибка. */
const sendDecisionError = (res: Response, err: unknown): void => {
  if (err instanceof DomRfCandidateError) {
    res.status(STATUS[err.code]).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof DomRfCompanyError) {
    res.status(STATUS[err.code]).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof DomRfTargetError) {
    res.status(422).json({ error: err.message, code: 'invalid' });
    return;
  }
  throw err;
};

export const domrfRouter = asyncRouter();

domrfRouter.get('/domrf-candidates', async (req, res) => {
  res.json(await listDomRfCandidates(req.query.state === 'decided' ? 'decided' : 'pending'));
});

/** Подтверждение пачкой: каждый кандидат — своим решением, отказ одного не останавливает остальные. */
domrfRouter.post('/domrf-candidates/confirm', async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Выберите от 1 до 500 найденных объектов' });
    return;
  }
  res.json(await confirmDomRfCandidates(parsed.data.ids, actorOf(req)));
});

domrfRouter.post('/domrf-candidates/:id/confirm', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = confirmSchema.safeParse(req.body ?? {});
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  try {
    await confirmDomRfCandidate(id, actorOf(req), parsed.data.projectId ?? null);
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

domrfRouter.post('/domrf-candidates/:id/reject', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  try {
    await rejectDomRfCandidate(id, actorOf(req), parsed.data.note ?? null);
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

domrfRouter.post('/domrf-candidates/:id/replace', async (req, res) => {
  const id = idOf(req.params.id);
  const parsed = replaceSchema.safeParse(req.body);
  if (id === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ссылку на правильную карточку объекта' });
    return;
  }
  try {
    await replaceDomRfCandidate(id, actorOf(req), parsed.data.url, parsed.data.projectId ?? null);
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

// ─── Компании в реестре застройщиков (шаг 2) ──────────────────────────────────────────────

const linkSchema = z.object({ url: z.string().trim().min(1).max(1000) }).strict();

const companiesQuerySchema = z.object({
  filter: z.enum(['pending', 'notFound', 'confirmed', 'all']).default('pending'),
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

domrfRouter.get('/domrf-companies', async (req, res) => {
  const parsed = companiesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректный фильтр списка компаний' });
    return;
  }
  res.json(await listDomRfCompanies(parsed.data));
});

domrfRouter.post('/domrf-company-links/:id/confirm', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  try {
    await confirmDomRfCompanyLink(id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

domrfRouter.post('/domrf-company-links/:id/reject', async (req, res) => {
  const id = idOf(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  try {
    await rejectDomRfCompanyLink(id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

/** «Указать вручную»: страница застройщика или группы по ссылке оператора — сразу подтверждённой. */
domrfRouter.post('/domrf-companies/:companyId/link', async (req, res) => {
  const companyId = idOf(req.params.companyId);
  const parsed = linkSchema.safeParse(req.body);
  if (companyId === null || !parsed.success) {
    res.status(400).json({ error: 'Укажите ссылку на страницу застройщика или группы компаний' });
    return;
  }
  try {
    await linkDomRfCompanyManually(companyId, parsed.data.url, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendDecisionError(res, err);
  }
});

/** «Искать снова» / «Искать сейчас»: компания встаёт в начало очереди поиска. */
domrfRouter.post('/domrf-companies/:companyId/search', async (req, res) => {
  const companyId = idOf(req.params.companyId);
  if (companyId === null) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  if (!(await requestDomRfCompanySearch(companyId))) {
    res.status(404).json({ error: `Компания №${companyId} не найдена или объединена с другой` });
    return;
  }
  res.json({ ok: true });
});
