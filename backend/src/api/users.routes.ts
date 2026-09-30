// Пользователи, сессии, заявки на доступ и журнал входа — для администратора (право users.manage,
// auth/routePolicy.ts). Правила (последний администратор, себя не выключить, ожидаемая версия,
// решение по заявке) — в auth/service.ts. Заявку подаёт сам человек: POST /api/auth/register (api/auth.ts).

import type { IRouter, Request, Response } from 'express';
import { z } from 'zod';

import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../auth/permissions.js';
import { actorOfContext, LOCAL_CONTEXT, type AuthService, type IServiceError } from '../auth/service.js';
import { asyncRouter } from '../utils/asyncRouter.js';
import { requestMeta } from './auth.js';

const idParam = (raw: string | undefined): number | null => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const actorOf = (req: Request) => actorOfContext(req.auth ?? LOCAL_CONTEXT);

const sendError = (res: Response, err: IServiceError): void => {
  res.status(err.status).json({ error: err.error, code: err.code });
};

const createSchema = z.object({
  login: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200),
  role: z.enum(ROLES),
  password: z.string().min(1).max(1024),
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().min(1).max(200).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const passwordSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

// Роль при одобрении — по умолчанию «читатель»: шире права выдаются явно.
const approveSchema = z.object({ expectedVersion: z.number().int().positive(), role: z.enum(ROLES).default('viewer') }).strict();

const rejectSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();

const eventsQuery = z.object({
  userId: z.coerce.number().int().positive().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const createUsersRouter = (service: AuthService): IRouter => {
  const router = asyncRouter();

  router.get('/users', async (_req, res) => {
    res.json({ items: await service.listUsers() });
  });

  /** Роли и их права — для таблицы на экране. Подписи — в labels.ts фронтенда. */
  router.get('/users/roles', (_req, res) => {
    res.json({ permissions: PERMISSIONS, roles: ROLES.map(role => ({ role, permissions: ROLE_PERMISSIONS[role] })) });
  });

  router.get('/users/events', async (req, res) => {
    const parsed = eventsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Некорректные параметры', code: 'invalid_query' });
      return;
    }
    const { userId, before, limit } = parsed.data;
    const items = await service.listEvents({ userId, beforeId: before, limit });
    res.json({ items, nextBefore: items.length === limit ? (items[items.length - 1]?.id ?? null) : null });
  });

  router.post('/users', async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Укажите логин, имя, роль и пароль', code: 'invalid' });
      return;
    }
    const result = await service.createUser(actorOf(req), parsed.data, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.status(201).json(result.user);
  });

  router.get('/users/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const user = id === null ? null : await service.getUser(id);
    if (!user) {
      res.status(404).json({ error: 'Пользователь не найден', code: 'not_found' });
      return;
    }
    res.json(user);
  });

  router.patch('/users/:id', async (req, res) => {
    const id = idParam(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Некорректные параметры', code: 'invalid' });
      return;
    }
    const result = await service.updateUser(actorOf(req), id, parsed.data, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.json(result.user);
  });

  router.post('/users/:id/password', async (req, res) => {
    const id = idParam(req.params.id);
    const parsed = passwordSchema.safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Укажите новый пароль', code: 'invalid' });
      return;
    }
    const result = await service.resetPassword(actorOf(req), id, parsed.data.password, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.json(result.user);
  });

  router.post('/users/:id/approve', async (req, res) => {
    const id = idParam(req.params.id);
    const parsed = approveSchema.safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Некорректные параметры', code: 'invalid' });
      return;
    }
    const result = await service.approveRegistration(actorOf(req), id, parsed.data, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.json(result.user);
  });

  router.post('/users/:id/reject', async (req, res) => {
    const id = idParam(req.params.id);
    const parsed = rejectSchema.safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Некорректные параметры', code: 'invalid' });
      return;
    }
    const result = await service.rejectRegistration(actorOf(req), id, parsed.data, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.json(result.user);
  });

  router.get('/users/:id/sessions', async (req, res) => {
    const id = idParam(req.params.id);
    const sessions = id === null ? null : await service.listSessions(id);
    if (!sessions) {
      res.status(404).json({ error: 'Пользователь не найден', code: 'not_found' });
      return;
    }
    const current = req.auth?.sessionId ?? null;
    res.json({ items: sessions.map(s => ({ ...s, current: s.id === current })) });
  });

  router.post('/users/:id/sessions/:sessionId/revoke', async (req, res) => {
    const id = idParam(req.params.id);
    const sessionId = idParam(req.params.sessionId);
    if (id === null || sessionId === null) {
      res.status(400).json({ error: 'Некорректные параметры', code: 'invalid' });
      return;
    }
    const result = await service.revokeSession(actorOf(req), id, sessionId, requestMeta(req));
    if (!result.ok) {
      sendError(res, result);
      return;
    }
    res.json({ ok: true });
  });

  return router;
};
