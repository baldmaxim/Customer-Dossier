import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

import { wrapAsyncHandler } from './asyncRouter.js';

const req = {} as Request;
const res = {} as Response;

describe('wrapAsyncHandler', () => {
  it('передаёт отказ промиса в next — иначе Express 4 роняет процесс', async () => {
    const boom = new Error('соединение с БД потеряно');
    const next = vi.fn();

    wrapAsyncHandler(async () => {
      throw boom;
    })(req, res, next);

    // Отказ приходит в следующем тике микрозадач.
    await Promise.resolve();
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(boom);
  });

  it('ловит синхронное исключение', () => {
    const boom = new Error('синхронный сбой');
    const next = vi.fn();

    wrapAsyncHandler(() => {
      throw boom;
    })(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });

  it('успешный обработчик next не дёргает', async () => {
    const next = vi.fn();
    const handler = vi.fn(async () => undefined);

    wrapAsyncHandler(handler)(req, res, next);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});
