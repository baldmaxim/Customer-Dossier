// Вход по ключу доступа (ADR-014, дополнение 01.10.2026) без HTTP: полный цикл с программным
// аутентификатором и настоящей проверкой подписи, одноразовый вызов, привязка к адресу портала,
// обязательная проверка пользователя, отзыв, выключенный пользователь, блокировка по паролю.

import { beforeEach, describe, expect, it } from 'vitest';

import { SoftAuthenticator } from '../__tests__/softAuthenticator.js';
import { createMemoryAuthStore } from './memoryStore.js';
import { ChallengeStore, PasskeyService, passkeyRelyingParty } from './passkeys.js';
import { AuthService, type IActor, type IAuthContext } from './service.js';

const PASSWORD = 'Correct-Horse-7731';
const CLI: IActor = { id: null, login: 'cli' };
const META = { ip: '203.0.113.1', userAgent: 'test' };
const ORIGIN = 'https://radar.example.ru';
const RP = { rpId: 'radar.example.ru', origin: ORIGIN, rpName: 'Досье Заказчика' };

let now = Date.parse('2026-10-01T10:00:00Z');
let store = createMemoryAuthStore();
let auth = new AuthService(store, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });
let passkeys = new PasskeyService(store, auth, { ...RP, now: () => now });
let device = new SoftAuthenticator();

beforeEach(() => {
  now = Date.parse('2026-10-01T10:00:00Z');
  store = createMemoryAuthStore();
  auth = new AuthService(store, { idleMs: 60_000, maxMs: 600_000, lockThreshold: 3, lockMs: 60_000, now: () => now });
  passkeys = new PasskeyService(store, auth, { ...RP, now: () => now });
  device = new SoftAuthenticator();
});

/** Пользователь, сменивший выданный пароль, и его сессия. */
const signedIn = async (login = 'anna'): Promise<IAuthContext> => {
  const created = await auth.createUser(CLI, { login, displayName: 'Анна', role: 'viewer', password: PASSWORD }, META);
  if (!created.ok) throw new Error(created.error);
  await store.setPassword(created.user.id, (await store.findUserById(created.user.id))!.passwordHash, false, new Date(now));
  const r = await auth.login(login, PASSWORD, META);
  if (!r.ok) throw new Error(r.code);
  return r.context;
};

const addPasskey = async (ctx: IAuthContext, name = 'iPhone') => {
  const opts = await passkeys.registrationOptions(ctx, PASSWORD);
  if (!opts.ok) throw new Error(opts.code);
  const added = await passkeys.register(ctx, device.create(opts.options, { origin: ORIGIN }), name, META);
  if (!added.ok) throw new Error(added.code);
  return { options: opts.options, passkey: added.passkey };
};

describe('где работает вход ключом', () => {
  it('только сервер со входом и публичным адресом-доменом по https (или localhost)', () => {
    expect(passkeyRelyingParty('https://pulse.meridianai.ru', 'password')).toEqual({ rpId: 'pulse.meridianai.ru', origin: 'https://pulse.meridianai.ru' });
    expect(passkeyRelyingParty('http://localhost:4100', 'password')).toEqual({ rpId: 'localhost', origin: 'http://localhost:4100' });
    expect(passkeyRelyingParty(null, 'password')).toBeNull();
    expect(passkeyRelyingParty('https://pulse.meridianai.ru', 'none')).toBeNull();
    expect(passkeyRelyingParty('http://127.0.0.1:4100', 'password')).toBeNull();
    expect(passkeyRelyingParty('https://[::1]:4100', 'password')).toBeNull();
    expect(passkeyRelyingParty('http://portal.example.ru', 'password')).toBeNull();
  });
});

