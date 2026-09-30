// Вход пользователей на серверной выкладке (ADR-014, AUTH_MODE=password) и локальный режим без входа.
// TC-004: без входа изменения и чтение невозможны. TC-005: чужой Origin, Host (DNS rebinding) и
// отсутствие CSRF-токена отклоняются. Права ролей — на каждом запросе. Хранилище пользователей и
// сессий — в памяти (auth/memoryStore.ts): база (мёртвый адрес) не нужна ни одному отказу.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { createApp } from '../app.js';
import { createMemoryAuthStore } from '../auth/memoryStore.js';
import { AuthService } from '../auth/service.js';
import type { Role } from '../auth/permissions.js';
import { parseCookies, safeEqual, sessionCookieName } from './auth.js';

const HOSTNAME = 'radar.example.ru';
const ORIGIN = `https://${HOSTNAME}`;
const COOKIE = sessionCookieName(true);
const PASSWORD = 'Correct-Horse-7731';

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

describe('серверный режим: вход по логину и паролю за прокси', () => {
  let now = Date.parse('2026-09-30T10:00:00Z');
  const store = createMemoryAuthStore();
  const service = new AuthService(store, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });
  let server: http.Server;
  let port = 0;
  const request = makeRequest(() => port, () => HOSTNAME);
  // Каждый вход — со своего адреса: лимит попыток по адресу проверяется отдельным тестом.
  let ipSeq = 0;
  const nextIp = (): string => `203.0.113.${(ipSeq += 1)}`;

  /** Пользователь, уже сменивший выданный пароль. */
  const seedUser = async (login: string, role: Role, password = PASSWORD): Promise<number> => {
    const created = await service.createUser({ id: null, login: 'cli' }, { login, displayName: login, role, password }, { ip: null, userAgent: null });
    if (!created.ok) throw new Error(created.error);
    await store.setPassword(created.user.id, (await store.findUserById(created.user.id))!.passwordHash, false, new Date(now));
    return created.user.id;
  };

  const tryLogin = (login: string, password: string, ip = nextIp()) =>
    request('POST', '/api/auth/login', { headers: { origin: ORIGIN, 'x-forwarded-for': ip }, body: { login, password } });

  const login = async (name: string, password = PASSWORD): Promise<{ cookie: string; csrf: string; body: Record<string, unknown> }> => {
    const res = await tryLogin(name, password);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    const id = parseCookies(setCookie.split(';')[0])[COOKIE] ?? '';
    expect(id).not.toBe('');
    return { cookie: `${COOKIE}=${id}`, csrf: String(res.body.csrfToken), body: res.body };
  };

  const as = (s: { cookie: string; csrf: string }) => ({ cookie: s.cookie, origin: ORIGIN, 'x-csrf-token': s.csrf });

  beforeAll(async () => {
    await seedUser('admin', 'admin');
    await seedUser('oper', 'operator');
    await seedUser('reader', 'viewer');
    ({ server, port } = await listen(
      createApp({
        auth: { mode: 'password', service, secureCookie: true, maxAgeSec: 600 },
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
    const res = await tryLogin('admin', PASSWORD);
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    expect(setCookie.startsWith('__Host-tgi_session=')).toBe(true);
    for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/;', 'Secure']) expect(setCookie).toContain(attr);
    expect(setCookie).not.toContain('Domain=');
  });

  it('неверный пароль и чужой логин — один и тот же ответ, без cookie и без эха', async () => {
    const wrong = await tryLogin('admin', 'wrong-password-value');
    const unknown = await tryLogin('nobody-here', 'wrong-password-value');
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Неверный логин или пароль', code: 'bad_credentials' });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('wrong-password-value');
    }
  });

  it('битый JSON при входе не попадает в ответ', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN }, raw: '{"password": "leaky-secret-' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('leaky-secret');
  });

  it('логин без учёта регистра; сессия несёт пользователя и права роли; logout её гасит', async () => {
    const { cookie, body } = await login('  ADMIN ');
    expect(body.user).toMatchObject({ login: 'admin', role: 'admin', mustChangePassword: false });
    expect(body.user).not.toHaveProperty('passwordHash');
    const session = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(session.body.authenticated).toBe(true);
    expect(typeof session.body.csrfToken).toBe('string');
    expect((session.body.user as { permissions: string[] }).permissions).toContain('users.manage');

    const out = await request('POST', '/api/auth/logout', { headers: { cookie, origin: ORIGIN } });
    expect(out.status).toBe(200);
    const after = await request('GET', '/api/auth/session', { headers: { cookie } });
    expect(after.body.authenticated).toBe(false);
  });

  it('сессия истекает по простою', async () => {
    const { cookie } = await login('admin');
    now += 61_000;
    const res = await request('GET', '/api/users', { headers: { cookie } });
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
      ['POST', '/api/users', { login: 'x', displayName: 'x', role: 'admin', password: 'x' }],
    ];
    for (const [method, path, body] of cases) {
      const res = await request(method, path, { headers: { origin: ORIGIN }, body });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('без сессии данные не выдаются, неизвестный адрес — тоже 401, а не 404', async () => {
    for (const path of ['/api/companies?q=ab', '/api/companies/1', '/api/feed', '/api/graph', '/api/users', '/api/no-such-route']) {
      const res = await request('GET', path);
      expect(res.status, path).toBe(401);
    }
  });

  it('health доступен без входа', async () => {
    const res = await request('GET', '/api/health');
    expect([200, 503]).toContain(res.status);
  });

  it('с сессией, но без CSRF-токена изменение отклоняется (TC-005)', async () => {
    const { cookie } = await login('admin');
    const res = await request('PATCH', '/api/admin/sources/1', { headers: { cookie, origin: ORIGIN }, body: { status: 'active' } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf');
  });

  it('с сессией и неверным CSRF-токеном — 403', async () => {
    const { cookie } = await login('admin');
    const res = await request('POST', '/api/admin/merges/1/reject', {
      headers: { cookie, origin: ORIGIN, 'x-csrf-token': 'forged' },
      body: {},
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf');
  });

  it('чужой Origin отклоняется даже с верными cookie и CSRF (TC-005)', async () => {
    const s = await login('admin');
    const res = await request('POST', '/api/admin/merges/1/reject', { headers: { ...as(s), origin: 'https://evil.example' }, body: {} });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bad_origin');
  });

  it('Sec-Fetch-Site: cross-site без Origin отклоняется', async () => {
    const { cookie, csrf } = await login('admin');
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
    const res = await request('POST', '/api/auth/login', { headers: { origin: 'https://evil.example' }, body: { login: 'admin', password: PASSWORD } });
    expect(res.status).toBe(403);
  });

  it('лимит попыток входа считается по адресу клиента из прокси, а не по адресу прокси', async () => {
    const attacker = '198.51.100.7';
    let last = 0;
    for (let i = 0; i < 21; i += 1) last = (await tryLogin('nobody-here', `wrong-${i}`, attacker)).status;
    expect(last).toBe(429);
    // Пользователь с другого адреса за тем же прокси не заблокирован перебором.
    await login('admin');
    // Каждая попытка — вычисление scrypt (~0.1 с): двадцать попыток дольше таймаута по умолчанию.
  }, 20_000);

  describe('права ролей', () => {
    it('читатель: портал — да; админка, изменения и пользователи — 403', async () => {
      const s = await login('reader');
      // Портал пропускается к обработчику (база в unit-тестах мертва — 500, но не 401/403).
      const portal = await request('GET', '/api/companies?q=ab', { headers: { cookie: s.cookie } });
      expect([401, 403]).not.toContain(portal.status);
      for (const path of ['/api/admin/sources', '/api/reprocess/runs', '/api/review-queue', '/api/users', '/api/cases']) {
        const res = await request('GET', path, { headers: { cookie: s.cookie } });
        expect(res.status, path).toBe(403);
        expect(res.body.code, path).toBe('forbidden');
      }
      for (const [method, path] of [['POST', '/api/admin/sources/1/enabled'], ['POST', '/api/assertions/1/reviews'], ['POST', '/api/manual']] as const) {
        const res = await request(method, path, { headers: as(s), body: {} });
        expect(res.status, path).toBe(403);
      }
    });

    it('регистр и лишние «/» в пути правило не обходят', async () => {
      const s = await login('reader');
      for (const path of ['/API/ADMIN/sources', '/api/Admin/sources/', '/api//admin//sources', '/api/USERS']) {
        const res = await request('GET', path, { headers: { cookie: s.cookie } });
        expect(res.status, path).toBe(403);
      }
    });

    it('оператор: админка — да, пользователи — нет', async () => {
      const s = await login('oper');
      const users = await request('GET', '/api/users', { headers: { cookie: s.cookie } });
      expect(users.status).toBe(403);
      const roles = await request('GET', '/api/users/roles', { headers: { cookie: s.cookie } });
      expect(roles.status).toBe(403);
    });

    it('смена роли действует сразу, без повторного входа', async () => {
      const id = await seedUser('demoted', 'operator');
      const target = await login('demoted');
      const admin = await login('admin');
      expect((await request('GET', '/api/admin/sources/1/health', { headers: { cookie: target.cookie } })).status).not.toBe(403);

      const user = await request('GET', `/api/users/${id}`, { headers: { cookie: admin.cookie } });
      const patched = await request('PATCH', `/api/users/${id}`, { headers: as(admin), body: { expectedVersion: user.body.version, role: 'viewer' } });
      expect(patched.status).toBe(200);
      const res = await request('GET', '/api/admin/sources/1/health', { headers: { cookie: target.cookie } });
      expect(res.status).toBe(403);
    });
  });

  describe('пароль', () => {
    it('выданный администратором пароль нужно сменить: до смены данные закрыты', async () => {
      const admin = await login('admin');
      const created = await request('POST', '/api/users', {
        headers: as(admin),
        body: { login: 'newbie', displayName: 'Новый сотрудник', role: 'viewer', password: 'Issued-Pass-4410' },
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ login: 'newbie', role: 'viewer', mustChangePassword: true, isActive: true });
      expect(JSON.stringify(created.body)).not.toContain('Issued-Pass-4410');
      expect(created.body).not.toHaveProperty('passwordHash');

      const s = await login('newbie', 'Issued-Pass-4410');
      expect((s.body.user as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
      const blocked = await request('GET', '/api/companies?q=ab', { headers: { cookie: s.cookie } });
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('password_change_required');

      const noCsrf = await request('POST', '/api/auth/password', { headers: { cookie: s.cookie, origin: ORIGIN }, body: { currentPassword: 'Issued-Pass-4410', newPassword: 'Own-Secret-Pass-9' } });
      expect(noCsrf.status).toBe(403);
      const badCurrent = await request('POST', '/api/auth/password', { headers: as(s), body: { currentPassword: 'nope-nope-nope', newPassword: 'Own-Secret-Pass-9' } });
      expect(badCurrent.status).toBe(400);
      const weak = await request('POST', '/api/auth/password', { headers: as(s), body: { currentPassword: 'Issued-Pass-4410', newPassword: 'short' } });
      expect(weak.status).toBe(400);
      expect(weak.body.code).toBe('weak_password');

      const changed = await request('POST', '/api/auth/password', { headers: as(s), body: { currentPassword: 'Issued-Pass-4410', newPassword: 'Own-Secret-Pass-9' } });
      expect(changed.status).toBe(200);
      expect((changed.body.user as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
      const open = await request('GET', '/api/companies?q=ab', { headers: { cookie: s.cookie } });
      expect([401, 403]).not.toContain(open.status);
    });

    it('после серии неудач вход закрыт на время, затем открывается', async () => {
      await seedUser('clumsy', 'viewer');
      for (let i = 0; i < 3; i += 1) expect((await tryLogin('clumsy', `wrong-${i}-pass`)).status).toBe(401);
      const locked = await tryLogin('clumsy', PASSWORD);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('locked');
      now += 61_000;
      await login('clumsy');
    });

    it('сброс пароля администратором закрывает все сессии пользователя', async () => {
      const id = await seedUser('forgetful', 'viewer');
      const victim = await login('forgetful');
      const admin = await login('admin');
      const reset = await request('POST', `/api/users/${id}/password`, { headers: as(admin), body: { password: 'Temporary-Pass-11' } });
      expect(reset.status).toBe(200);
      expect(reset.body.mustChangePassword).toBe(true);
      expect((await request('GET', '/api/auth/session', { headers: { cookie: victim.cookie } })).body.authenticated).toBe(false);
      await login('forgetful', 'Temporary-Pass-11');
    });
  });

  describe('администрирование пользователей', () => {
    it('выключенный пользователь теряет сессии и не входит даже с верным паролем', async () => {
      const id = await seedUser('leaver', 'operator');
      const s = await login('leaver');
      const admin = await login('admin');
      const user = await request('GET', `/api/users/${id}`, { headers: { cookie: admin.cookie } });
      const off = await request('PATCH', `/api/users/${id}`, { headers: as(admin), body: { expectedVersion: user.body.version, isActive: false } });
      expect(off.status).toBe(200);
      expect((await request('GET', '/api/admin/sources/1/health', { headers: { cookie: s.cookie } })).status).toBe(401);
      const again = await tryLogin('leaver', PASSWORD);
      expect(again.status).toBe(401);
      expect(again.body.code).toBe('bad_credentials');
    });

    it('правка без актуальной версии — 409; свою роль и доступ администратор не меняет', async () => {
      const admin = await login('admin');
      const me = (admin.body.user as { id: number }).id;
      const self = await request('GET', `/api/users/${me}`, { headers: { cookie: admin.cookie } });
      const stale = await request('PATCH', `/api/users/${me}`, { headers: as(admin), body: { expectedVersion: 999, displayName: 'Другое' } });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('version_conflict');
      const demote = await request('PATCH', `/api/users/${me}`, { headers: as(admin), body: { expectedVersion: self.body.version, role: 'viewer' } });
      expect(demote.status).toBe(409);
      expect(demote.body.code).toBe('self_change');
      const rename = await request('PATCH', `/api/users/${me}`, { headers: as(admin), body: { expectedVersion: self.body.version, displayName: 'Главный' } });
      expect(rename.status).toBe(200);
    });

    it('повтор логина, зарезервированный логин и слабый пароль — отказ с причиной', async () => {
      const admin = await login('admin');
      const body = { displayName: 'Кто-то', role: 'viewer', password: 'Good-Enough-Pass-1' };
      expect((await request('POST', '/api/users', { headers: as(admin), body: { ...body, login: 'reader' } })).status).toBe(409);
      expect((await request('POST', '/api/users', { headers: as(admin), body: { ...body, login: 'operator' } })).status).toBe(400);
      expect((await request('POST', '/api/users', { headers: as(admin), body: { ...body, login: 'Кириллица' } })).status).toBe(400);
      expect((await request('POST', '/api/users', { headers: as(admin), body: { ...body, login: 'weakling', password: '123' } })).status).toBe(400);
      expect((await request('POST', '/api/users', { headers: as(admin), body: { ...body, login: 'boss2', role: 'superuser' } })).status).toBe(400);
    });

    it('сессии пользователя видны и закрываются по одной; журнал без паролей', async () => {
      const id = await seedUser('traveller', 'viewer');
      const phone = await login('traveller');
      const laptop = await login('traveller');
      const admin = await login('admin');
      const list = await request('GET', `/api/users/${id}/sessions`, { headers: { cookie: admin.cookie } });
      const items = list.body.items as Array<{ id: number; ip: string }>;
      expect(items).toHaveLength(2);
      expect(items.every(s => s.ip.startsWith('203.0.113.'))).toBe(true);

      const target = items[items.length - 1]!.id;
      expect((await request('POST', `/api/users/${id}/sessions/${target}/revoke`, { headers: as(admin), body: {} })).status).toBe(200);
      const alive = await Promise.all([phone, laptop].map(s => request('GET', '/api/auth/session', { headers: { cookie: s.cookie } })));
      expect(alive.map(r => r.body.authenticated).filter(Boolean)).toHaveLength(1);

      const events = await request('GET', `/api/users/events?userId=${id}`, { headers: { cookie: admin.cookie } });
      const kinds = (events.body.items as Array<{ event: string }>).map(e => e.event);
      expect(kinds).toEqual(expect.arrayContaining(['user_created', 'login_succeeded', 'session_revoked']));
      const all = await request('GET', '/api/users/events?limit=200', { headers: { cookie: admin.cookie } });
      for (const secret of [PASSWORD, 'wrong-password-value', 'Issued-Pass-4410', 'Own-Secret-Pass-9', 'nobody-here']) {
        expect(JSON.stringify(all.body)).not.toContain(secret);
      }
    });

    it('роли и права отдаются для таблицы на экране', async () => {
      const admin = await login('admin');
      const res = await request('GET', '/api/users/roles', { headers: { cookie: admin.cookie } });
      expect(res.status).toBe(200);
      const roles = res.body.roles as Array<{ role: string; permissions: string[] }>;
      expect(roles.map(r => r.role)).toEqual(['admin', 'operator', 'viewer']);
      expect(roles.find(r => r.role === 'viewer')?.permissions).toEqual(['portal.read']);
    });
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

  it('сессия сообщает, что вход не нужен; запросы идут от локального оператора со всеми правами', async () => {
    const res = await request('GET', '/api/auth/session');
    expect(res.body).toMatchObject({ authRequired: false, authenticated: true, user: { login: 'operator', role: 'admin' } });
    expect(res.body).not.toHaveProperty('csrfToken');
  });

  it('входа нет: /api/auth/login не существует (изменение без правила — 403)', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: 'http://127.0.0.1:5173' }, body: { login: 'admin', password: PASSWORD } });
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('изменение без правила в таблице прав запрещено и локально', async () => {
    const res = await request('POST', '/api/no-such-route', { headers: { origin: 'http://127.0.0.1:5173' }, body: {} });
    expect(res.status).toBe(403);
  });

  it('Host — только loopback: публичное имя без PUBLIC_ORIGIN отклоняется', async () => {
    const res = await request('GET', '/api/health', { headers: { host: HOSTNAME } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('bad_host');
  });
});

describe('safeEqual', () => {
  it('сравнивает строки разной длины без исключения', () => {
    expect(safeEqual('a', 'abc')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});
