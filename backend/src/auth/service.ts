// Вход, сессии и управление пользователями (ADR-014). HTTP-слой — api/auth.ts и api/users.routes.ts,
// консоль — auth/cli.ts; оба ходят сюда, правила в одном месте.
//
// Что держит сервис:
//   - идентификатор сессии — 256 случайных бит; в базе только его sha256, CSRF-токен выводится из него же
//     и нигде не хранится;
//   - на чужой логин ответ тот же и за то же время, что на неверный пароль (сравнение с фиктивным хешем);
//   - после `lockThreshold` неудач подряд вход блокируется на `lockMs`; выключенный пользователь
//     узнаёт об этом только после верного пароля — и получает тот же отказ;
//   - смена пароля отзывает остальные сессии пользователя, сброс и выключение — все;
//   - администратор не снимает роль и не выключает сам себя; последний администратор остаётся;
//   - заявка на доступ (самостоятельная регистрация) — выключенный читатель: войти можно только после
//     одобрения администратором. О состоянии заявки человек узнаёт только после верного пароля.

import crypto from 'node:crypto';

import { PERMISSIONS, permissionsOf, type Permission, type Role } from './permissions.js';
import { dummyHash, hashPassword, needsRehash, passwordProblem, verifyPassword } from './password.js';
import type { IAuthEventRecord, IAuthStore, ISessionRecord, IUserRecord, RegistrationDecision, RegistrationState } from './store.js';

export interface IAuthUser {
  id: number;
  login: string;
  displayName: string;
  role: Role;
  permissions: readonly Permission[];
  mustChangePassword: boolean;
}

export interface IAuthContext {
  user: IAuthUser;
  /** null — локальный режим без входа. */
  sessionId: number | null;
  csrfToken: string | null;
  expiresAt: Date | null;
}

/** Кто совершает действие: пользователь портала или консоль. */
export interface IActor {
  id: number | null;
  login: string;
}

export interface IRequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Локальная работа (AUTH_MODE=none): один оператор на loopback, все права. Логин — прежний
 * 'operator': так подписаны решения и журналы, записанные до появления пользователей.
 */
export const LOCAL_CONTEXT: IAuthContext = Object.freeze({
  user: Object.freeze({
    id: 0,
    login: 'operator',
    displayName: 'Оператор',
    role: 'admin' as const,
    permissions: PERMISSIONS,
    mustChangePassword: false,
  }),
  sessionId: null,
  csrfToken: null,
  expiresAt: null,
});

export const actorOfContext = (ctx: IAuthContext): IActor => ({ id: ctx.sessionId === null ? null : ctx.user.id, login: ctx.user.login });

/** Логин — латиница в нижнем регистре, цифры и `._@-`; почта подходит. */
export const LOGIN_RE = /^[a-z0-9][a-z0-9._@-]{2,63}$/;

/** Эти имена уже стоят в журналах как системные исполнители: пользователь с таким логином путал бы атрибуцию. */
export const RESERVED_LOGINS: ReadonlySet<string> = new Set(['operator', 'system', 'cli', 'anonymous', 'registry', 'test-suite']);

export const normalizeLogin = (raw: string): string => raw.trim().toLowerCase();

export const loginProblem = (login: string): string | null => {
  if (!LOGIN_RE.test(login)) return 'Логин — от 3 до 64 символов: латинские буквы, цифры, точка, дефис, подчёркивание, @';
  if (RESERVED_LOGINS.has(login)) return 'Этот логин зарезервирован системой';
  return null;
};

const displayNameProblem = (name: string): string | null => {
  if (name.length < 1 || name.length > 120) return 'Имя — от 1 до 120 символов';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'Имя содержит управляющие символы';
  return null;
};

const sha256 = (value: string): Buffer => crypto.createHash('sha256').update(value, 'utf8').digest();

export const hashToken = (token: string): Buffer => sha256(`tgi-session:${token}`);

/** CSRF-токен выводится из идентификатора сессии: хранить нечего, а из хеша в базе его не получить. */
export const csrfFor = (token: string): string => sha256(`tgi-csrf:${token}`).toString('base64url');

export const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(sha256(a), sha256(b));

