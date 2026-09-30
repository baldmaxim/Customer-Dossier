// Правила входа и управления пользователями (ADR-014) без HTTP: последний администратор,
// отзыв сессий при смене пароля, пересчёт устаревшего хеша, журнал без секретов.

import { beforeEach, describe, expect, it } from 'vitest';

import { createMemoryAuthStore } from './memoryStore.js';
import type { Role } from './permissions.js';
import { AuthService, csrfFor, hashToken, type IActor } from './service.js';

const PASSWORD = 'Correct-Horse-7731';
const CLI: IActor = { id: null, login: 'cli' };
const META = { ip: '203.0.113.1', userAgent: 'test' };

let now = Date.parse('2026-09-30T10:00:00Z');
let store = createMemoryAuthStore();
let service = new AuthService(store, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });

const seed = async (login: string, role: Role): Promise<number> => {
  const r = await service.createUser(CLI, { login, displayName: login, role, password: PASSWORD }, META);
  if (!r.ok) throw new Error(r.error);
  return r.user.id;
};

const loginOk = async (login: string, password = PASSWORD) => {
  const r = await service.login(login, password, META);
  if (!r.ok) throw new Error(r.code);
  return r;
};

beforeEach(() => {
  now = Date.parse('2026-09-30T10:00:00Z');
  store = createMemoryAuthStore();
  service = new AuthService(store, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });
});

describe('администраторы', () => {
  it('последний активный администратор не теряет роль и не выключается', async () => {
    const a = await seed('alpha', 'admin');
    const b = await seed('bravo', 'admin');
    const actorA: IActor = { id: a, login: 'alpha' };

    const demoteB = await service.updateUser(actorA, b, { expectedVersion: 1, role: 'operator' }, META);
    expect(demoteB.ok).toBe(true);
    // Теперь alpha — последний: консоль (не сам alpha) тоже не может его снять.
    const demoteA = await service.updateUser(CLI, a, { expectedVersion: 1, isActive: false }, META);
    expect(demoteA).toMatchObject({ ok: false, code: 'last_admin' });
    const renameA = await service.updateUser(CLI, a, { expectedVersion: 1, displayName: 'Альфа' }, META);
    expect(renameA.ok).toBe(true);
  });

  it('выключенный администратор не считается: последним остаётся активный', async () => {
    const a = await seed('alpha', 'admin');
    const b = await seed('bravo', 'admin');
    expect((await service.updateUser(CLI, b, { expectedVersion: 1, isActive: false }, META)).ok).toBe(true);
    expect(await service.updateUser(CLI, a, { expectedVersion: 1, role: 'viewer' }, META)).toMatchObject({ code: 'last_admin' });
  });
});

describe('сессии', () => {
  it('CSRF-токен выводится из идентификатора сессии, в хранилище только хеш', async () => {
    await seed('alpha', 'admin');
    const r = await loginOk('alpha');
    expect(r.context.csrfToken).toBe(csrfFor(r.token));
    expect(store.sessions[0]?.tokenHash.equals(hashToken(r.token))).toBe(true);
    expect(JSON.stringify(store.sessions)).not.toContain(r.token);
  });

  it('сессия не живёт дольше максимума даже при активности', async () => {
    // Отметка активности пишется не чаще раза в минуту: простой должен быть больше этого шага.
    service = new AuthService(store, { idleMs: 120_000, maxMs: 600_000, now: () => now });
    await seed('alpha', 'admin');
    const { token } = await loginOk('alpha');
    // 11 × 50 с = 550 с — ещё в пределах максимума 600 с; следующий шаг — ровно предел.
    for (let i = 0; i < 11; i += 1) {
      now += 50_000;
      expect(await service.resolve(token), `шаг ${i}`).not.toBeNull();
    }
    now += 50_000;
    expect(await service.resolve(token)).toBeNull();
  });

  it('смена пароля закрывает остальные сессии, текущая остаётся', async () => {
    await seed('alpha', 'viewer');
    const phone = await loginOk('alpha');
    const laptop = await loginOk('alpha');
    const ctx = (await service.resolve(laptop.token))!;
    const changed = await service.changePassword(ctx, PASSWORD, 'Brand-New-Pass-42', META);
    expect(changed.ok).toBe(true);
    expect(await service.resolve(phone.token)).toBeNull();
    expect(await service.resolve(laptop.token)).not.toBeNull();
    expect((await service.login('alpha', PASSWORD, META)).ok).toBe(false);
    await loginOk('alpha', 'Brand-New-Pass-42');
  });

  it('повторный вход из того же браузера закрывает прежнюю сессию', async () => {
    await seed('alpha', 'viewer');
    const first = await loginOk('alpha');
    const second = await service.login('alpha', PASSWORD, META, first.token);
    expect(second.ok).toBe(true);
    expect(await service.resolve(first.token)).toBeNull();
  });
});

