import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env.js';
import { checkDbConnection } from './db/pool.js';
import { adminRouter } from './api/admin.routes.js';
import { assertionsRouter } from './api/assertions.routes.js';
import { dossierRouter } from './api/dossier.routes.js';
import { snapshotRouter } from './api/snapshot.routes.js';
import {
  SessionStore,
  createAuthRouter,
  createOriginGuard,
  createRequireOperator,
  requireLoopbackHost,
} from './api/auth.js';
import { companiesRouter } from './api/companies.routes.js';
import { entitiesRouter } from './api/entities.routes.js';
import { contractorsRouter } from './api/contractors.routes.js';
import { manualRouter } from './api/manual.routes.js';
import { reprocessRouter } from './api/reprocess.routes.js';
import { revisionsRouter } from './api/revisions.routes.js';

export interface ICreateAppOptions {
  operatorToken: string;
  /** Для тестов: хранилище с подменённым временем. */
  store?: SessionStore;
  allowedOrigins?: readonly string[];
}

/** UI открывается с dev-сервера Vite или с самого API (preview/сборка через прокси). */
export const defaultAllowedOrigins = (): string[] => {
  const fromEnv = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  const self = [`http://127.0.0.1:${env.PORT}`, `http://localhost:${env.PORT}`, `http://[::1]:${env.PORT}`];
  return [...new Set([...fromEnv, ...self])];
};

export const createApp = (options: ICreateAppOptions): express.Express => {
  const app = express();
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const store =
    options.store ??
    new SessionStore({
      idleMs: env.SESSION_IDLE_MINUTES * 60_000,
      maxMs: env.SESSION_MAX_HOURS * 3_600_000,
    });

  app.disable('x-powered-by');
  app.use(helmet());
  // Host и Origin проверяются до всего остального, включая разбор тела.
  app.use('/api', requireLoopbackHost, createOriginGuard(allowedOrigins));
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

  app.use(
    '/api/auth',
    createAuthRouter({
      operatorToken: options.operatorToken,
      store,
      allowedOrigins,
      maxAgeSec: env.SESSION_MAX_HOURS * 3600,
    }),
  );

  // Всё остальное — досье и управление — только для вошедшего оператора.
  const requireOperator = createRequireOperator(store);
  app.use('/api', (_req, res, next) => {
    // Ответы с досье не кэшируются ни браузером, ни service worker'ом.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/manual', requireOperator, manualRouter);
  app.use('/api/companies', requireOperator, companiesRouter);
  app.use('/api/contractors', requireOperator, contractorsRouter);
  app.use('/api', requireOperator, entitiesRouter);
  app.use('/api/admin', requireOperator, adminRouter);
  app.use('/api', requireOperator, revisionsRouter);
  app.use('/api', requireOperator, assertionsRouter);
  app.use('/api', requireOperator, reprocessRouter);
  app.use('/api', requireOperator, dossierRouter);
  app.use('/api', requireOperator, snapshotRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Не найдено' });
  });

  // Обработчик ошибок обязан иметь четыре аргумента — иначе Express считает его
  // обычным middleware и ошибки проходят мимо.
  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
      // Текст ошибки разбора содержит фрагмент тела — в том числе токен при
      // входе. В лог и ответ он не попадает.
      res.status(err.status ?? 400).json({ error: 'Некорректное тело запроса' });
      return;
    }
    console.error(`[api] ${err.message}`);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
};
