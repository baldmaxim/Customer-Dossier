// TC-077 (закрытие приёмки 09): база недоступна во время работы. Unit-профиль указывает на заведомо мёртвый
// адрес (127.0.0.1:1), поэтому это настоящий отказ соединения, а не подмена. Ожидается явная ошибка 5xx
// с понятным телом — не 200 с пустым досье, не зависший запрос и не падение процесса.
// Реальная остановка и возврат PostgreSQL проверяются пользователем (USER_RUN_CLOSURE, шаг D).

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

const ORIGIN = 'http://127.0.0.1:5173';

let server: http.Server;
let port = 0;
const headers: Record<string, string> = {};

const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
          } catch {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.setTimeout(15_000, () => req.destroy(new Error('запрос завис: ответа нет')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

beforeAll(async () => {
  server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('база недоступна (TC-077)', () => {
  it('health честно отвечает 503', async () => {
    const res = await call('GET', '/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: false });
  }, 20_000);

  it.each([
    ['GET', '/api/cases/1/dossier'],
    ['GET', '/api/companies/1'],
    ['GET', `/api/companies?q=${encodeURIComponent('альфа')}`],
    ['GET', '/api/snapshots/1'],
    ['GET', '/api/review-queue'],
  ])('%s %s — 5xx с сообщением об ошибке, не пустые данные и не зависание', async (method, path) => {
    const res = await call(method, path, headers);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(typeof res.body.error).toBe('string');
    expect(res.body).not.toHaveProperty('items');
    expect(res.body).not.toHaveProperty('role');
  }, 20_000);

  it('запись при недоступной базе — 5xx, процесс продолжает отвечать', async () => {
    const res = await call('POST', '/api/cases', headers, { title: 'при недоступной базе', companyStatus: 'not_established', companyNameClaimed: 'Синтетика', requestDate: '2026-09-16' });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect((await call('GET', '/api/health')).status).toBe(503);
  }, 20_000);
});
