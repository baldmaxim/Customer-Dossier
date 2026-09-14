// TC-004: без авторизации изменения невозможны.
// TC-005: чужой Origin, Host (DNS rebinding) и отсутствие CSRF-токена отклоняются.
// Все отказы происходят до обработчиков — база (мёртвый адрес) не нужна.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { createApp } from '../app.js';
import { SESSION_COOKIE, SessionStore, parseCookies, safeEqual } from './auth.js';

const TOKEN = 'operator-token-for-unit-tests-0123456789';
const ORIGIN = 'http://127.0.0.1:5173';

interface IResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let now = 1_000_000;
const store = new SessionStore({ idleMs: 60_000, maxMs: 600_000, now: () => now });
let server: http.Server;
let port = 0;

const request = (
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<IResponse> =>
  new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = data ? (JSON.parse(data) as Record<string, unknown>) : {};
          } catch {
            body = { raw: data };
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const login = async (): Promise<{ cookie: string; csrf: string }> => {
  const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN }, body: { token: TOKEN } });
  expect(res.status).toBe(200);
  const setCookie = res.headers['set-cookie']?.[0] ?? '';
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Strict');
  const id = parseCookies(setCookie.split(';')[0])[SESSION_COOKIE] ?? '';
  return { cookie: `${SESSION_COOKIE}=${id}`, csrf: String(res.body.csrfToken) };
};

beforeAll(async () => {
  const app = createApp({ operatorToken: TOKEN, store, allowedOrigins: [ORIGIN] });
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('вход оператора', () => {
  it('неверный токен — 401 без cookie и без эха токена', async () => {
    const res = await request('POST', '/api/auth/login', {
      headers: { origin: ORIGIN },
      body: { token: 'wrong-token-value' },
    });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('wrong-token-value');
  });

  it('битый JSON при входе не попадает в ответ', async () => {
    const res = await new Promise<IResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/auth/login',
          headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', origin: ORIGIN },
        },
        r => {
          let data = '';
          r.on('data', c => (data += c));
          r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: { raw: data } }));
        },
      );
      req.on('error', reject);
      req.write('{"token": "leaky-secret-');
      req.end();
    });
    expect(res.status).toBe(400);
    expect(String(res.body.raw)).not.toContain('leaky-secret');
  });

  it('верный токен даёт сессию; сессия видна, logout её гасит', async () => {
    const { cookie } = await login();
    const session = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(session.body.authenticated).toBe(true);

    const out = await request('POST', '/api/auth/logout', { headers: { cookie, origin: ORIGIN } });
    expect(out.status).toBe(200);
    const after = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(after.body.authenticated).toBe(false);
  });

  it('сессия истекает по простою', async () => {
    const { cookie } = await login();
    now += 61_000;
    const res = await request('GET', '/api/companies?q=test', { headers: { cookie } });
    expect(res.status).toBe(401);
  });
});

describe('защита API (TC-004, TC-005)', () => {
  it('без сессии изменяющие маршруты отвечают 401 (TC-004)', async () => {
    const cases: Array<[string, string, unknown]> = [
      ['PATCH', '/api/admin/sources/1', { status: 'active' }],
      ['PATCH', '/api/admin/sources/1/policy', { accessStatus: 'approved', aiProcessingStatus: 'approved' }],
      ['POST', '/api/admin/sources/telegram', { channel: 'somechannel' }],
      ['POST', '/api/admin/sources/website', { url: 'example.ru' }],
      ['DELETE', '/api/admin/sources/1', undefined],
      ['POST', '/api/admin/merges/1/merge', {}],
      ['POST', '/api/admin/merges/1/reject', {}],
      ['POST', '/api/admin/metrics/refresh', {}],
      ['POST', '/api/manual', { body: 'текст' }],
    ];
    for (const [method, path, body] of cases) {
      const res = await request(method, path, { headers: { origin: ORIGIN }, body });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('без сессии досье не выдаётся', async () => {
    for (const path of ['/api/companies?q=ab', '/api/companies/1', '/api/companies/1/mentions', '/api/contractors']) {
      const res = await request('GET', path);
      expect(res.status, path).toBe(401);
    }
  });

  it('health доступен без входа', async () => {
    const res = await request('GET', '/api/health');
    expect([200, 503]).toContain(res.status);
  });

  it('с сессией, но без CSRF-токена изменение отклоняется (TC-005)', async () => {
    const { cookie } = await login();
    const res = await request('PATCH', '/api/admin/sources/1', {
      headers: { cookie, origin: ORIGIN },
      body: { status: 'active' },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf');
  });

  it('с сессией и неверным CSRF-токеном — 403', async () => {
    const { cookie } = await login();
    const res = await request('POST', '/api/admin/merges/1/reject', {
      headers: { cookie, origin: ORIGIN, 'x-csrf-token': 'forged' },
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it('чужой Origin отклоняется даже с верными cookie и CSRF (TC-005)', async () => {
    const { cookie, csrf } = await login();
    const res = await request('POST', '/api/admin/merges/1/reject', {
      headers: { cookie, origin: 'http://evil.example', 'x-csrf-token': csrf },
      body: {},
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bad_origin');
  });

  it('Sec-Fetch-Site: cross-site без Origin отклоняется', async () => {
    const { cookie, csrf } = await login();
    const res = await request('POST', '/api/admin/merges/1/reject', {
      headers: { cookie, 'sec-fetch-site': 'cross-site', 'x-csrf-token': csrf },
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it('чужой Host (DNS rebinding) отклоняется до обработчиков (TC-005)', async () => {
    const res = await request('GET', '/api/health', { headers: { host: 'attacker.example:4100' } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bad_host');
  });

  it('вход с чужой страницы отклоняется (login CSRF)', async () => {
    const res = await request('POST', '/api/auth/login', {
      headers: { origin: 'http://evil.example' },
      body: { token: TOKEN },
    });
    expect(res.status).toBe(403);
  });

  it('CORS не выдаёт разрешение чужому origin', async () => {
    const res = await request('GET', '/api/health', { headers: { origin: 'http://127.0.0.1:5173' } });
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('ответы API не кэшируются', async () => {
    const { cookie } = await login();
    const res = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('safeEqual', () => {
  it('сравнивает строки разной длины без исключения', () => {
    expect(safeEqual('a', 'abc')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});