describe('вход', () => {
  it('после порога неудач вход закрыт даже с верным паролем; по истечении — снова три попытки', async () => {
    await seed('alpha', 'viewer');
    for (let i = 0; i < 3; i += 1) expect(await service.login('alpha', 'wrong-pass-value', META)).toEqual({ ok: false, code: 'bad_credentials' });
    expect(await service.login('alpha', PASSWORD, META)).toMatchObject({ ok: false, code: 'locked' });
    now += 61_000;
    for (let i = 0; i < 2; i += 1) expect((await service.login('alpha', 'wrong-pass-value', META)).ok).toBe(false);
    await loginOk('alpha');
    expect((await store.findUserByLogin('alpha'))?.failedAttempts).toBe(0);
  });

  it('устаревший хеш пересчитывается при удачном входе', async () => {
    const id = await seed('alpha', 'viewer');
    const user = (await store.findUserById(id))!;
    // Хеш с прежними параметрами: подмена строки параметров делает его неверным, поэтому считаем честно.
    const crypto = await import('node:crypto');
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(PASSWORD, salt, 32, { N: 2 ** 12, r: 8, p: 1 });
    const legacy = `scrypt$ln=12,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`;
    await store.setPassword(id, legacy, false, new Date(now));
    await loginOk('alpha');
    const after = (await store.findUserById(id))!;
    expect(after.passwordHash).not.toBe(legacy);
    expect(after.passwordHash).not.toBe(user.passwordHash);
    expect(after.passwordHash.startsWith('scrypt$ln=14,')).toBe(true);
  });

  it('журнал входа не хранит пароли и введённый чужой логин', async () => {
    await seed('alpha', 'viewer');
    await service.login('alpha', 'typo-password-1', META);
    await service.login('PasswordTypedIntoLogin', PASSWORD, META);
    const text = JSON.stringify(store.events);
    for (const secret of [PASSWORD, 'typo-password-1', 'passwordtypedintologin', 'PasswordTypedIntoLogin']) expect(text).not.toContain(secret);
    expect(store.events.map(e => e.event)).toEqual(['user_created', 'login_failed', 'login_failed']);
  });
});

