// Вход пользователей портала (ADR-014; прежний вход по токену оператора — ADR-013).
//
// AUTH_MODE=none — локальная работа: loopback, входа нет, каждый запрос идёт от локального
// оператора со всеми правами (auth/service.ts::LOCAL_CONTEXT).
// AUTH_MODE=password — сервер: логин и пароль меняются на серверную сессию в базе. Браузер хранит
// только идентификатор сессии в HttpOnly SameSite=Strict cookie; CSRF-токен живёт в памяти страницы
// и приходит заголовком на каждую изменяющую операцию. Права — по роли пользователя
// (auth/permissions.ts) и таблице маршрутов (auth/routePolicy.ts), проверяются на каждом запросе:
// смена роли или выключение действуют сразу, без повторного входа.
//
// Заявка на доступ (POST /register) — тоже здесь, до проверки входа: её подаёт человек без
// учётной записи. Создаёт выключенного читателя; войти он сможет, когда администратор одобрит
// заявку в «Пользователях». Локально (AUTH_MODE=none) входа нет — и заявок тоже: 404.
//
// Почему не просто CORS: CORS решает, может ли чужая страница ПРОЧИТАТЬ ответ,
// но не запрещает ей ОТПРАВИТЬ запрос. Поэтому отдельно: Host, Origin/Sec-Fetch-Site
// (api/guards.ts) и CSRF-токен.

import rateLimit from 'express-rate-limit';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import type { AuthMode } from '../config/parse.js';
import { permissionFor } from '../auth/routePolicy.js';
import { LOCAL_CONTEXT, safeEqual, type AuthService, type IAuthContext, type IAuthUser, type IRequestMeta } from '../auth/service.js';

export { safeEqual };

export const CSRF_HEADER = 'x-csrf-token';

declare module 'express-serve-static-core' {
  interface Request {
    /** Кто делает запрос. Ставит createAttachAuth; до него — undefined. */
    auth?: IAuthContext;
  }
}

/**
 * Имя cookie. Префикс `__Host-` браузер принимает только с Secure, Path=/ и без Domain:
 * такую cookie не подменить с соседнего поддомена зоны.
 */
export const sessionCookieName = (secure: boolean): string => (secure ? '__Host-tgi_session' : 'tgi_session');

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === '') continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface IAuthOptions {
  mode: AuthMode;
  service: AuthService;
  /** Cookie с флагом Secure и префиксом `__Host-` — портал открыт по https. */
  secureCookie: boolean;
  maxAgeSec: number;
}

const deny = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

const sessionTokenOf = (req: Request, options: IAuthOptions): string | undefined =>
  parseCookies(req.headers.cookie)[sessionCookieName(options.secureCookie)];

const cookieHeader = (options: IAuthOptions, value: string, maxAgeSec: number): string =>
  `${sessionCookieName(options.secureCookie)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}` +
  (options.secureCookie ? '; Secure' : '');

/** Адрес и браузер для журнала входа. Адрес — из X-Forwarded-For только при TRUST_PROXY. */
export const requestMeta = (req: Request): IRequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
});

/** Логин того, кто делает запрос, — для атрибуции решений и журналов. Локально — 'operator'. */
export const actorOf = (req: Request): string => req.auth?.user.login ?? LOCAL_CONTEXT.user.login;

const hasValidCsrf = (req: Request, ctx: IAuthContext): boolean => {
  const header = req.headers[CSRF_HEADER];
  const provided = Array.isArray(header) ? header[0] : header;
  return provided !== undefined && ctx.csrfToken !== null && safeEqual(provided, ctx.csrfToken);
};

/** Ставит req.auth: локально — всегда локальный оператор, на сервере — по cookie сессии или никто. */
export const createAttachAuth = (options: IAuthOptions): RequestHandler => {
  if (options.mode === 'none') {
    return (req, _res, next) => {
      req.auth = LOCAL_CONTEXT;
      next();
    };
  }
  return (req, _res, next) => {
    options.service
      .resolve(sessionTokenOf(req, options))
      .then(ctx => {
        if (ctx) req.auth = ctx;
        next();
      })
      .catch(next);
  };
};

/**
 * Вход обязателен; изменяющий запрос — ещё и с CSRF-токеном; выданный администратором пароль
 * сначала меняется; право на маршрут — по таблице auth/routePolicy.ts.
 */
export const createRequireAccess = (options: IAuthOptions): RequestHandler => (req, res, next) => {
  const ctx = req.auth;
  if (!ctx) {
    deny(res, 401, 'Нужен вход', 'auth_required');
    return;
  }
  if (options.mode !== 'none') {
    if (UNSAFE_METHODS.has(req.method) && !hasValidCsrf(req, ctx)) {
      deny(res, 403, 'Нет или неверный CSRF-токен', 'csrf');
      return;
    }
    if (ctx.user.mustChangePassword) {
      deny(res, 403, 'Сначала смените выданный пароль', 'password_change_required');
      return;
    }
  }
  const permission = permissionFor(req.method, req.path);
  if (permission === null || !ctx.user.permissions.includes(permission)) {
    deny(res, 403, 'Недостаточно прав', 'forbidden');
    return;
  }
  next();
};

