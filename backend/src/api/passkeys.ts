// Ключи доступа (passkey, WebAuthn) — HTTP-слой под /api/auth (ADR-014, дополнение 01.10.2026). Правила —
// auth/passkeys.ts.
//
//   POST   /passkey/options    параметры входа без логина (без сессии)
//   POST   /passkey            вход ключом → cookie сессии, как у входа по паролю
//   GET    /passkeys           свои ключи
//   POST   /passkeys/options   параметры добавления ключа — с текущим паролем
//   POST   /passkeys           добавить ключ
//   DELETE /passkeys/:id       убрать свой ключ
//
// Свои ключи — только вошедшему, изменения — с CSRF-токеном. Ключи чужих пользователей — админка
// (api/users.routes.ts, право users.manage). Без публичного адреса-домена ключи выключены: 404.

import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

import { PASSKEY_NAME_MAX, type PasskeyService } from '../auth/passkeys.js';
import type { IAuthContext } from '../auth/service.js';
import { cookieHeader, createAttachAuth, deny, hasValidCsrf, requestMeta, sessionBody, sessionTokenOf, wrap, type IAuthOptions } from './auth.js';

const b64url = z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/);

/** Ответ navigator.credentials.get() в JSON (@simplewebauthn/browser). Неизвестные поля отбрасываются. */
const authenticationSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64url,
    authenticatorData: b64url,
    signature: b64url,
    userHandle: b64url.nullish().transform(v => v ?? undefined),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.unknown()).default({}),
});

/** Ответ navigator.credentials.create() в JSON. Объект аттестации больше: в нём бывает цепочка сертификатов. */
const registrationSchema = z.object({
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64url,
    attestationObject: z.string().min(1).max(65536).regex(/^[A-Za-z0-9_-]+$/),
    authenticatorData: b64url.optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: b64url.optional(),
  }),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.unknown()).default({}),
});

const loginSchema = z.object({ response: authenticationSchema });
const optionsSchema = z.object({ currentPassword: z.string().min(1).max(1024) });
const addSchema = z.object({ response: registrationSchema, name: z.string().max(PASSKEY_NAME_MAX * 4).default('') });

const LOGIN_REFUSALS = {
  passkey_expired: [400, 'Время на вход вышло — попробуйте ещё раз'],
  passkey_unknown: [401, 'Этого ключа на портале нет — возможно, его убрали. Войдите по паролю'],
  passkey_failed: [401, 'Не удалось войти по ключу доступа'],
} as const;

const disabled: RequestHandler = (_req, res) => deny(res, 404, 'Вход по ключу доступа на этом адресе не настроен', 'passkeys_disabled');

export const createPasskeyRoutes = (options: IAuthOptions, limiter: (limit: number) => RequestHandler): Router => {
  const router = Router();
  const service: PasskeyService | null = options.passkeys ?? null;
  if (options.mode === 'none' || service === null) {
    router.all(['/passkey', '/passkey/options', '/passkeys', '/passkeys/options', '/passkeys/:id'], disabled);
    return router;
  }
  const attach = createAttachAuth(options);

  /** Только вошедшему; изменение — ещё и с CSRF-токеном. */
  const owner = (write: boolean, handler: (req: Request, res: Response, ctx: IAuthContext) => Promise<void>): RequestHandler =>
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const ctx = req.auth;
      if (!ctx) {
        deny(res, 401, 'Нужен вход', 'auth_required');
        return;
      }
      if (write && !hasValidCsrf(req, ctx)) {
        deny(res, 403, 'Нет или неверный CSRF-токен', 'csrf');
        return;
      }
      await handler(req, res, ctx);
    });

  router.post(
    '/passkey/options',
    limiter(30),
    wrap(async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ options: await service.loginOptions() });
    }),
  );

  router.post(
    '/passkey',
    limiter(20),
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        deny(res, 400, 'Ответ устройства не распознан', 'invalid');
        return;
      }
      const response = parsed.data.response as AuthenticationResponseJSON;
      const result = await service.login(response, requestMeta(req), sessionTokenOf(req, options));
      if (!result.ok) {
        const [status, error] = LOGIN_REFUSALS[result.code];
        // credentialId — чтобы браузер убрал из менеджера паролей ключ, которого на портале больше нет.
        res.status(status).json({ error, code: result.code, ...(result.code === 'passkey_unknown' ? { credentialId: result.credentialId, rpId: service.rpId } : {}) });
        return;
      }
      res.setHeader('Set-Cookie', cookieHeader(options, result.token, options.maxAgeSec));
      res.json({ ...sessionBody(result.context, true), passkeys: true });
    }),
  );

  router.get(
    '/passkeys',
    attach,
    owner(false, async (_req, res, ctx) => {
      const result = await service.listOwn(ctx);
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.json({ items: result.items });
    }),
  );

  router.post(
    '/passkeys/options',
    limiter(20),
    attach,
    owner(true, async (req, res, ctx) => {
      const parsed = optionsSchema.safeParse(req.body);
      if (!parsed.success) {
        deny(res, 400, 'Укажите текущий пароль', 'invalid');
        return;
      }
      const result = await service.registrationOptions(ctx, parsed.data.currentPassword);
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.json({ options: result.options });
    }),
  );

  router.post(
    '/passkeys',
    limiter(20),
    attach,
    owner(true, async (req, res, ctx) => {
      const parsed = addSchema.safeParse(req.body);
      if (!parsed.success) {
        deny(res, 400, 'Ответ устройства не распознан', 'invalid');
        return;
      }
      const response = parsed.data.response as RegistrationResponseJSON;
      const result = await service.register(ctx, response, parsed.data.name, requestMeta(req));
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.status(201).json(result.passkey);
    }),
  );

  router.delete(
    '/passkeys/:id',
    attach,
    owner(true, async (req, res, ctx) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        deny(res, 400, 'Некорректный ключ', 'invalid');
        return;
      }
      const result = await service.removeOwn(ctx, id, requestMeta(req));
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.json({ ok: true });
    }),
  );

  return router;
};