export interface IUserView {
  id: number;
  login: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  version: number;
  /** pending — заявка ждёт решения, rejected — отклонена; обе не входят. */
  registration: RegistrationState;
  liveSessions?: number;
}

export interface ISessionView {
  id: number;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Хеш пароля и прочее внутреннее наружу не уходит. */
export const toUserView = (u: IUserRecord & { liveSessions?: number }, now: Date): IUserView => ({
  id: u.id,
  login: u.login,
  displayName: u.displayName,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  failedAttempts: u.failedAttempts,
  lockedUntil: u.lockedUntil !== null && u.lockedUntil > now ? u.lockedUntil.toISOString() : null,
  lastLoginAt: iso(u.lastLoginAt),
  passwordChangedAt: u.passwordChangedAt.toISOString(),
  createdAt: u.createdAt.toISOString(),
  createdBy: u.createdBy,
  updatedAt: u.updatedAt.toISOString(),
  version: u.version,
  registration: u.registration,
  ...(u.liveSessions === undefined ? {} : { liveSessions: u.liveSessions }),
});

const toSessionView = (s: ISessionRecord): ISessionView => ({
  id: s.id,
  createdAt: s.createdAt.toISOString(),
  lastSeenAt: s.lastSeenAt.toISOString(),
  expiresAt: s.expiresAt.toISOString(),
  ip: s.ip,
  userAgent: s.userAgent,
});

const toAuthUser = (u: IUserRecord): IAuthUser => ({
  id: u.id,
  login: u.login,
  displayName: u.displayName,
  role: u.role,
  permissions: permissionsOf(u.role),
  mustChangePassword: u.mustChangePassword,
});

export interface IServiceError {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: string;
  error: string;
}

const fail = (status: IServiceError['status'], code: string, error: string): IServiceError => ({ ok: false, status, code, error });

export type LoginResult =
  | { ok: true; token: string; context: IAuthContext }
  | { ok: false; code: 'bad_credentials' }
  | { ok: false; code: 'locked'; retryAt: Date }
  /** Только после верного пароля: подбором состояние заявки не узнать. */
  | { ok: false; code: 'registration_pending' | 'registration_rejected' };

/** Заявка на доступ, поданная самим человеком. */
export interface IRegistrationInput {
  login: string;
  displayName: string;
  password: string;
}

export interface IAuthServiceOptions {
  idleMs: number;
  maxMs: number;
  /** Неудач подряд до блокировки. */
  lockThreshold?: number;
  lockMs?: number;
  now?: () => number;
}

export class AuthService {
  private readonly now: () => number;
  private readonly lockThreshold: number;
  private readonly lockMs: number;

  constructor(
    private readonly store: IAuthStore,
    private readonly options: IAuthServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.lockThreshold = options.lockThreshold ?? 10;
    this.lockMs = options.lockMs ?? 15 * 60_000;
  }

  private date(): Date {
    return new Date(this.now());
  }

  async login(rawLogin: string, password: string, meta: IRequestMeta, previousToken?: string): Promise<LoginResult> {
    const now = this.date();
    const login = normalizeLogin(rawLogin);
    const user = LOGIN_RE.test(login) ? await this.store.findUserByLogin(login) : null;

    if (!user) {
      await verifyPassword(password, await dummyHash());
      await this.store.logEvent({ event: 'login_failed', userId: null, actor: 'anonymous', ip: meta.ip, details: { reason: 'unknown_login' } }, now);
      return { ok: false, code: 'bad_credentials' };
    }

    if (user.lockedUntil !== null && user.lockedUntil > now) {
      await this.store.logEvent({ event: 'login_failed', userId: user.id, actor: 'anonymous', ip: meta.ip, details: { reason: 'locked' } }, now);
      return { ok: false, code: 'locked', retryAt: user.lockedUntil };
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const { lockedUntil } = await this.store.recordLoginFailure(user.id, this.lockThreshold, this.lockMs, now);
      await this.store.logEvent(
        { event: 'login_failed', userId: user.id, actor: 'anonymous', ip: meta.ip, details: { reason: 'bad_password', locked: lockedUntil !== null } },
        now,
      );
      return { ok: false, code: 'bad_credentials' };
    }

    // Заявка выключена, как и выключенный пользователь, но её владелец узнаёт, почему не входит:
    // пароль он задал сам и уже ввёл верно — ничего нового об учётной записи ответ ему не сообщает.
    if (user.registration !== 'approved') {
      const reason = user.registration === 'pending' ? 'registration_pending' : 'registration_rejected';
      await this.store.logEvent({ event: 'login_failed', userId: user.id, actor: 'anonymous', ip: meta.ip, details: { reason } }, now);
      return { ok: false, code: reason };
    }

    if (!user.isActive) {
      await this.store.logEvent({ event: 'login_failed', userId: user.id, actor: 'anonymous', ip: meta.ip, details: { reason: 'disabled' } }, now);
      return { ok: false, code: 'bad_credentials' };
    }

    await this.store.recordLoginSuccess(user.id, now, needsRehash(user.passwordHash) ? await hashPassword(password) : null);
    if (previousToken) await this.store.revokeSessionByToken(hashToken(previousToken), 'replaced', now);

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.options.maxMs);
    const session = await this.store.createSession({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
      now,
    });
    await this.store.logEvent({ event: 'login_succeeded', userId: user.id, actor: user.login, ip: meta.ip, details: { sessionId: session.id } }, now);
    return { ok: true, token, context: { user: toAuthUser(user), sessionId: session.id, csrfToken: csrfFor(token), expiresAt } };
  }

