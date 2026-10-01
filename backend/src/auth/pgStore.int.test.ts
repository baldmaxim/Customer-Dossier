// Пользователи и сессии на настоящей базе (миграции 031, 033, 034, ADR-014): те же правила, что проверяет
// auth.test.ts на хранилище в памяти, плюс то, что держит сама база — уникальность логина,
// CHECK роли, неизменяемость журнала, гонка двух администраторов за «последнего», заявка на доступ,
// которую нельзя включить мимо одобрения, два одновременных решения по одной заявке и ключи доступа
// (полный цикл с программным аутентификатором, уникальность credential id, отзыв).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { SoftAuthenticator } from '../__tests__/softAuthenticator.js';
import { PasskeyService } from './passkeys.js';
import { pgAuthStore } from './pgStore.js';
import { AuthService, hashToken, type IActor } from './service.js';

const PASSWORD = 'Correct-Horse-7731';
const CLI: IActor = { id: null, login: 'cli' };
const META = { ip: '203.0.113.1', userAgent: 'int-test' };

let now = Date.parse('2026-09-30T10:00:00Z');
const service = new AuthService(pgAuthStore, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });

const seed = async (login: string, role: 'admin' | 'operator' | 'viewer'): Promise<number> => {
  const r = await service.createUser(CLI, { login, displayName: login, role, password: PASSWORD }, META);
  if (!r.ok) throw new Error(r.error);
  return r.user.id;
};

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('pgAuthStore', () => {
  it('создание, вход, сессия и выход', async () => {
    await seed('alpha', 'admin');
    expect(await service.createUser(CLI, { login: 'ALPHA', displayName: 'x', role: 'viewer', password: PASSWORD }, META)).toMatchObject({ code: 'login_taken' });

    const r = await service.login('alpha', PASSWORD, META);
    if (!r.ok) throw new Error(r.code);
    const ctx = await service.resolve(r.token);
    expect(ctx?.user).toMatchObject({ login: 'alpha', role: 'admin', mustChangePassword: true });

    const row = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM user_sessions WHERE token_hash = $1', [hashToken(r.token)]);
    expect(row.rows[0]?.n).toBe(1);
    const raw = await getPool().query<{ t: string }>('SELECT string_agg(encode(token_hash, \'hex\'), \'\') AS t FROM user_sessions');
    expect(raw.rows[0]?.t ?? '').not.toContain(Buffer.from(r.token).toString('hex'));

    await service.logout(r.token, META);
    expect(await service.resolve(r.token)).toBeNull();
  });

  it('блокировка после серии неудач и её истечение', async () => {
    await seed('bravo', 'viewer');
    for (let i = 0; i < 3; i += 1) expect((await service.login('bravo', 'wrong-pass-value', META)).ok).toBe(false);
    expect(await service.login('bravo', PASSWORD, META)).toMatchObject({ ok: false, code: 'locked' });
    now += 61_000;
    expect((await service.login('bravo', PASSWORD, META)).ok).toBe(true);
  });

  it('простой и отзыв сессий при выключении пользователя', async () => {
    const id = await seed('charlie', 'operator');
    const a = await service.login('charlie', PASSWORD, META);
    const b = await service.login('charlie', PASSWORD, META);
    if (!a.ok || !b.ok) throw new Error('вход не удался');
    expect((await service.listSessions(id))?.length).toBe(2);

    now += 30_000;
    expect(await service.resolve(a.token)).not.toBeNull();
    const user = await service.getUser(id);
    const off = await service.updateUser(CLI, id, { expectedVersion: user!.version, isActive: false }, META);
    expect(off.ok).toBe(true);
    expect(await service.resolve(a.token)).toBeNull();
    expect(await service.resolve(b.token)).toBeNull();
    expect((await service.listSessions(id))?.length).toBe(0);
  });

  it('последний администратор: две встречные правки не снимают обоих', async () => {
    const d = await seed('delta', 'admin');
    const alpha = (await pgAuthStore.findUserByLogin('alpha'))!;
    const delta = (await pgAuthStore.findUserById(d))!;
    const results = await Promise.all([
      service.updateUser(CLI, alpha.id, { expectedVersion: alpha.version, role: 'viewer' }, META),
      service.updateUser(CLI, delta.id, { expectedVersion: delta.version, role: 'viewer' }, META),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(results.filter(r => !r.ok && r.code === 'last_admin')).toHaveLength(1);
    const admins = await getPool().query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active");
    expect(admins.rows[0]?.n).toBe(1);
  });

  it('правка без актуальной версии — конфликт', async () => {
    const id = await seed('echo', 'viewer');
    expect((await service.updateUser(CLI, id, { expectedVersion: 1, displayName: 'Эхо' }, META)).ok).toBe(true);
    expect(await service.updateUser(CLI, id, { expectedVersion: 1, displayName: 'Эхо 2' }, META)).toMatchObject({ code: 'version_conflict' });
  });

  it('база держит роль, формат логина и неизменяемость журнала', async () => {
    await expect(
      getPool().query(`INSERT INTO users (login, display_name, role, password_hash, created_by) VALUES ('foxtrot', 'f', 'root', 'x', 'test')`),
    ).rejects.toThrow();
    await expect(
      getPool().query(`INSERT INTO users (login, display_name, role, password_hash, created_by) VALUES ('Foxtrot', 'f', 'viewer', 'x', 'test')`),
    ).rejects.toThrow();
    await expect(getPool().query('UPDATE auth_events SET actor = $1', ['someone'])).rejects.toThrow(/неизменяем/);
    await expect(getPool().query('DELETE FROM auth_events')).rejects.toThrow(/неизменяем/);
  });

  it('журнал читается страницами, новые сверху, без паролей', async () => {
    const page = await service.listEvents({ limit: 5 });
    expect(page).toHaveLength(5);
    expect(page[0]!.id).toBeGreaterThan(page[4]!.id);
    const next = await service.listEvents({ limit: 5, beforeId: page[4]!.id });
    expect(next[0]!.id).toBeLessThan(page[4]!.id);
    const all = JSON.stringify(await service.listEvents({ limit: 200 }));
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain('wrong-pass-value');
  });
});

describe('pgAuthStore: заявка на доступ (миграция 033)', () => {
  const ADMIN: IActor = { id: null, login: 'alpha' };
  const OWN = 'Quiet-River-Pass-7';

  it('созданные администратором и консолью — одобрены; колонка по умолчанию — approved', async () => {
    const id = await seed('foxtrot', 'viewer');
    expect((await pgAuthStore.findUserById(id))?.registration).toBe('approved');
    const raw = await getPool().query<{ registration: string }>(
      `INSERT INTO users (login, display_name, role, password_hash, created_by) VALUES ('golf', 'g', 'viewer', 'x', 'test') RETURNING registration`,
    );
    expect(raw.rows[0]?.registration).toBe('approved');
  });

  it('заявка — выключенный читатель; база не даёт включить её мимо одобрения', async () => {
    expect(await service.register({ login: 'hotel', displayName: 'Отель', password: OWN }, META)).toEqual({ ok: true });
    const row = await getPool().query<{ registration: string; is_active: boolean; role: string; must_change_password: boolean }>(
      'SELECT registration, is_active, role, must_change_password FROM users WHERE login = $1',
      ['hotel'],
    );
    expect(row.rows[0]).toEqual({ registration: 'pending', is_active: false, role: 'viewer', must_change_password: false });
    expect(await service.register({ login: 'HOTEL', displayName: 'Другой', password: OWN }, META)).toMatchObject({ code: 'login_taken' });

    await expect(getPool().query(`UPDATE users SET is_active = true WHERE login = 'hotel'`)).rejects.toThrow(/users_registration_inactive/);
    await expect(getPool().query(`UPDATE users SET registration = 'maybe' WHERE login = 'hotel'`)).rejects.toThrow(/users_registration_known/);
    const user = (await pgAuthStore.findUserByLogin('hotel'))!;
    expect(await service.updateUser(ADMIN, user.id, { expectedVersion: user.version, isActive: true }, META)).toMatchObject({ code: 'not_approved' });

    expect(await service.login('hotel', 'wrong-pass-value', META)).toEqual({ ok: false, code: 'bad_credentials' });
    expect(await service.login('hotel', OWN, META)).toEqual({ ok: false, code: 'registration_pending' });
    const sessions = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1', [user.id]);
    expect(sessions.rows[0]?.n).toBe(0);
  });

  it('два одновременных решения по одной заявке: проходит одно', async () => {
    const user = (await pgAuthStore.findUserByLogin('hotel'))!;
    const results = await Promise.all([
      service.approveRegistration(ADMIN, user.id, { expectedVersion: user.version, role: 'operator' }, META),
      service.rejectRegistration(ADMIN, user.id, { expectedVersion: user.version }, META),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    const after = (await pgAuthStore.findUserById(user.id))!;
    expect(after.version).toBe(user.version + 1);
    expect(after.isActive).toBe(after.registration === 'approved');
  });

  it('отклонение, вход с отказом, одобрение после отклонения; журнал принимает новые виды', async () => {
    expect((await service.register({ login: 'india', displayName: 'Индия', password: OWN }, META)).ok).toBe(true);
    const pending = (await pgAuthStore.findUserByLogin('india'))!;
    const rejected = await service.rejectRegistration(ADMIN, pending.id, { expectedVersion: pending.version }, META);
    expect(rejected).toMatchObject({ ok: true, user: { registration: 'rejected', isActive: false } });
    expect(await service.login('india', OWN, META)).toEqual({ ok: false, code: 'registration_rejected' });

    const approved = await service.approveRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1, role: 'viewer' }, META);
    expect(approved).toMatchObject({ ok: true, user: { registration: 'approved', isActive: true } });
    const r = await service.login('india', OWN, META);
    if (!r.ok) throw new Error(r.code);
    expect((await service.resolve(r.token))?.user.login).toBe('india');

    const events = await getPool().query<{ event: string }>('SELECT event FROM auth_events WHERE user_id = $1 ORDER BY id', [pending.id]);
    expect(events.rows.map(e => e.event)).toEqual([
      'registration_requested',
      'registration_rejected',
      'login_failed',
      'registration_approved',
      'login_succeeded',
    ]);
    const text = await getPool().query<{ t: string }>(`SELECT string_agg(details::text, ' ') AS t FROM auth_events`);
    expect(text.rows[0]?.t ?? '').not.toContain(OWN);
  });

  it('ключ доступа: добавление, вход без логина, счётчик, уникальность и отзыв на настоящей базе', async () => {
    const origin = 'https://radar.example.ru';
    const passkeys = new PasskeyService(pgAuthStore, service, { rpId: 'radar.example.ru', origin, rpName: 'Досье Заказчика', now: () => now });
    const device = new SoftAuthenticator();
    const id = await seed('juliet', 'viewer');
    await pgAuthStore.setPassword(id, (await pgAuthStore.findUserById(id))!.passwordHash, false, new Date(now));
    const r = await service.login('juliet', PASSWORD, META);
    if (!r.ok) throw new Error(r.code);

    const opts = await passkeys.registrationOptions(r.context, PASSWORD);
    if (!opts.ok) throw new Error(opts.code);
    const registration = device.create(opts.options, { origin, synced: false });
    const added = await passkeys.register(r.context, registration, 'YubiKey', META);
    if (!added.ok) throw new Error(added.code);
    expect(added.passkey).toMatchObject({ name: 'YubiKey', deviceType: 'singleDevice', backedUp: false });

    // Тот же credential id второй раз не записывается — его держит уникальный индекс.
    const stored = (await pgAuthStore.listPasskeys(id))[0]!;
    expect(await pgAuthStore.createPasskey({ ...stored, name: 'копия' }, new Date(now))).toBe('credential_taken');
    expect((await service.listUsers()).find(u => u.id === id)?.passkeys).toBe(1);

    now += 1_000;
    const login = await passkeys.login(device.get(await passkeys.loginOptions(), { origin, synced: false }), META);
    if (!login.ok) throw new Error(login.code);
    expect((await service.resolve(login.token))?.user.login).toBe('juliet');
    const row = await getPool().query<{ signCount: number; lastUsed: Date; lastLogin: Date }>(
      `SELECT p.sign_count AS "signCount", p.last_used_at AS "lastUsed", u.last_login_at AS "lastLogin"
         FROM user_passkeys p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
      [added.passkey.id],
    );
    expect(row.rows[0]).toMatchObject({ signCount: 1 });
    expect(row.rows[0]?.lastUsed.getTime()).toBe(now);
    expect(row.rows[0]?.lastLogin.getTime()).toBe(now);

    expect(await passkeys.revoke({ id: null, login: 'cli' }, id, added.passkey.id, META)).toEqual({ ok: true });
    expect(await pgAuthStore.findPasskey(stored.credentialId)).toBeNull();
    // Строка остаётся: по ней читается журнал; user.id для следующего ключа — прежний.
    expect((await pgAuthStore.findPasskeyUserHandle(id))?.equals(stored.userHandle)).toBe(true);
    const events = await getPool().query<{ event: string }>(
      `SELECT event FROM auth_events WHERE user_id = $1 AND event IN ('passkey_added', 'passkey_removed') ORDER BY id`,
      [id],
    );
    expect(events.rows.map(e => e.event)).toEqual(['passkey_added', 'passkey_removed']);
  });
});
