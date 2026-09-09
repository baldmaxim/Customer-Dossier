// Router, который умеет async-обработчики.
//
// Express 4 не передаёт отклонённый промис в error-middleware: ошибка внутри
// `async (req, res) => {...}` становится unhandled rejection и роняет процесс
// целиком. То есть один сбой БД на одном запросе убивает и ингест, и пайплайн.
//
// Обёртка ловит отказ и передаёт его в next(), где его подхватывает обработчик
// ошибок в app.ts. Альтернатива — обернуть каждый хендлер руками, но про это
// забывают ровно там, где потом падает.

import { Router, type IRouter, type RequestHandler } from 'express';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];

export const wrapAsyncHandler = (handler: RequestHandler): RequestHandler => {
  // Синхронные обработчики Express и так обрабатывает — но лишняя обёртка
  // безвредна, а различать их по сигнатуре ненадёжно.
  return (req, res, next) => {
    try {
      const result = handler(req, res, next) as unknown;
      if (result instanceof Promise) result.catch(next);
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Router с автоматической обёрткой обработчиков. Использовать вместо
 * `Router()` во всех файлах роутов.
 */
export const asyncRouter = (): IRouter => {
  const router = Router();

  for (const method of METHODS) {
    const original = router[method].bind(router) as (
      path: string,
      ...handlers: RequestHandler[]
    ) => IRouter;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any)[method] = (path: string, ...handlers: RequestHandler[]): IRouter =>
      original(path, ...handlers.map(wrapAsyncHandler));
  }

  return router;
};
