// Объекты, найденные на страницах застройщика и группы ДОМ.РФ (этап 20D): список и решения оператора.
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
