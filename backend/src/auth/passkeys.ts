// Вход по ключу доступа (passkey, WebAuthn) — ADR-014, дополнение 01.10.2026. HTTP — api/passkeys.ts.
//
// Что держит сервис:
//   - подпись проверяет @simplewebauthn/server; origin и RP ID — из PUBLIC_ORIGIN. Проверка пользователя
//     (биометрия или PIN устройства) обязательна: ключ — единственный фактор входа, одного касания мало;
//   - вызов (challenge) одноразовый и живёт пять минут: хранится в памяти процесса и снимается при первой
//     проверке, удачной или нет, — повтор того же ответа не пройдёт. Перезапуск API теряет только начатые
//     за эти минуты попытки;
//   - добавить ключ может только вошедший, сменивший выданный пароль и подтвердивший текущий пароль:
//     украденная сессия не превращается в постоянный вход;
//   - вход ключом не смотрит на блокировку после неудачных паролей и не сбрасывает её: подбор пароля
//     не запирает владельца ключа и не получает новых попыток. Выключенный пользователь и заявка не входят
//     и ключом — отказ тот же, что на неподошедший ключ;
//   - вход без логина: аутентификатор сам предлагает сохранённые ключи портала (discoverable credential).

import crypto from 'node:crypto';
import net from 'node:net';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

import { verifyPassword } from './password.js';
import { displayNameProblem, fail, type AuthService, type IActor, type IAuthContext, type IRequestMeta, type IServiceError } from './service.js';
import type { IAuthStore, IPasskeyRecord, PasskeyDeviceType } from './store.js';

export interface IPasskeyView {
  id: number;
  name: string;
  /** multiDevice — синхронизируется между устройствами (iCloud, Google), singleDevice — живёт на одном. */
  deviceType: PasskeyDeviceType;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export const toPasskeyView = (p: IPasskeyRecord): IPasskeyView => ({
  id: p.id,
  name: p.name,
  deviceType: p.deviceType,
  backedUp: p.backedUp,
  createdAt: p.createdAt.toISOString(),
  lastUsedAt: p.lastUsedAt === null ? null : p.lastUsedAt.toISOString(),
});

export interface IPasskeyRelyingParty {
  /** Домен портала: ключ привязан к нему и на другом адресе не сработает. */
  rpId: string;
  origin: string;
}

/**
 * Где работают ключи: только на сервере со входом и с публичным адресом-доменом. По IP-адресу браузер
 * ключ не создаст, а вне https (кроме localhost) WebAuthn недоступен. null — вход ключом выключен.
 */
export const passkeyRelyingParty = (publicOrigin: string | null, mode: 'none' | 'password'): IPasskeyRelyingParty | null => {
  if (mode !== 'password' || publicOrigin === null) return null;
  const url = new URL(publicOrigin);
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) return null;
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
  return { rpId: url.hostname, origin: url.origin };
};

interface IChallenge {
  purpose: 'register' | 'login';
  userId: number | null;
  sessionId: number | null;
  /** user.id WebAuthn, выданный в параметрах добавления: тот же уходит в запись ключа. */
  userHandle: Buffer | null;
  expiresAt: number;
}

/** Одноразовые вызовы в памяти процесса. Предел числа — чтобы поток запросов параметров не съел память. */
export class ChallengeStore {
  private readonly items = new Map<string, IChallenge>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxItems: number,
  ) {}

  put(challenge: string, value: Omit<IChallenge, 'expiresAt'>, now: number): void {
    // Срок у всех вызовов один, поэтому порядок вставки — порядок истечения: просроченные — в начале.
    for (const [key, item] of this.items) {
      if (item.expiresAt > now) break;
      this.items.delete(key);
    }
    while (this.items.size >= this.maxItems) {
      const oldest = this.items.keys().next();
      if (oldest.done) break;
      this.items.delete(oldest.value);
    }
    this.items.set(challenge, { ...value, expiresAt: now + this.ttlMs });
  }

  /** Вызов снимается при первом обращении, даже если дальше ответ не подойдёт. */
  take(challenge: string, now: number): Omit<IChallenge, 'expiresAt'> | null {
    const found = this.items.get(challenge);
    if (!found) return null;
    this.items.delete(challenge);
    if (found.expiresAt <= now) return null;
    const { expiresAt: _expiresAt, ...entry } = found;
    return entry;
  }

  get size(): number {
    return this.items.size;
  }
}

/** Вызов из clientDataJSON ответа: по нему находится запись о начатой попытке. */
const challengeOf = (clientDataJSON: unknown): string | null => {
  if (typeof clientDataJSON !== 'string') return null;
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof parsed.challenge === 'string' && parsed.challenge !== '' ? parsed.challenge : null;
  } catch {
    return null;
  }
};

const TRANSPORTS: ReadonlySet<string> = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

const knownTransports = (list: readonly string[]): AuthenticatorTransportFuture[] =>
  list.filter((t): t is AuthenticatorTransportFuture => TRANSPORTS.has(t));

