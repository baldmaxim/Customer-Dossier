// Доступ одного локального оператора.
//
// Механизм: токен оператора (backend/.env или backend/.local/operator-token)
// обменивается на короткую серверную сессию. Браузер хранит только
// идентификатор сессии в HttpOnly SameSite=Strict cookie; CSRF-токен живёт
// в памяти страницы и приходит заголовком на каждую изменяющую операцию.
//
// Почему не просто CORS: CORS решает, может ли чужая страница ПРОЧИТАТЬ ответ,
// но не запрещает ей ОТПРАВИТЬ запрос. Простой POST с чужой вкладки дошёл бы
// до слияния компаний. Поэтому отдельно: Host (защита от DNS rebinding),
// Origin/Sec-Fetch-Site и CSRF-токен.

import crypto from 'node:crypto';

import rateLimit from 'express-rate-limit';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';

import { isLoopbackHost } from '../config/parse.js';

export const SESSION_COOKIE = 'tgi_session';
export const CSRF_HEADER = 'x-csrf-token';

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
    const expired =
      at - session.lastSeenAt > this.options.idleMs || at - session.createdAt > this.options.maxMs;
    if (expired) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeenAt = at;
    return { ...session, expiresAt: session.createdAt + this.options.maxMs };
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
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
  operatorToken: string;
  store: SessionStore;
  /** Origin'ы, с которых открывается UI (dev-сервер Vite и сам API). */
  allowedOrigins: readonly string[];
  maxAgeSec: number;
}

const deny = (res: Response, status: number, error: string, code: string): void => {
  res.status(status).json({ error, code });
};

/**
 * Host обязан быть loopback. Страница злоумышленника, чей домен после загрузки
 * начал резолвиться в 127.0.0.1 (DNS rebinding), шлёт Host со своим доменом —
 * такой запрос отклоняется до любого обработчика.
 */
export const requireLoopbackHost: RequestHandler = (req, res, next) => {
  const host = req.headers.host ?? '';
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? '';
  if (!isLoopbackHost(hostname)) {
    deny(res, 403, 'Запрос к API разрешён только по локальному адресу', 'bad_host');
    return;
  }
  next();
};

/** Чужой Origin отклоняется всегда; для изменяющих запросов проверяется и Sec-Fetch-Site. */
export const createOriginGuard =
  (allowedOrigins: readonly string[]): RequestHandler =>
  (req, res, next) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      deny(res, 403, 'Запрос с чужой страницы отклонён', 'bad_origin');
      return;
    }
    if (origin === undefined && UNSAFE_METHODS.has(req.method)) {
      const site = req.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin' && site !== 'none') {
        deny(res, 403, 'Запрос с чужой страницы отклонён', 'bad_origin');
        return;
      }
    }
    next();
  };

const sessionIdOf = (req: Request): string | undefined => parseCookies(req.headers.cookie)[SESSION_COOKIE];

const cookieHeader = (value: string, maxAgeSec: number): string =>
  `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAgeSec}`;

/** Сессия обязательна; для изменяющих методов — ещё и CSRF-токен. */
export const createRequireOperator =
  (store: SessionStore): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    const session = store.get(sessionIdOf(req));
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

const loginSchema = z.object({ token: z.string().min(1).max(512) });

export const createAuthRouter = (options: IAuthOptions): Router => {
  const router = Router();

  // Перебор токена с этой же машины маловероятен, но ограничение дёшево.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много попыток входа, подождите', code: 'rate_limited' },
  });

  router.get('/session', (req, res) => {
    const session = options.store.get(sessionIdOf(req));
    // no-store: ответ с CSRF-токеном не должен оседать ни в каком кэше.
    res.setHeader('Cache-Control', 'no-store');
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    // Ни токен, ни его длина в ответ и лог не попадают.
    if (!parsed.success || !safeEqual(parsed.data.token, options.operatorToken)) {
      deny(res, 401, 'Неверный токен оператора', 'bad_token');
      return;
    }
    options.store.destroy(sessionIdOf(req));
    const session = options.store.create();
    res.setHeader('Set-Cookie', cookieHeader(session.id, options.maxAgeSec));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  router.post('/logout', (req, res) => {
    options.store.destroy(sessionIdOf(req));
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    res.json({ authenticated: false });
  });

  return router;
};
