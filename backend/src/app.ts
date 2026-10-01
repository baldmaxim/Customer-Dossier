import cors from 'cors';
import express, { type IRouter, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env.js';
import { checkDbConnection } from './db/pool.js';
import { adminRouter } from './api/admin.routes.js';
import { assertionsRouter } from './api/assertions.routes.js';
import { dossierRouter } from './api/dossier.routes.js';
import { snapshotRouter } from './api/snapshot.routes.js';
import { createAttachAuth, createAuthRouter, createRequireAccess, type IAuthOptions } from './api/auth.js';
import { createUsersRouter } from './api/users.routes.js';
import { llmRouter } from './api/llm.routes.js';
import { passkeyRelyingParty, PasskeyService } from './auth/passkeys.js';
import { pgAuthStore } from './auth/pgStore.js';
import { AuthService } from './auth/service.js';
import { createHostGuard, createOriginGuard } from './api/guards.js';
import { companiesRouter } from './api/companies.routes.js';
import { entitiesRouter } from './api/entities.routes.js';
import { graphRouter } from './api/graph.routes.js';
import { contractorsRouter } from './api/contractors.routes.js';
import { manualRouter } from './api/manual.routes.js';
import { reprocessRouter } from './api/reprocess.routes.js';
import { revisionsRouter } from './api/revisions.routes.js';

export interface ICreateAppOptions {
  allowedOrigins?: readonly string[];
  /** Имена, кроме loopback, которые допустимы в Host: публичный адрес портала за прокси. */
  allowedHostnames?: readonly string[];
  /** Для тестов: режим входа и сервис на хранилище в памяти с подменённым временем. */
  auth?: Partial<IAuthOptions>;
  trustProxy?: boolean;
}

/** UI открывается с dev-сервера Vite, с самого API (preview/сборка через прокси) или по PUBLIC_ORIGIN. */
export const defaultAllowedOrigins = (): string[] => {
  const fromEnv = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  const self = [`http://127.0.0.1:${env.PORT}`, `http://localhost:${env.PORT}`, `http://[::1]:${env.PORT}`];
  const publicOrigin = env.PUBLIC_ORIGIN === null ? [] : [env.PUBLIC_ORIGIN];
  return [...new Set([...fromEnv, ...self, ...publicOrigin])];
};

const defaultAllowedHostnames = (): string[] =>
  env.PUBLIC_ORIGIN === null ? [] : [new URL(env.PUBLIC_ORIGIN).hostname];

/** Имя портала в окне устройства при добавлении ключа доступа. */
const PASSKEY_RP_NAME = 'Досье Заказчика';

const defaultAuthOptions = (): IAuthOptions => {
  const service = new AuthService(pgAuthStore, {
    idleMs: env.SESSION_IDLE_MINUTES * 60_000,
    maxMs: env.SESSION_MAX_HOURS * 3_600_000,
  });
  // Ключ доступа привязан к домену из PUBLIC_ORIGIN; без него (локально, по IP) вход ключом выключен.
  const rp = passkeyRelyingParty(env.PUBLIC_ORIGIN, env.AUTH_MODE);
  return {
    mode: env.AUTH_MODE,
    service,
    secureCookie: env.PUBLIC_ORIGIN?.startsWith('https:') ?? false,
    maxAgeSec: env.SESSION_MAX_HOURS * 3600,
    passkeys: rp === null ? null : new PasskeyService(pgAuthStore, service, { ...rp, rpName: PASSKEY_RP_NAME }),
  };
};

/**
 * Роутеры данных под /api и их префиксы. Право каждого маршрута — auth/routePolicy.ts;
 * routePolicy.test.ts обходит этот список и требует правило для каждого изменяющего маршрута.
 */
export const dataRouters = (service: AuthService, passkeys: PasskeyService | null = null): ReadonlyArray<readonly [string, IRouter]> => [
  ['/manual', manualRouter],
  ['/companies', companiesRouter],
  ['/contractors', contractorsRouter],
  ['', entitiesRouter],
  ['/admin', adminRouter],
  ['/admin', llmRouter],
  ['', revisionsRouter],
  ['', assertionsRouter],
  ['', reprocessRouter],
  ['', dossierRouter],
  ['', graphRouter],
  ['', snapshotRouter],
  ['', createUsersRouter(service, passkeys)],
];

/**
 * Параметры строки запроса API — только плоские значения: ключ без скобок и без повторов. Вложенный объект (`a[b]=1`)
 * или массив из повторённого ключа (`q=1&q=2`) — 400 до авторизации и маршрутов, а не молчаливое игнорирование.
 */
export const rejectStructuredQuery = (req: Request, res: Response, next: NextFunction): void => {
  for (const [key, value] of Object.entries(req.query)) {
    if (/[[\]]/.test(key) || typeof value !== 'string') {
      res.status(400).json({ error: 'Параметры запроса — только плоские значения без повторов', code: 'invalid_query' });
      return;
    }
  }
  next();
};

export const createApp = (options: ICreateAppOptions = {}): express.Express => {
  const app = express();
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const auth: IAuthOptions = { ...defaultAuthOptions(), ...options.auth };

  app.disable('x-powered-by');
  // Один доверенный прокси перед API: адрес клиента — из X-Forwarded-For, который
  // прокси перезаписывает. Без прокси заголовку не верим — его подделает кто угодно.
  if (options.trustProxy ?? env.TRUST_PROXY) app.set('trust proxy', 1);
  // Строка запроса разбирается node:querystring, а не qs (ACC-04: GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g в qs@6.15.3,
  // зависимость express@4.22.2). Все параметры API плоские; вложенные ключи и повторы отвергает rejectStructuredQuery.
  app.set('query parser', 'simple');
  app.use(helmet());
  // Host и Origin проверяются до всего остального, включая разбор тела.
  app.use(
    '/api',
    createHostGuard(options.allowedHostnames ?? defaultAllowedHostnames()),
    createOriginGuard(allowedOrigins),
    rejectStructuredQuery,
  );
  // CORS только сообщает браузеру, чей ответ можно читать. Авторизацией он
  // не является; credentials не разрешаем — UI ходит с того же origin через прокси.
  app.use(cors({ origin: [...allowedOrigins] }));
  // Ручная вставка может быть длинной статьёй — 10 мб с запасом.
  app.use(express.json({ limit: '10mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get('/api/health', async (_req, res) => {
    const db = await checkDbConnection();
    res.status(db ? 200 : 503).json({ ok: db, db });
  });

  // Режим входа сервер сообщает сам: UI узнаёт из /api/auth/session, нужен ли экран входа.
  app.use('/api/auth', createAuthRouter(auth));

  app.use('/api', (_req, res, next) => {
    // Ответы с данными не кэшируются ни браузером, ни service worker'ом.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // Всё остальное, включая «не найдено», — только после входа (AUTH_MODE=password) и по праву роли.
  // Локально (AUTH_MODE=none) запрос идёт от локального оператора со всеми правами: защита —
  // loopback, Host и Origin; изменение без правила в таблице прав запрещено и здесь.
  app.use('/api', createAttachAuth(auth), createRequireAccess(auth));
  for (const [prefix, router] of dataRouters(auth.service, auth.passkeys ?? null)) app.use(`/api${prefix}`, router);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });

  // Обработчик ошибок обязан иметь четыре аргумента — иначе Express считает его
  // обычным middleware и ошибки проходят мимо.
  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      // Текст ошибки разбора содержит фрагмент тела. В лог и ответ он не попадает.
      res.status(err.status ?? 400).json({ error: 'Некорректное тело запроса' });
      return;
    }
    console.error(`[api] ${err.message}`);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
};
