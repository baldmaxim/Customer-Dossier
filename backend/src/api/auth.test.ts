// Вход оператора на серверной выкладке (ADR-013, AUTH_MODE=token) и локальный режим без входа.
// TC-004: без входа изменения и чтение невозможны. TC-005: чужой Origin, Host (DNS rebinding) и
// отсутствие CSRF-токена отклоняются. Все отказы происходят до обработчиков — база (мёртвый адрес) не нужна.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { createApp } from '../app.js';
import { SessionStore, parseCookies, safeEqual, sessionCookieName } from './auth.js';

const TOKEN = 'operator-token-for-unit-tests-0123456789';
const HOSTNAME = 'radar.example.ru';
const ORIGIN = `https://${HOSTNAME}`;
const COOKIE = sessionCookieName(true);

interface IResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const makeRequest =
  (portOf: () => number, defaultHost: () => string) =>
  (method: string, path: string, options: { headers?: Record<string, string>; body?: unknown; raw?: string } = {}): Promise<IResponse> =>
    new Promise((resolve, reject) => {
      const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      const req = http.request(
        {
          host: '127.0.0.1',
          port: portOf(),
          method,
          path,
          headers: {
            host: defaultHost(),
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

const listen = async (app: http.RequestListener): Promise<{ server: http.Server; port: number }> => {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
};

const close = (server: http.Server): Promise<void> =>
  new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

describe('серверный режим: вход по токену за прокси', () => {
  let now = 1_000_000;
  const store = new SessionStore({ idleMs: 60_000, maxMs: 600_000, now: () => now });
  let server: http.Server;
  let port = 0;
  const request = makeRequest(() => port, () => HOSTNAME);

  const login = async (clientIp = '203.0.113.10'): Promise<{ cookie: string; csrf: string }> => {
    const res = await request('POST', '/api/auth/login', {
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp },
      body: { token: TOKEN },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    const id = parseCookies(setCookie.split(';')[0])[COOKIE] ?? '';
    expect(id).not.toBe('');
    return { cookie: `${COOKIE}=${id}`, csrf: String(res.body.csrfToken) };
  };

  beforeAll(async () => {
    ({ server, port } = await listen(
      createApp({
        auth: { mode: 'token', operatorToken: TOKEN, store, secureCookie: true, maxAgeSec: 600 },
        allowedOrigins: [ORIGIN],
        allowedHostnames: [HOSTNAME],
        trustProxy: true,
      }),
    ));
  });

  afterAll(() => close(server));

  it('сессия без входа: вход нужен, CSRF-токена нет', async () => {
    const res = await request('GET', '/api/auth/session');
    expect(res.body).toEqual({ authRequired: true, authenticated: false });
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('cookie сессии — __Host-, Secure, HttpOnly, SameSite=Strict, Path=/', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN }, body: { token: TOKEN } });
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie.startsWith('__Host-tgi_session=')).toBe(true);
    for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/;', 'Secure']) expect(setCookie).toContain(attr);
    expect(setCookie).not.toContain('Domain=');
  });

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
    const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN }, raw: '{"token": "leaky-secret-' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('leaky-secret');
  });

  it('верный токен даёт сессию; logout её гасит', async () => {
    const { cookie } = await login();
    const session = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(session.body.authenticated).toBe(true);
    expect(typeof session.body.csrfToken).toBe('string');

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

  it('без сессии изменяющие маршруты отвечают 401 (TC-004)', async () => {
    const cases: Array<[string, string, unknown]> = [
      ['PATCH', '/api/admin/sources/1', { status: 'active' }],
      ['POST', '/api/admin/sources/1/enabled', { enabled: true }],
      ['POST', '/api/admin/sources/telegram', { channel: 'somechannel' }],
      ['DELETE', '/api/admin/sources/1', undefined],
      ['POST', '/api/admin/merges/1/merge', {}],
      ['POST', '/api/reprocess/runs/1/retry', {}],
      ['POST', '/api/reprocess/sets/1/publish', { expectedVersion: 0, expectedPreviewToken: 'a'.repeat(64) }],
      ['POST', '/api/manual', { body: 'текст' }],
    ];
    for (const [method, path, body] of cases) {
      const res = await request(method, path, { headers: { origin: ORIGIN }, body });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('без сессии данные не выдаются, неизвестный адрес — тоже 401, а не 404', async () => {
    for (const path of ['/api/companies?q=ab', '/api/companies/1', '/api/feed', '/api/graph', '/api/no-such-route']) {
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
    const res = await request('PATCH', '/api/admin/sources/1', { headers: { cookie, origin: ORIGIN }, body: { status: 'active' } });
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
      headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': csrf },
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

  it('чужой Host (DNS rebinding) отклоняется до обработчиков; loopback и имя портала — нет', async () => {
    const evil = await request('GET', '/api/health', { headers: { host: 'attacker.example' } });
    expect(evil.status).toBe(403);
    expect(evil.body.code).toBe('bad_host');
    const sub = await request('GET', '/api/health', { headers: { host: `evil.${HOSTNAME}` } });
    expect(sub.status).toBe(403);
    for (const host of [HOSTNAME, `${HOSTNAME.toUpperCase()}:443`, `127.0.0.1:${port}`]) {
      const res = await request('GET', '/api/health', { headers: { host } });
      expect([200, 503], host).toContain(res.status);
    }
  });

  it('вход с чужой страницы отклоняется (login CSRF)', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: 'https://evil.example' }, body: { token: TOKEN } });
    expect(res.status).toBe(403);
  });

  it('лимит попыток входа считается по адресу клиента из прокси, а не по адресу прокси', async () => {
    const attacker = '198.51.100.7';
    let last = 0;
    for (let i = 0; i < 21; i += 1) {
      const res = await request('POST', '/api/auth/login', {
        headers: { origin: ORIGIN, 'x-forwarded-for': attacker },
        body: { token: `wrong-${i}` },
      });
      last = res.status;
    }
    expect(last).toBe(429);
    // Оператор с другого адреса за тем же прокси не заблокирован перебором.
    await login('203.0.113.99');
  });
});

describe('локальный режим: без входа', () => {
  let server: http.Server;
  let port = 0;
  const request = makeRequest(() => port, () => `127.0.0.1:${port}`);

  beforeAll(async () => {
    ({ server, port } = await listen(createApp({ allowedOrigins: ['http://127.0.0.1:5173'] })));
  });

  afterAll(() => close(server));

  it('сессия сообщает, что вход не нужен', async () => {
    const res = await request('GET', '/api/auth/session');
    expect(res.body).toEqual({ authRequired: false, authenticated: true });
  });

  it('входа нет: /api/auth/login не существует', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: 'http://127.0.0.1:5173' }, body: { token: TOKEN } });
    expect(res.status).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('Host — только loopback: публичное имя без PUBLIC_ORIGIN отклоняется', async () => {
    const res = await request('GET', '/api/health', { headers: { host: HOSTNAME } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bad_host');
  });
});

describe('safeEqual и хранилище сессий', () => {
  it('сравнивает строки разной длины без исключения', () => {
    expect(safeEqual('a', 'abc')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('истёкшие сессии вычищаются при новом входе', () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, maxMs: 10_000, now: () => now });
    store.create();
    store.create();
    now = 5000;
    store.create();
    expect(store.size).toBe(1);
  });

  it('сессия не живёт дольше максимума даже при активности', () => {
    let now = 0;
    const store = new SessionStore({ idleMs: 1000, maxMs: 3000, now: () => now });
    const { id } = store.create();
    for (now = 500; now <= 2500; now += 500) expect(store.get(id)).not.toBeNull();
    now = 3500;
    expect(store.get(id)).toBeNull();
  });
});