describe('добавление ключа', () => {
  it('только с верным текущим паролем; параметры требуют ключ на устройстве и проверку пользователя', async () => {
    const ctx = await signedIn();
    expect(await passkeys.registrationOptions(ctx, 'wrong-password-value')).toMatchObject({ ok: false, code: 'bad_password' });
    const opts = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!opts.ok) throw new Error(opts.code);
    expect(opts.options.rp).toEqual({ id: 'radar.example.ru', name: 'Досье Заказчика' });
    expect(opts.options.user.name).toBe('anna');
    expect(opts.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(opts.options.attestation).toBe('none');
  });

  it('ключ записывается без секретов, событие в журнале, второй ключ — с тем же user.id и списком исключений', async () => {
    const ctx = await signedIn();
    const first = await addPasskey(ctx, '  iPhone  ');
    expect(first.passkey).toMatchObject({ name: 'iPhone', deviceType: 'multiDevice', backedUp: true, lastUsedAt: null });
    expect(store.events.at(-1)).toMatchObject({ event: 'passkey_added', userId: ctx.user.id, actor: 'anna' });

    const second = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!second.ok) throw new Error(second.code);
    expect(second.options.user.id).toBe(first.options.user.id);
    expect(second.options.excludeCredentials?.map(c => c.id)).toEqual([device.credentials[0]!.id.toString('base64url')]);
  });

  it('выданный пароль сначала меняется', async () => {
    const ctx = await signedIn();
    const r = await passkeys.registrationOptions({ ...ctx, user: { ...ctx.user, mustChangePassword: true } }, PASSWORD);
    expect(r).toMatchObject({ ok: false, code: 'password_change_required' });
  });

  it('вызов привязан к сессии и одноразовый: другая сессия и повтор не проходят', async () => {
    const ctx = await signedIn();
    const opts = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!opts.ok) throw new Error(opts.code);
    const response = device.create(opts.options, { origin: ORIGIN });
    const other = { ...ctx, sessionId: (ctx.sessionId ?? 0) + 100 };
    expect(await passkeys.register(other, response, 'x', META)).toMatchObject({ ok: false, code: 'passkey_expired' });
    // Вызов снят первой попыткой, даже неудачной.
    expect(await passkeys.register(ctx, response, 'x', META)).toMatchObject({ ok: false, code: 'passkey_expired' });
  });

  it('ответ с чужого адреса или без проверки пользователя не принимается', async () => {
    const ctx = await signedIn();
    for (const soft of [{ origin: 'https://radar-example.ru.evil.test' }, { origin: ORIGIN, userVerified: false }]) {
      const opts = await passkeys.registrationOptions(ctx, PASSWORD);
      if (!opts.ok) throw new Error(opts.code);
      expect(await passkeys.register(ctx, device.create(opts.options, soft), 'x', META)).toMatchObject({ ok: false, code: 'passkey_invalid' });
    }
    expect(await passkeys.list(ctx.user.id)).toEqual([]);
  });

  it('название — до 60 символов, пустое — «Ключ доступа»', async () => {
    const ctx = await signedIn();
    const opts = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!opts.ok) throw new Error(opts.code);
    expect(await passkeys.register(ctx, device.create(opts.options, { origin: ORIGIN }), 'я'.repeat(61), META)).toMatchObject({ code: 'invalid_name' });
    expect((await addPasskey(ctx, '   ')).passkey.name).toBe('Ключ доступа');
  });
});