describe('заявка на доступ', () => {
  const ADMIN: IActor = { id: 1, login: 'alpha' };
  const request = (login = 'ivanov', password = 'Own-Secret-Pass-9') =>
    service.register({ login, displayName: '  Иван Иванов ', password }, META);

  it('заявка — выключенный читатель без смены пароля; журнал без пароля; сессии нет', async () => {
    expect(await service.register({ login: ' IvAnOv ', displayName: '  Иван Иванов ', password: 'Own-Secret-Pass-9' }, META)).toEqual({ ok: true });
    const user = (await store.findUserByLogin('ivanov'))!;
    expect(user).toMatchObject({
      login: 'ivanov',
      displayName: 'Иван Иванов',
      role: 'viewer',
      isActive: false,
      mustChangePassword: false,
      registration: 'pending',
      createdBy: 'ivanov',
    });
    expect(store.sessions).toHaveLength(0);
    expect(store.events.map(e => [e.event, e.actor, e.userId])).toEqual([['registration_requested', 'ivanov', user.id]]);
    expect(JSON.stringify(store.events)).not.toContain('Own-Secret-Pass-9');
    // Созданный администратором или консолью — одобрен сразу.
    const admin = await seed('alpha', 'admin');
    expect((await store.findUserById(admin))?.registration).toBe('approved');
  });

  it('те же правила логина, имени и пароля; занятый логин — 409 с понятным текстом', async () => {
    await seed('alpha', 'admin');
    expect(await request('alpha')).toMatchObject({ ok: false, status: 409, code: 'login_taken', error: 'Этот логин уже занят' });
    expect(await request('operator')).toMatchObject({ status: 400, code: 'invalid_login' });
    expect(await request('Кириллица')).toMatchObject({ status: 400, code: 'invalid_login' });
    expect(await request('ab')).toMatchObject({ status: 400, code: 'invalid_login' });
    expect(await service.register({ login: 'petrov', displayName: '   ', password: PASSWORD }, META)).toMatchObject({ status: 400, code: 'invalid_name' });
    expect(await request('petrov', 'short')).toMatchObject({ status: 400, code: 'weak_password' });
    expect(await request('petrov', 'petrov-2026-pass')).toMatchObject({ status: 400, code: 'weak_password' });
    expect(await request('petrov', 'aaaaaaaaaaaa')).toMatchObject({ status: 400, code: 'weak_password' });
    expect(await store.findUserByLogin('petrov')).toBeNull();
  });

  it('вход по заявке: неверный пароль — общий отказ, верный — «ещё не одобрена», без сессии', async () => {
    await request();
    expect(await service.login('ivanov', 'wrong-pass-value', META)).toEqual({ ok: false, code: 'bad_credentials' });
    expect(await service.login('nobody-here', 'wrong-pass-value', META)).toEqual({ ok: false, code: 'bad_credentials' });
    expect(await service.login('ivanov', 'Own-Secret-Pass-9', META)).toEqual({ ok: false, code: 'registration_pending' });
    expect(store.sessions).toHaveLength(0);
    const refusal = store.events.at(-1)!;
    expect(refusal).toMatchObject({ event: 'login_failed', actor: 'anonymous', details: { reason: 'registration_pending' } });
  });

  it('одобрение открывает вход с выбранной ролью; повтор и устаревшая версия — 409', async () => {
    await seed('alpha', 'admin');
    await request();
    const pending = (await store.findUserByLogin('ivanov'))!;
    expect(await service.approveRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1, role: 'operator' }, META)).toMatchObject({
      code: 'version_conflict',
    });

    const approved = await service.approveRegistration(ADMIN, pending.id, { expectedVersion: pending.version, role: 'operator' }, META);
    expect(approved).toMatchObject({ ok: true, user: { registration: 'approved', isActive: true, role: 'operator', mustChangePassword: false } });
    expect(store.events.at(-1)).toMatchObject({ event: 'registration_approved', actor: 'alpha', userId: pending.id, details: { role: 'operator' } });

    const again = await service.approveRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1, role: 'viewer' }, META);
    expect(again).toMatchObject({ status: 409, code: 'already_approved', error: 'Заявка уже одобрена' });
    expect(await service.rejectRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1 }, META)).toMatchObject({ code: 'already_approved' });

    const session = await loginOk('ivanov', 'Own-Secret-Pass-9');
    expect(session.context.user).toMatchObject({ role: 'operator', mustChangePassword: false });
  });

  it('отклонение: вход — «заявка отклонена», запись не удаляется; передумал — одобрить можно', async () => {
    await seed('alpha', 'admin');
    await request();
    const pending = (await store.findUserByLogin('ivanov'))!;
    const rejected = await service.rejectRegistration(ADMIN, pending.id, { expectedVersion: pending.version }, META);
    expect(rejected).toMatchObject({ ok: true, user: { registration: 'rejected', isActive: false, role: 'viewer' } });
    expect(store.events.at(-1)).toMatchObject({ event: 'registration_rejected', actor: 'alpha', userId: pending.id });
    expect(await service.rejectRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1 }, META)).toMatchObject({
      status: 409,
      code: 'already_rejected',
    });
    expect(await service.login('ivanov', 'wrong-pass-value', META)).toEqual({ ok: false, code: 'bad_credentials' });
    expect(await service.login('ivanov', 'Own-Secret-Pass-9', META)).toEqual({ ok: false, code: 'registration_rejected' });
    // Логин остаётся занятым: новая заявка под ним — отказ.
    expect(await request()).toMatchObject({ code: 'login_taken' });

    const later = await service.approveRegistration(ADMIN, pending.id, { expectedVersion: pending.version + 1, role: 'viewer' }, META);
    expect(later).toMatchObject({ ok: true, user: { registration: 'approved', isActive: true } });
    await loginOk('ivanov', 'Own-Secret-Pass-9');
  });

  it('переключатель доступа заявку не одобряет; несуществующая заявка — 404', async () => {
    await seed('alpha', 'admin');
    await request();
    const pending = (await store.findUserByLogin('ivanov'))!;
    expect(await service.updateUser(ADMIN, pending.id, { expectedVersion: pending.version, isActive: true }, META)).toMatchObject({
      status: 409,
      code: 'not_approved',
    });
    expect((await store.findUserById(pending.id))?.isActive).toBe(false);
    expect(await service.approveRegistration(ADMIN, 999, { expectedVersion: 1, role: 'viewer' }, META)).toMatchObject({ status: 404 });
  });
});