  /** Контекст запроса по cookie или null: сессии нет, она истекла, отозвана или пользователь выключен. */
  async resolve(token: string | undefined): Promise<IAuthContext | null> {
    if (!token) return null;
    const found = await this.store.findLiveSession(hashToken(token), this.date(), this.options.idleMs);
    if (!found) return null;
    return { user: toAuthUser(found.user), sessionId: found.session.id, csrfToken: csrfFor(token), expiresAt: found.session.expiresAt };
  }

  async logout(token: string | undefined, meta: IRequestMeta): Promise<void> {
    if (!token) return;
    const now = this.date();
    const session = await this.store.revokeSessionByToken(hashToken(token), 'logout', now);
    if (!session) return;
    const user = await this.store.findUserById(session.userId);
    await this.store.logEvent({ event: 'logout', userId: session.userId, actor: user?.login ?? 'anonymous', ip: meta.ip, details: { sessionId: session.id } }, now);
  }

  async changePassword(ctx: IAuthContext, current: string, next: string, meta: IRequestMeta): Promise<{ ok: true; context: IAuthContext } | IServiceError> {
    if (ctx.sessionId === null) return fail(400, 'no_session', 'Без входа пароля нет');
    const now = this.date();
    const user = await this.store.findUserById(ctx.user.id);
    if (!user) return fail(404, 'not_found', 'Пользователь не найден');
    if (!(await verifyPassword(current, user.passwordHash))) return fail(400, 'bad_password', 'Текущий пароль неверен');
    if (current === next) return fail(400, 'same_password', 'Новый пароль совпадает с текущим');
    const problem = passwordProblem(next, user.login);
    if (problem) return fail(400, 'weak_password', problem);

    const updated = await this.store.setPassword(user.id, await hashPassword(next), false, now);
    if (!updated) return fail(404, 'not_found', 'Пользователь не найден');
    const revoked = await this.store.revokeUserSessions(user.id, 'password_changed', now, ctx.sessionId);
    await this.store.logEvent({ event: 'password_changed', userId: user.id, actor: user.login, ip: meta.ip, details: { revokedSessions: revoked } }, now);
    return { ok: true, context: { ...ctx, user: toAuthUser(updated) } };
  }

  // ─── Администрирование ────────────────────────────────────────────────────────

  async countUsers(): Promise<number> {
    return this.store.countUsers();
  }

  async listUsers(): Promise<IUserView[]> {
    const now = this.date();
    return (await this.store.listUsers(now, this.options.idleMs)).map(u => toUserView(u, now));
  }

  async getUser(id: number): Promise<IUserView | null> {
    const user = await this.store.findUserById(id);
    return user ? toUserView(user, this.date()) : null;
  }

