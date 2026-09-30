// Вход оператора на серверной выкладке (ADR-013). Локально (AUTH_MODE=none) не действует.
//
// Механизм: токен оператора из OPERATOR_TOKEN обменивается на серверную сессию.
// Браузер хранит только идентификатор сессии в HttpOnly SameSite=Strict cookie;
// CSRF-токен живёт в памяти страницы и приходит заголовком на каждую изменяющую
// операцию. Сессии — в памяти процесса: перезапуск API означает повторный вход,
// для одного оператора это дешевле таблицы сессий.
//
// Почему не просто CORS: CORS решает, может ли чужая страница ПРОЧИТАТЬ ответ,
// но не запрещает ей ОТПРАВИТЬ запрос. Простой POST с чужой вкладки дошёл бы
// до слияния компаний. Поэтому отдельно: Host, Origin/Sec-Fetch-Site (api/guards.ts)
// и CSRF-токен.

import crypto from 'node:crypto';

import rateLimit from 'express-rate-limit';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import type { AuthMode } from '../config/parse.js';

export const CSRF_HEADER = 'x-csrf-token';

/**
 * Имя cookie. Префикс `__Host-` браузер принимает только с Secure, Path=/ и без Domain:
 * такую cookie не подменить с соседнего поддомена зоны.
 */
export const sessionCookieName = (secure: boolean): string => (secure ? '__Host-tgi_session' : 'tgi_session');

interface ISession {
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface ISessionStoreOptions {
  idleMs: number;
  maxMs: number;
  now?: () => number;
}

export class SessionStore {
  private readonly sessions = new Map<string, ISession>();
  private readonly now: () => number;

  constructor(private readonly options: ISessionStoreOptions) {
    this.now = options.now ?? Date.now;
  }

  create(): { id: string; csrfToken: string; expiresAt: number } {
    this.prune();
    const id = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    const at = this.now();
    this.sessions.set(id, { csrfToken, createdAt: at, lastSeenAt: at });
    return { id, csrfToken, expiresAt: at + this.options.maxMs };
  }

  /** Живая сессия или null. Истёкшая удаляется при обращении. */
  get(id: string | undefined): (ISession & { expiresAt: number }) | null {
    if (!id) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    const at = this.now();
    if (this.isExpired(session, at)) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeenAt = at;
    return { ...session, expiresAt: session.createdAt + this.options.maxMs };
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  private isExpired(session: ISession, at: number): boolean {
    return at - session.lastSeenAt > this.options.idleMs || at - session.createdAt > this.options.maxMs;
  }

  /** Брошенные сессии не копятся: каждый вход чистит истёкшие. */
  private prune(): void {
    const at = this.now();
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, at)) this.sessions.delete(id);
    }
  }
}

const sha256 = (value: string): Buffer => crypto.createHash('sha256').update(value, 'utf8').digest();

/** Сравнение без утечки по времени; длины выравнены хэшированием. */
export const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(sha256(a), sha256(b));

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
  /** Обязателен при mode = token. */
  operatorToken: string | null;
  store: SessionStore;
  /** Cookie с флагом Secure и префиксом `__Host-` — портал открыт по https. */
  secureCookie: boolean;
  maxAgeSec: number;
}

const deny = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

const sessionIdOf = (req: Request, cookieName: string): string | undefined => parseCookies(req.headers.cookie)[cookieName];

const cookieHeader = (options: IAuthOptions, value: string, maxAgeSec: number): string =>
  `${sessionCookieName(options.secureCookie)}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}` +
  (options.secureCookie ? '; Secure' : '');

const passThrough: RequestHandler = (_req, _res, next) => next();

/** Сессия обязательна; для изменяющих методов — ещё и CSRF-токен. Без входа — пропускает всё. */
export const createRequireOperator = (options: IAuthOptions): RequestHandler => {
  if (options.mode === 'none') return passThrough;
  const cookieName = sessionCookieName(options.secureCookie);
  return (req: Request, res: Response, next: NextFunction) => {
    const session = options.store.get(sessionIdOf(req, cookieName));
    if (!session) {
      deny(res, 401, 'Нужен вход оператора', 'auth_required');
      return;
    }
    if (UNSAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!provided || !safeEqual(provided, session.csrfToken)) {
        deny(res, 403, 'Нет или неверный CSRF-токен', 'csrf');
        return;
      }
    }
    next();
  };
};

const loginSchema = z.object({ token: z.string().min(1).max(512) });

export const createAuthRouter = (options: IAuthOptions): Router => {
  const router = Router();
  const cookieName = sessionCookieName(options.secureCookie);

  router.get('/session', (req, res) => {
    // no-store: ответ с CSRF-токеном не должен оседать ни в каком кэше.
    res.setHeader('Cache-Control', 'no-store');
    if (options.mode === 'none') {
      res.json({ authRequired: false, authenticated: true });
      return;
    }
    const session = options.store.get(sessionIdOf(req, cookieName));
    if (!session) {
      res.json({ authRequired: true, authenticated: false });
      return;
    }
    res.json({
      authRequired: true,
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  if (options.mode === 'none') return router;
  const operatorToken = options.operatorToken;
  if (operatorToken === null) throw new Error('AUTH_MODE=token без OPERATOR_TOKEN');

  // Портал открыт в интернет: перебор токена упирается сначала в лимит nginx, затем сюда.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток входа, подождите', code: 'rate_limited' },
  });

  router.post('/login', loginLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    // Ни токен, ни его длина в ответ и лог не попадают.
    if (!parsed.success || !safeEqual(parsed.data.token, operatorToken)) {
      deny(res, 401, 'Неверный токен оператора', 'bad_token');
      return;
    }
    options.store.destroy(sessionIdOf(req, cookieName));
    const session = options.store.create();
    res.setHeader('Set-Cookie', cookieHeader(options, session.id, options.maxAgeSec));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authRequired: true,
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  router.post('/logout', (req, res) => {
    options.store.destroy(sessionIdOf(req, cookieName));
    res.setHeader('Set-Cookie', cookieHeader(options, '', 0));
    res.json({ authRequired: true, authenticated: false });
  });

  return router;
};