export const PASSKEY_NAME_MAX = 60;

export type PasskeyLoginResult =
  | { ok: true; token: string; context: IAuthContext }
  /** Попытка не начиналась здесь или истекла: начать заново. */
  | { ok: false; code: 'passkey_expired' }
  /** Ключа нет на портале (удалён или от другого сайта): браузер может убрать его из менеджера паролей. */
  | { ok: false; code: 'passkey_unknown'; credentialId: string }
  /** Подпись не прошла, ключ отозван у выключенного пользователя или заявки. */
  | { ok: false; code: 'passkey_failed' };

export interface IPasskeyServiceOptions extends IPasskeyRelyingParty {
  rpName: string;
  /** Сколько живёт начатая попытка; столько же браузер ждёт человека. */
  challengeTtlMs?: number;
  maxChallenges?: number;
  /** Ключей на пользователя. */
  maxPerUser?: number;
  now?: () => number;
}

export class PasskeyService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPerUser: number;
  private readonly challenges: ChallengeStore;

  constructor(
    private readonly store: IAuthStore,
    private readonly auth: AuthService,
    private readonly options: IPasskeyServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.challengeTtlMs ?? 5 * 60_000;
    this.maxPerUser = options.maxPerUser ?? 20;
    this.challenges = new ChallengeStore(this.ttlMs, options.maxChallenges ?? 2000);
  }

  get rpId(): string {
    return this.options.rpId;
  }

  /** Своими ключами управляет вошедший, сменивший выданный пароль. */
  private ownerProblem(ctx: IAuthContext): IServiceError | null {
    if (ctx.sessionId === null) return fail(400, 'no_session', 'Без входа ключей доступа нет');
    if (ctx.user.mustChangePassword) return fail(403, 'password_change_required', 'Сначала смените выданный пароль');
    return null;
  }

  // ─── Добавление ключа ─────────────────────────────────────────────────────────

  async registrationOptions(ctx: IAuthContext, currentPassword: string): Promise<{ ok: true; options: PublicKeyCredentialCreationOptionsJSON } | IServiceError> {
    const problem = this.ownerProblem(ctx);
    if (problem) return problem;
    const user = await this.store.findUserById(ctx.user.id);
    if (!user) return fail(404, 'not_found', 'Пользователь не найден');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) return fail(400, 'bad_password', 'Текущий пароль неверен');

    const existing = await this.store.listPasskeys(user.id);
    if (existing.length >= this.maxPerUser) {
      return fail(409, 'too_many_passkeys', `Ключей уже ${this.maxPerUser} — сначала уберите ненужный`);
    }
    const userHandle = (await this.store.findPasskeyUserHandle(user.id)) ?? crypto.randomBytes(32);
    const options = await generateRegistrationOptions({
      rpName: this.options.rpName,
      rpID: this.options.rpId,
      userName: user.login,
      userID: new Uint8Array(userHandle),
      userDisplayName: user.displayName,
      timeout: this.ttlMs,
      attestationType: 'none',
      // Устройство не даст добавить второй ключ туда, где ключ портала уже есть.
      excludeCredentials: existing.map(p => ({ id: p.credentialId.toString('base64url'), transports: knownTransports(p.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.challenges.put(options.challenge, { purpose: 'register', userId: user.id, sessionId: ctx.sessionId, userHandle }, this.now());
    return { ok: true, options };
  }

  async register(
    ctx: IAuthContext,
    response: RegistrationResponseJSON,
    rawName: string,
    meta: IRequestMeta,
  ): Promise<{ ok: true; passkey: IPasskeyView } | IServiceError> {
    const problem = this.ownerProblem(ctx);
    if (problem) return problem;
    const name = rawName.trim() === '' ? 'Ключ доступа' : rawName.trim();
    if ([...name].length > PASSKEY_NAME_MAX) return fail(400, 'invalid_name', `Название — до ${PASSKEY_NAME_MAX} символов`);
    if (displayNameProblem(name)) return fail(400, 'invalid_name', 'Название содержит управляющие символы');

    const now = this.now();
    const challenge = challengeOf(response.response?.clientDataJSON);
    const started = challenge === null ? null : this.challenges.take(challenge, now);
    if (!challenge || !started || started.purpose !== 'register' || started.userId !== ctx.user.id || started.sessionId !== ctx.sessionId || !started.userHandle) {
      return fail(400, 'passkey_expired', 'Время на добавление ключа вышло — начните заново');
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.options.origin,
        expectedRPID: this.options.rpId,
        requireUserVerification: true,
      });
    } catch {
      verification = { verified: false };
    }
    if (!verification.verified) return fail(400, 'passkey_invalid', 'Устройство вернуло ответ, который не прошёл проверку');

    const info = verification.registrationInfo;
    const created = await this.store.createPasskey(
      {
        userId: ctx.user.id,
        credentialId: Buffer.from(info.credential.id, 'base64url'),
        publicKey: Buffer.from(info.credential.publicKey),
        signCount: info.credential.counter,
        transports: knownTransports(info.credential.transports ?? []),
        userHandle: started.userHandle,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid,
        name,
      },
      new Date(now),
    );
    if (created === 'credential_taken') return fail(409, 'passkey_exists', 'Этот ключ уже добавлен');
    await this.store.logEvent(
      { event: 'passkey_added', userId: ctx.user.id, actor: ctx.user.login, ip: meta.ip, details: { passkeyId: created.id, deviceType: created.deviceType } },
      new Date(now),
    );
    return { ok: true, passkey: toPasskeyView(created) };
  }

  // ─── Вход ключом ──────────────────────────────────────────────────────────────

  /** Параметры входа без логина: список ключей пуст — устройство предложит сохранённые ключи портала. */
  async loginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({ rpID: this.options.rpId, userVerification: 'required', timeout: this.ttlMs });
    this.challenges.put(options.challenge, { purpose: 'login', userId: null, sessionId: null, userHandle: null }, this.now());
    return options;
  }

  async login(response: AuthenticationResponseJSON, meta: IRequestMeta, previousToken?: string): Promise<PasskeyLoginResult> {
    const now = new Date(this.now());
    const challenge = challengeOf(response.response?.clientDataJSON);
    const started = challenge === null ? null : this.challenges.take(challenge, now.getTime());
    if (!challenge || !started || started.purpose !== 'login') return { ok: false, code: 'passkey_expired' };

    const failed = async (userId: number | null, reason: string): Promise<PasskeyLoginResult> => {
      await this.store.logEvent({ event: 'login_failed', userId, actor: 'anonymous', ip: meta.ip, details: { method: 'passkey', reason } }, now);
      return { ok: false, code: 'passkey_failed' };
    };

    const passkey = await this.store.findPasskey(Buffer.from(response.id, 'base64url'));
    if (!passkey) {
      await this.store.logEvent(
        { event: 'login_failed', userId: null, actor: 'anonymous', ip: meta.ip, details: { method: 'passkey', reason: 'passkey_unknown' } },
        now,
      );
      return { ok: false, code: 'passkey_unknown', credentialId: response.id };
    }
    const userHandle = response.response.userHandle;
    if (userHandle !== undefined && userHandle !== passkey.userHandle.toString('base64url')) return failed(passkey.userId, 'passkey_invalid');

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | null;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.options.origin,
        expectedRPID: this.options.rpId,
        credential: {
          id: passkey.credentialId.toString('base64url'),
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.signCount,
          transports: knownTransports(passkey.transports),
        },
        requireUserVerification: true,
      });
    } catch {
      // Сюда же — откат счётчика подписей у аппаратного ключа: признак его копии.
      verification = null;
    }
    if (!verification?.verified) return failed(passkey.userId, 'passkey_invalid');

    const user = await this.store.findUserById(passkey.userId);
    if (!user) return failed(null, 'passkey_invalid');
    if (user.registration !== 'approved') return failed(user.id, user.registration === 'pending' ? 'registration_pending' : 'registration_rejected');
    if (!user.isActive) return failed(user.id, 'disabled');

    const info = verification.authenticationInfo;
    await this.store.recordPasskeyUse(passkey.id, info.newCounter, info.credentialBackedUp, now);
    const session = await this.auth.startSession(user, meta, previousToken, { method: 'passkey', passkeyId: passkey.id }, now);
    return { ok: true, ...session };
  }

  // ─── Список и отзыв ───────────────────────────────────────────────────────────

  async list(userId: number): Promise<IPasskeyView[] | null> {
    const user = await this.store.findUserById(userId);
    if (!user) return null;
    return (await this.store.listPasskeys(userId)).map(toPasskeyView);
  }

  /** Свои ключи — в профиле. */
  async listOwn(ctx: IAuthContext): Promise<{ ok: true; items: IPasskeyView[] } | IServiceError> {
    if (ctx.sessionId === null) return fail(400, 'no_session', 'Без входа ключей доступа нет');
    return { ok: true, items: (await this.list(ctx.user.id)) ?? [] };
  }

  async removeOwn(ctx: IAuthContext, passkeyId: number, meta: IRequestMeta): Promise<{ ok: true } | IServiceError> {
    if (ctx.sessionId === null) return fail(400, 'no_session', 'Без входа ключей доступа нет');
    return this.revoke({ id: ctx.user.id, login: ctx.user.login }, ctx.user.id, passkeyId, meta);
  }

  /** Отзыв ключа самим пользователем или администратором. Строка остаётся: по ней читается журнал. */
  async revoke(actor: IActor, userId: number, passkeyId: number, meta: IRequestMeta): Promise<{ ok: true } | IServiceError> {
    const now = new Date(this.now());
    const revoked = await this.store.revokePasskey(userId, passkeyId, actor.login, now);
    if (!revoked) return fail(404, 'not_found', 'Ключ не найден или уже убран');
    await this.store.logEvent({ event: 'passkey_removed', userId, actor: actor.login, ip: meta.ip, details: { passkeyId } }, now);
    return { ok: true };
  }
}
