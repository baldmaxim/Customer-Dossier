import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env.js';
import { checkDbConnection } from './db/pool.js';
import { manualRouter } from './api/manual.routes.js';

export const createApp = (): express.Express => {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    }),
  );
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

  app.use('/api/manual', manualRouter);

  // Обработчик ошибок обязан иметь четыре аргумента — иначе Express считает его
  // обычным middleware и ошибки проходят мимо.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[api] ${err.message}`);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });

  return app;
};