  async createUser(
    actor: IActor,
    input: { login: string; displayName: string; role: Role; password: string },
    meta: IRequestMeta,
  ): Promise<{ ok: true; user: IUserView } | IServiceError> {
    const now = this.date();
    const login = normalizeLogin(input.login);
    const displayName = input.displayName.trim();
    const problem = loginProblem(login) ?? displayNameProblem(displayName) ?? passwordProblem(input.password, login);
    if (problem) return fail(400, 'invalid', problem);

    const created = await this.store.createUser(
      {
        login,
        displayName,
        role: input.role,
        passwordHash: await hashPassword(input.password),
        mustChangePassword: true,
        createdBy: actor.login,
        registration: 'approved',
      },
      now,
    );
    if (created === 'login_taken') return fail(409, 'login_taken', 'Пользователь с таким логином уже есть');
    await this.store.logEvent({ event: 'user_created', userId: created.id, actor: actor.login, ip: meta.ip, details: { role: created.role } }, now);
    return { ok: true, user: toUserView(created, now) };
  }

  async updateUser(
    actor: IActor,
    id: number,
    input: { expectedVersion: number; displayName?: string; role?: Role; isActive?: boolean },
    meta: IRequestMeta,
  ): Promise<{ ok: true; user: IUserView } | IServiceError> {
    const now = this.date();
    const displayName = input.displayName?.trim();
    if (displayName !== undefined) {
      const problem = displayNameProblem(displayName);
      if (problem) return fail(400, 'invalid', problem);
    }
    if (actor.id === id && ((input.role !== undefined && input.role !== 'admin') || input.isActive === false)) {
      return fail(409, 'self_change', 'Свою роль и доступ меняет другой администратор');
    }

    const result = await this.store.updateUser(id, input.expectedVersion, { displayName, role: input.role, isActive: input.isActive }, now);
    if (!result.ok) {
      if (result.code === 'not_found') return fail(404, 'not_found', 'Пользователь не найден');
      if (result.code === 'version_conflict') return fail(409, 'version_conflict', 'Пользователя уже изменили — обновите страницу');
      if (result.code === 'not_approved') return fail(409, 'not_approved', 'Это заявка на доступ: вход открывает «Одобрить»');
      return fail(409, 'last_admin', 'Это последний администратор: сначала назначьте другого');
    }

    const { before, user } = result;
    if (before.isActive && !user.isActive) {
      const revoked = await this.store.revokeUserSessions(id, 'user_disabled', now);
      await this.store.logEvent({ event: 'user_disabled', userId: id, actor: actor.login, ip: meta.ip, details: { revokedSessions: revoked } }, now);
    } else if (!before.isActive && user.isActive) {
      await this.store.logEvent({ event: 'user_enabled', userId: id, actor: actor.login, ip: meta.ip }, now);
    }
    const details: Record<string, unknown> = {};
    if (before.role !== user.role) details.role = { from: before.role, to: user.role };
    if (before.displayName !== user.displayName) details.displayName = true;
    if (Object.keys(details).length > 0) {
      await this.store.logEvent({ event: 'user_updated', userId: id, actor: actor.login, ip: meta.ip, details }, now);
    }
    return { ok: true, user: toUserView(user, now) };
  }

  // ─── Заявки на доступ ─────────────────────────────────────────────────────────

  /**
   * Заявка от самого человека: те же правила логина, имени и пароля, что у администратора и при смене
   * пароля. Создаётся выключенный читатель в состоянии «заявка»; сессии нет. Пароль придуман самим
   * человеком — менять его при первом входе не нужно.
   */
  async register(input: IRegistrationInput, meta: IRequestMeta): Promise<{ ok: true } | IServiceError> {
    const now = this.date();
    const login = normalizeLogin(input.login);
    const displayName = input.displayName.trim();
    const badLogin = loginProblem(login);
    if (badLogin) return fail(400, 'invalid_login', badLogin);
    const badName = displayNameProblem(displayName);
    if (badName) return fail(400, 'invalid_name', badName);
    const weak = passwordProblem(input.password, login);
    if (weak) return fail(400, 'weak_password', weak);

    const created = await this.store.createUser(
      {
        login,
        displayName,
        role: 'viewer',
        passwordHash: await hashPassword(input.password),
        mustChangePassword: false,
        createdBy: login,
        registration: 'pending',
      },
      now,
    );
    if (created === 'login_taken') return fail(409, 'login_taken', 'Этот логин уже занят');
    await this.store.logEvent({ event: 'registration_requested', userId: created.id, actor: login, ip: meta.ip }, now);
    return { ok: true };
  }