const sessionBody = (ctx: IAuthContext, authRequired: boolean) => {
  const user: IAuthUser = ctx.user;
  return {
    authRequired,
    authenticated: true,
    ...(ctx.csrfToken === null ? {} : { csrfToken: ctx.csrfToken }),
    ...(ctx.expiresAt === null ? {} : { expiresAt: ctx.expiresAt.toISOString() }),
    user: {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      role: user.role,
      permissions: user.permissions,
      mustChangePassword: user.mustChangePassword,
    },
  };
};

const loginSchema = z.object({
  login: z.string().min(1).max(128),
  password: z.string().min(1).max(1024),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(1).max(1024),
});

const registerSchema = z.object({
  login: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

/** Ответ на верный пароль к заявке, которую ещё не одобрили или отклонили. */
const REGISTRATION_REFUSALS = {
  registration_pending: 'Заявка ещё не одобрена администратором',
  registration_rejected: 'Заявка отклонена администратором',
} as const;

const wrap =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };

export const createAuthRouter = (options: IAuthOptions): Router => {
  const router = Router();
  const attach = createAttachAuth(options);

  router.get('/session', attach, (req, res) => {
    // no-store: ответ с CSRF-токеном не должен оседать ни в каком кэше.
    res.setHeader('Cache-Control', 'no-store');
    const ctx = req.auth;
    if (!ctx) {
      res.json({ authRequired: true, authenticated: false });
      return;
    }
    res.json(sessionBody(ctx, options.mode !== 'none'));
  });

  if (options.mode === 'none') {
    // Без входа нет и заявок на доступ: адреса нет, а не «запрещено».
    router.post('/register', (_req, res) => deny(res, 404, 'Не найдено', 'not_found'));
    return router;
  }

  // Портал открыт в интернет: перебор упирается сначала в лимит nginx, затем сюда,
  // затем в блокировку учётной записи (auth/service.ts).
  const limiter = (limit: number) =>
    rateLimit({
      windowMs: 15 * 60_000,
      limit,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Слишком много попыток, подождите', code: 'rate_limited' },
    });

  router.post(
    '/login',
    limiter(20),
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = loginSchema.safeParse(req.body);
      // Ни пароль, ни его длина в ответ и лог не попадают.
      if (!parsed.success) {
        deny(res, 401, 'Неверный логин или пароль', 'bad_credentials');
        return;
      }
      const result = await options.service.login(parsed.data.login, parsed.data.password, requestMeta(req), sessionTokenOf(req, options));
      if (!result.ok) {
        if (result.code === 'locked') {
          deny(res, 429, 'Слишком много неудачных попыток. Вход временно закрыт — попробуйте позже', 'locked');
        } else if (result.code === 'registration_pending' || result.code === 'registration_rejected') {
          deny(res, 403, REGISTRATION_REFUSALS[result.code], result.code);
        } else {
          deny(res, 401, 'Неверный логин или пароль', 'bad_credentials');
        }
        return;
      }
      res.setHeader('Set-Cookie', cookieHeader(options, result.token, options.maxAgeSec));
      res.json(sessionBody(result.context, true));
    }),
  );

  // Заявка: по адресу — свой лимит (тот же механизм, что у входа, адрес — с учётом TRUST_PROXY),
  // Host и Origin проверены до роутера. Сессии не создаёт, пароль не возвращает и не пишет в журнал.
  router.post(
    '/register',
    limiter(10),
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        deny(res, 400, 'Укажите логин, имя и пароль', 'invalid');
        return;
      }
      const result = await options.service.register(parsed.data, requestMeta(req));
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.status(201).json({ status: 'pending' });
    }),
  );

  router.post(
    '/logout',
    wrap(async (req, res) => {
      await options.service.logout(sessionTokenOf(req, options), requestMeta(req));
      res.setHeader('Set-Cookie', cookieHeader(options, '', 0));
      res.json({ authRequired: true, authenticated: false });
    }),
  );

  router.post(
    '/password',
    limiter(20),
    attach,
    wrap(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const ctx = req.auth;
      if (!ctx) {
        deny(res, 401, 'Нужен вход', 'auth_required');
        return;
      }
      if (!hasValidCsrf(req, ctx)) {
        deny(res, 403, 'Нет или неверный CSRF-токен', 'csrf');
        return;
      }
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) {
        deny(res, 400, 'Укажите текущий и новый пароль', 'invalid');
        return;
      }
      const result = await options.service.changePassword(ctx, parsed.data.currentPassword, parsed.data.newPassword, requestMeta(req));
      if (!result.ok) {
        deny(res, result.status, result.error, result.code);
        return;
      }
      res.json(sessionBody(result.context, true));
    }),
  );

  return router;
};
