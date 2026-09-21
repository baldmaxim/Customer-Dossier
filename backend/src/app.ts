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
import { createOriginGuard, requireLoopbackHost } from './api/guards.js';
import { companiesRouter } from './api/companies.routes.js';
import { entitiesRouter } from './api/entities.routes.js';
import { contractorsRouter } from './api/contractors.routes.js';
import { manualRouter } from './api/manual.routes.js';
import { reprocessRouter } from './api/reprocess.routes.js';
import { revisionsRouter } from './api/revisions.routes.js';

export interface ICreateAppOptions {
  allowedOrigins?: readonly string[];
}

/** UI открывается с dev-сервера Vite или с самого API (preview/сборка через прокси). */
export const defaultAllowedOrigins = (): string[] => {
  const fromEnv = env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  const self = [`http://127.0.0.1:${env.PORT}`, `http://localhost:${env.PORT}`, `http://[::1]:${env.PORT}`];
  return [...new Set([...fromEnv, ...self])];
};

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

  app.disable('x-powered-by');
  // Строка запроса разбирается node:querystring, а не qs (ACC-04: GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g в qs@6.15.3,
  // зависимость express@4.22.2). Все параметры API плоские; вложенные ключи и повторы отвергает rejectStructuredQuery.
  app.set('query parser', 'simple');
  app.use(helmet());
  // Host и Origin проверяются до всего остального, включая разбор тела.
  app.use('/api', requireLoopbackHost, createOriginGuard(allowedOrigins), rejectStructuredQuery);
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

  // Вход по токену снят на время разработки: портал открывается сразу.
  // Защита остаётся на уровне сети — loopback-адрес, проверка Host и Origin.
  app.use('/api', (_req, res, next) => {
    // Ответы с данными не кэшируются ни браузером, ни service worker'ом.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/manual', manualRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/contractors', contractorsRouter);
  app.use('/api', entitiesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', revisionsRouter);
  app.use('/api', assertionsRouter);
  app.use('/api', reprocessRouter);
  app.use('/api', dossierRouter);
  app.use('/api', snapshotRouter);

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
