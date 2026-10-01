// Ключи доступа через HTTP (ADR-014, дополнение 01.10.2026): вход без логина ставит ту же cookie, что
// вход по паролю; свои ключи — только вошедшему и с CSRF-токеном; ключи других — только администратору;
// без публичного адреса-домена маршрутов нет. Хранилище — в памяти, база не нужна.

import type http from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';

import { close, listen, makeRequest } from '../__tests__/http.js';
import { SoftAuthenticator } from '../__tests__/softAuthenticator.js';
import { createApp } from '../app.js';
import { createMemoryAuthStore } from '../auth/memoryStore.js';
import { PasskeyService } from '../auth/passkeys.js';
import type { Role } from '../auth/permissions.js';
import { AuthService } from '../auth/service.js';
import { parseCookies, sessionCookieName } from './auth.js';

const HOSTNAME = 'radar.example.ru';
const ORIGIN = `https://${HOSTNAME}`;
const COOKIE = sessionCookieName(true);
const PASSWORD = 'Correct-Horse-7731';

interface ISession {
  cookie: string;
  csrf: string;
}

describe('ключи доступа: HTTP', () => {
  const store = createMemoryAuthStore();
  const service = new AuthService(store, { idleMs: 600_000, maxMs: 3_600_000 });
  const passkeys = new PasskeyService(store, service, { rpId: HOSTNAME, origin: ORIGIN, rpName: 'Досье Заказчика' });
  const device = new SoftAuthenticator();
  let server: http.Server;
  let port = 0;
  const request = makeRequest(() => port, () => HOSTNAME);
  let ipSeq = 0;
  const ip = (): string => `198.51.100.${(ipSeq += 1)}`;

  const seedUser = async (login: string, role: Role): Promise<number> => {
    const created = await service.createUser({ id: null, login: 'cli' }, { login, displayName: login, role, password: PASSWORD }, { ip: null, userAgent: null });
    if (!created.ok) throw new Error(created.error);
    await store.setPassword(created.user.id, (await store.findUserById(created.user.id))!.passwordHash, false, new Date());
    return created.user.id;
  };

  const cookieOf = (res: { headers: http.IncomingHttpHeaders }): string => {
    const id = parseCookies((res.headers['set-cookie']?.[0] ?? '').split(';')[0])[COOKIE] ?? '';
    expect(id).not.toBe('');
    return `${COOKIE}=${id}`;
  };

  const login = async (name: string): Promise<ISession> => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN, 'x-forwarded-for': ip() }, body: { login: name, password: PASSWORD } });
    expect(res.status).toBe(200);
    return { cookie: cookieOf(res), csrf: String(res.body.csrfToken) };
  };

  const as = (s: ISession, csrf = true) => ({ cookie: s.cookie, origin: ORIGIN, 'x-forwarded-for': ip(), ...(csrf ? { 'x-csrf-token': s.csrf } : {}) });

  const addPasskey = async (s: ISession, name: string): Promise<number> => {
    const opts = await request('POST', '/api/auth/passkeys/options', { headers: as(s), body: { currentPassword: PASSWORD } });
    expect(opts.status, JSON.stringify(opts.body)).toBe(200);
    const response = device.create(opts.body.options as PublicKeyCredentialCreationOptionsJSON, { origin: ORIGIN });
    const added = await request('POST', '/api/auth/passkeys', { headers: as(s), body: { response, name } });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    return Number(added.body.id);
  };

  const passkeyLogin = async () => {
    const opts = await request('POST', '/api/auth/passkey/options', { headers: { origin: ORIGIN, 'x-forwarded-for': ip() } });
    expect(opts.status).toBe(200);
    const response = device.get(opts.body.options as PublicKeyCredentialRequestOptionsJSON, { origin: ORIGIN });
    return request('POST', '/api/auth/passkey', { headers: { origin: ORIGIN, 'x-forwarded-for': ip() }, body: { response } });
  };

  let annaId = 0;

  beforeAll(async () => {
    await seedUser('admin', 'admin');
    annaId = await seedUser('anna', 'viewer');
    ({ server, port } = await listen(
      createApp({
        auth: { mode: 'password', service, secureCookie: true, maxAgeSec: 3600, passkeys },
        allowedOrigins: [ORIGIN],
        allowedHostnames: [HOSTNAME],
        trustProxy: true,
      }),
    ));
  });

  afterAll(() => close(server));

  it('сессия сообщает, что вход ключом доступен', async () => {
    const res = await request('GET', '/api/auth/session');
    expect(res.body).toEqual({ authRequired: true, authenticated: false, passkeys: true });
  });

  it('признак ключей — и в ответе входа паролем и выхода: экран не теряет кнопку до перезагрузки', async () => {
    const res = await request('POST', '/api/auth/login', { headers: { origin: ORIGIN, 'x-forwarded-for': ip() }, body: { login: 'anna', password: PASSWORD } });
    expect(res.body).toMatchObject({ authenticated: true, passkeys: true });
    const out = await request('POST', '/api/auth/logout', { headers: { cookie: cookieOf(res), origin: ORIGIN } });
    expect(out.body).toEqual({ authRequired: true, authenticated: false, passkeys: true });
  });

  it('свои ключи — только вошедшему, изменения — с CSRF-токеном и паролем', async () => {
    expect((await request('GET', '/api/auth/passkeys')).status).toBe(401);
    const anna = await login('anna');
    const noCsrf = await request('POST', '/api/auth/passkeys/options', { headers: as(anna, false), body: { currentPassword: PASSWORD } });
    expect(noCsrf).toMatchObject({ status: 403, body: { code: 'csrf' } });
    const badPassword = await request('POST', '/api/auth/passkeys/options', { headers: as(anna), body: { currentPassword: 'wrong-password-value' } });
    expect(badPassword).toMatchObject({ status: 400, body: { code: 'bad_password' } });
    expect(JSON.stringify(badPassword.body)).not.toContain('wrong-password-value');
  });

  it('добавленным ключом входят без логина: та же cookie сессии, что по паролю', async () => {
    const anna = await login('anna');
    const id = await addPasskey(anna, 'iPhone');
    const mine = await request('GET', '/api/auth/passkeys', { headers: { cookie: anna.cookie } });
    expect(mine.body.items).toEqual([expect.objectContaining({ id, name: 'iPhone', deviceType: 'multiDevice' })]);
    expect(JSON.stringify(mine.body)).not.toMatch(/publicKey|credentialId|userHandle/);

    const res = await passkeyLogin();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, passkeys: true, user: { login: 'anna', role: 'viewer' } });
    const setCookie = res.headers['set-cookie']?.[0] ?? '';
    for (const attr of ['HttpOnly', 'SameSite=Strict', 'Secure']) expect(setCookie).toContain(attr);
    const session = await request('GET', '/api/auth/session', { headers: { cookie: cookieOf(res) } });
    expect(session.body).toMatchObject({ authenticated: true, user: { login: 'anna' } });
  });

  it('чужой ответ не разбирается: 400 без эха тела', async () => {
    const res = await request('POST', '/api/auth/passkey', { headers: { origin: ORIGIN }, body: { response: { id: '<script>', rawId: 'x' } } });
    expect(res).toMatchObject({ status: 400, body: { code: 'invalid' } });
    expect(JSON.stringify(res.body)).not.toContain('<script>');
  });

  it('администратор видит ключи пользователя и отзывает их; читатель — нет', async () => {
    const admin = await login('admin');
    const anna = await login('anna');
    const list = await request('GET', `/api/users/${annaId}/passkeys`, { headers: { cookie: admin.cookie } });
    expect(list.body.enabled).toBe(true);
    const items = list.body.items as Array<{ id: number }>;
    expect(items.length).toBeGreaterThan(0);
    const users = await request('GET', '/api/users', { headers: { cookie: admin.cookie } });
    expect((users.body.items as Array<{ login: string; passkeys: number }>).find(u => u.login === 'anna')?.passkeys).toBe(items.length);

    expect((await request('GET', `/api/users/${annaId}/passkeys`, { headers: { cookie: anna.cookie } })).status).toBe(403);
    const byViewer = await request('POST', `/api/users/${annaId}/passkeys/${items[0]!.id}/revoke`, { headers: as(anna) });
    expect(byViewer.status).toBe(403);

    for (const item of items) {
      const revoked = await request('POST', `/api/users/${annaId}/passkeys/${item.id}/revoke`, { headers: as(admin) });
      expect(revoked.status).toBe(200);
    }
    const res = await passkeyLogin();
    expect(res).toMatchObject({ status: 401, body: { code: 'passkey_unknown', rpId: HOSTNAME } });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('свой ключ убирается из профиля', async () => {
    const anna = await login('anna');
    const id = await addPasskey(anna, 'Ноутбук');
    expect((await request('DELETE', `/api/auth/passkeys/${id}`, { headers: as(anna, false) })).status).toBe(403);
    expect((await request('DELETE', `/api/auth/passkeys/${id}`, { headers: as(anna) })).status).toBe(200);
    expect((await request('DELETE', `/api/auth/passkeys/${id}`, { headers: as(anna) })).body).toMatchObject({ code: 'not_found' });
  });
});

describe('ключи доступа выключены без публичного адреса-домена', () => {
  const LOCAL_ORIGIN = 'http://127.0.0.1:4100';
  const store = createMemoryAuthStore();
  const service = new AuthService(store, { idleMs: 600_000, maxMs: 3_600_000 });
  let server: http.Server;
  let port = 0;
  const request = makeRequest(() => port, () => '127.0.0.1');

  beforeAll(async () => {
    ({ server, port } = await listen(
      createApp({ auth: { mode: 'password', service, secureCookie: false, maxAgeSec: 3600, passkeys: null }, allowedOrigins: [LOCAL_ORIGIN] }),
    ));
  });

  afterAll(() => close(server));

  it('сессия молчит о ключах, маршруты — 404', async () => {
    expect((await request('GET', '/api/auth/session')).body).toEqual({ authRequired: true, authenticated: false });
    const res = await request('POST', '/api/auth/passkey/options', { headers: { origin: LOCAL_ORIGIN } });
    expect(res).toMatchObject({ status: 404, body: { code: 'passkeys_disabled' } });
  });
});
