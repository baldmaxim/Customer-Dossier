// Пользователи и сессии на настоящей базе (миграция 031, ADR-014): те же правила, что проверяет
// auth.test.ts на хранилище в памяти, плюс то, что держит сама база — уникальность логина,
// CHECK роли, неизменяемость журнала и гонка двух администраторов за «последнего».

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
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