  /** Одобрить заявку: вход открывается сразу, с выбранной ролью. Отклонённую тоже можно одобрить. */
  async approveRegistration(
    actor: IActor,
    id: number,
    input: { expectedVersion: number; role: Role },
    meta: IRequestMeta,
  ): Promise<{ ok: true; user: IUserView } | IServiceError> {
    return this.decideRegistration(actor, id, input.expectedVersion, { decision: 'approved', role: input.role }, meta);
  }

  /** Отклонить заявку: запись остаётся выключенной и не удаляется — логин в журнале, решение можно пересмотреть. */
  async rejectRegistration(
    actor: IActor,
    id: number,
    input: { expectedVersion: number },
    meta: IRequestMeta,
  ): Promise<{ ok: true; user: IUserView } | IServiceError> {
    return this.decideRegistration(actor, id, input.expectedVersion, { decision: 'rejected' }, meta);
  }

  private async decideRegistration(
    actor: IActor,
    id: number,
    expectedVersion: number,
    decision: RegistrationDecision,
    meta: IRequestMeta,
  ): Promise<{ ok: true; user: IUserView } | IServiceError> {
    const now = this.date();
    const result = await this.store.decideRegistration(id, expectedVersion, decision, now);
    if (!result.ok) {
      if (result.code === 'not_found') return fail(404, 'not_found', 'Заявка не найдена');
      if (result.code === 'already_rejected') return fail(409, 'already_rejected', 'Заявка уже отклонена');
      if (result.code === 'already_approved') {
        return decision.decision === 'approved'
          ? fail(409, 'already_approved', 'Заявка уже одобрена')
          : fail(409, 'already_approved', 'Заявка уже одобрена: доступ выключается в списке пользователей');
      }
      return fail(409, 'version_conflict', 'Заявку уже изменили — обновите страницу');
    }
    const approved = decision.decision === 'approved';
    await this.store.logEvent(
      {
        event: approved ? 'registration_approved' : 'registration_rejected',
        userId: id,
        actor: actor.login,
        ip: meta.ip,
        details: approved ? { role: result.user.role } : {},
      },
      now,
    );
    return { ok: true, user: toUserView(result.user, now) };
  }

  /** Новый пароль от администратора или консоли: разблокирует, требует смены при входе, отзывает все сессии. */
  async resetPassword(actor: IActor, id: number, password: string, meta: IRequestMeta): Promise<{ ok: true; user: IUserView } | IServiceError> {
    if (actor.id === id) return fail(409, 'self_change', 'Свой пароль меняется в разделе «Мой профиль»');
    const now = this.date();
    const user = await this.store.findUserById(id);
    if (!user) return fail(404, 'not_found', 'Пользователь не найден');
    const problem = passwordProblem(password, user.login);
    if (problem) return fail(400, 'weak_password', problem);

    const updated = await this.store.setPassword(id, await hashPassword(password), true, now);
    if (!updated) return fail(404, 'not_found', 'Пользователь не найден');
    const revoked = await this.store.revokeUserSessions(id, 'password_reset', now);
    await this.store.logEvent({ event: 'password_reset', userId: id, actor: actor.login, ip: meta.ip, details: { revokedSessions: revoked } }, now);
    return { ok: true, user: toUserView(updated, now) };
  }

  async listSessions(userId: number): Promise<ISessionView[] | null> {
    const user = await this.store.findUserById(userId);
    if (!user) return null;
    return (await this.store.listLiveSessions(userId, this.date(), this.options.idleMs)).map(toSessionView);
  }

  async revokeSession(actor: IActor, userId: number, sessionId: number, meta: IRequestMeta): Promise<{ ok: true } | IServiceError> {
    const now = this.date();
    if (!(await this.store.revokeSessionById(userId, sessionId, 'admin_revoked', now))) {
      return fail(404, 'not_found', 'Сессия не найдена или уже закрыта');
    }
    await this.store.logEvent({ event: 'session_revoked', userId, actor: actor.login, ip: meta.ip, details: { sessionId } }, now);
    return { ok: true };
  }

  async listEvents(filter: { userId?: number; beforeId?: number; limit: number }): Promise<IAuthEventRecord[]> {
    return this.store.listEvents(filter);
  }
}