describe('вход ключом', () => {
  it('без логина: сессия, отметка ключа и последнего входа, в журнале — способ входа', async () => {
    const ctx = await signedIn();
    const { passkey } = await addPasskey(ctx);
    now += 5_000;
    const options = await passkeys.loginOptions();
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe('required');

    const r = await passkeys.login(device.get(options, { origin: ORIGIN }), META);
    if (!r.ok) throw new Error(r.code);
    expect(r.context.user.login).toBe('anna');
    expect((await auth.resolve(r.token))?.user.id).toBe(ctx.user.id);
    expect(store.events.at(-1)).toMatchObject({ event: 'login_succeeded', details: { method: 'passkey', passkeyId: passkey.id } });
    const [listed] = (await passkeys.list(ctx.user.id)) ?? [];
    expect(listed?.lastUsedAt).toBe(new Date(now).toISOString());
    expect((await store.findUserById(ctx.user.id))?.lastLoginAt?.getTime()).toBe(now);
  });

  it('тот же ответ дважды не входит: вызов одноразовый', async () => {
    await addPasskey(await signedIn());
    const response = device.get(await passkeys.loginOptions(), { origin: ORIGIN });
    expect((await passkeys.login(response, META)).ok).toBe(true);
    expect(await passkeys.login(response, META)).toEqual({ ok: false, code: 'passkey_expired' });
  });

  it('вызов живёт пять минут', async () => {
    await addPasskey(await signedIn());
    const options = await passkeys.loginOptions();
    now += 5 * 60_000 + 1;
    expect(await passkeys.login(device.get(options, { origin: ORIGIN }), META)).toEqual({ ok: false, code: 'passkey_expired' });
  });

  it('вызов добавления ключа не годится для входа', async () => {
    const ctx = await signedIn();
    await addPasskey(ctx);
    const reg = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!reg.ok) throw new Error(reg.code);
    const forged = device.get({ challenge: reg.options.challenge, rpId: RP.rpId }, { origin: ORIGIN });
    expect(await passkeys.login(forged, META)).toEqual({ ok: false, code: 'passkey_expired' });
  });

  it('чужой адрес (фишинг), другой RP ID и вход без проверки пользователя — отказ с записью в журнал', async () => {
    const ctx = await signedIn();
    await addPasskey(ctx);
    const attempts = [
      device.get(await passkeys.loginOptions(), { origin: 'https://radar.example.ru.evil.test' }),
      device.get({ ...(await passkeys.loginOptions()), rpId: 'evil.test' }, { origin: ORIGIN }),
      device.get(await passkeys.loginOptions(), { origin: ORIGIN, userVerified: false }),
    ];
    for (const response of attempts) expect(await passkeys.login(response, META)).toEqual({ ok: false, code: 'passkey_failed' });
    expect(store.events.filter(e => e.event === 'login_failed' && e.details.reason === 'passkey_invalid')).toHaveLength(3);
    expect(store.sessions.filter(s => s.userId === ctx.user.id)).toHaveLength(1);
  });

  it('откат счётчика подписей у аппаратного ключа — признак копии, отказ', async () => {
    const ctx = await signedIn();
    const opts = await passkeys.registrationOptions(ctx, PASSWORD);
    if (!opts.ok) throw new Error(opts.code);
    await passkeys.register(ctx, device.create(opts.options, { origin: ORIGIN, synced: false }), 'YubiKey', META);
    expect((await passkeys.login(device.get(await passkeys.loginOptions(), { origin: ORIGIN, synced: false, signCount: 5 }), META)).ok).toBe(true);
    const replayed = device.get(await passkeys.loginOptions(), { origin: ORIGIN, synced: false, signCount: 3 });
    expect(await passkeys.login(replayed, META)).toEqual({ ok: false, code: 'passkey_failed' });
  });

  it('отозванный ключ не входит: «ключа нет», с его идентификатором для браузера', async () => {
    const ctx = await signedIn();
    const { passkey } = await addPasskey(ctx);
    expect(await passkeys.removeOwn(ctx, passkey.id, META)).toEqual({ ok: true });
    expect(store.events.at(-1)).toMatchObject({ event: 'passkey_removed', actor: 'anna', details: { passkeyId: passkey.id } });
    const response = device.get(await passkeys.loginOptions(), { origin: ORIGIN });
    expect(await passkeys.login(response, META)).toEqual({ ok: false, code: 'passkey_unknown', credentialId: response.id });
    expect(await passkeys.removeOwn(ctx, passkey.id, META)).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('выключенный пользователь не входит и ключом — тот же отказ, что на неподошедший ключ', async () => {
    const ctx = await signedIn();
    await addPasskey(ctx);
    expect((await auth.updateUser(CLI, ctx.user.id, { expectedVersion: (await store.findUserById(ctx.user.id))!.version, isActive: false }, META)).ok).toBe(true);
    expect(await passkeys.login(device.get(await passkeys.loginOptions(), { origin: ORIGIN }), META)).toEqual({ ok: false, code: 'passkey_failed' });
    expect(store.events.at(-1)).toMatchObject({ event: 'login_failed', details: { method: 'passkey', reason: 'disabled' } });
  });

  it('блокировка после подбора пароля не запирает владельца ключа и не сбрасывается его входом', async () => {
    const ctx = await signedIn();
    await addPasskey(ctx);
    for (let i = 0; i < 3; i += 1) await auth.login('anna', 'wrong-password-value', META);
    expect(await auth.login('anna', PASSWORD, META)).toMatchObject({ ok: false, code: 'locked' });
    expect((await passkeys.login(device.get(await passkeys.loginOptions(), { origin: ORIGIN }), META)).ok).toBe(true);
    expect(await auth.login('anna', PASSWORD, META)).toMatchObject({ ok: false, code: 'locked' });
  });

  it('администратор видит ключи пользователя и отзывает их', async () => {
    const ctx = await signedIn();
    const { passkey } = await addPasskey(ctx);
    expect((await passkeys.list(ctx.user.id))?.map(p => p.id)).toEqual([passkey.id]);
    expect((await auth.listUsers()).find(u => u.id === ctx.user.id)?.passkeys).toBe(1);
    expect(await passkeys.revoke({ id: 99, login: 'boss' }, ctx.user.id, passkey.id, META)).toEqual({ ok: true });
    expect(store.events.at(-1)).toMatchObject({ event: 'passkey_removed', actor: 'boss' });
    expect(await passkeys.list(ctx.user.id)).toEqual([]);
    expect(await passkeys.list(12345)).toBeNull();
  });
});

describe('хранилище вызовов', () => {
  it('просроченные снимаются, при переполнении вытесняются самые старые', () => {
    const challenges = new ChallengeStore(1_000, 2);
    const entry = { purpose: 'login' as const, userId: null, sessionId: null, userHandle: null };
    challenges.put('a', entry, 0);
    challenges.put('b', entry, 10);
    challenges.put('c', entry, 20);
    expect(challenges.size).toBe(2);
    expect(challenges.take('a', 30)).toBeNull();
    expect(challenges.take('b', 30)).toEqual(entry);
    expect(challenges.take('b', 30)).toBeNull();
    challenges.put('d', entry, 2_000);
    expect(challenges.size).toBe(1);
    expect(challenges.take('d', 3_001)).toBeNull();
  });
});
