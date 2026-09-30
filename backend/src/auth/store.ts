// Хранилище пользователей и сессий (ADR-014): контракт, общий для PostgreSQL (auth/pgStore.ts)
// и памяти (auth/memoryStore.ts — unit-тесты без базы).
//
// Инварианты, которые обязана держать каждая реализация, а не вызывающий код:
//   - логин уникален;
//   - последний активный администратор не теряет роль и не выключается (`last_admin`);
//   - правка пользователя — только с ожидаемой версией (`version_conflict`);
//   - живая сессия — не отозвана, не истекла, не простаивала дольше idle и принадлежит активному пользователю.

import type { Role } from './permissions.js';

export interface IUserRecord {
  id: number;
  login: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  version: number;
}

export interface ISessionRecord {
  id: number;
  userId: number;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export const REVOKE_REASONS = ['logout', 'replaced', 'password_changed', 'password_reset', 'user_disabled', 'admin_revoked'] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

export const AUTH_EVENTS = [
  'login_succeeded',
  'login_failed',
  'logout',
  'password_changed',
  'password_reset',
  'user_created',
  'user_updated',
  'user_disabled',
  'user_enabled',
  'session_revoked',
] as const;
export type AuthEventType = (typeof AUTH_EVENTS)[number];

export interface IAuthEventInput {
  event: AuthEventType;
  userId: number | null;
  actor: string;
  ip: string | null;
  /** Без секретов: ни паролей, ни токенов, ни введённого логина несуществующего пользователя. */
  details?: Record<string, unknown>;
}

export interface IAuthEventRecord {
  id: number;
  at: Date;
  event: AuthEventType;
  userId: number | null;
  userLogin: string | null;
  actor: string;
  ip: string | null;
  details: Record<string, unknown>;
}

export interface INewUser {
  login: string;
  displayName: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
  createdBy: string;
}

export interface IUserPatch {
  displayName?: string;
  role?: Role;
  isActive?: boolean;
}

export type UpdateUserResult =
  | { ok: true; user: IUserRecord; before: IUserRecord }
  | { ok: false; code: 'not_found' | 'version_conflict' | 'last_admin' };

export interface INewSession {
  tokenHash: Buffer;
  userId: number;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  now: Date;
}

export interface IAuthStore {
  findUserByLogin(login: string): Promise<IUserRecord | null>;
  findUserById(id: number): Promise<IUserRecord | null>;
  /** Все пользователи с числом живых сессий, по логину. */
  listUsers(now: Date, idleMs: number): Promise<Array<IUserRecord & { liveSessions: number }>>;
  countUsers(): Promise<number>;
  createUser(input: INewUser, now: Date): Promise<IUserRecord | 'login_taken'>;
  updateUser(id: number, expectedVersion: number, patch: IUserPatch, now: Date): Promise<UpdateUserResult>;
  /** Новый пароль: сбрасывает счётчик неудач и блокировку, поднимает версию. */
  setPassword(id: number, passwordHash: string, mustChangePassword: boolean, now: Date): Promise<IUserRecord | null>;
  /** Неудачный вход: счётчик +1; на пороге — блокировка до now + lockMs. */
  recordLoginFailure(id: number, threshold: number, lockMs: number, now: Date): Promise<{ lockedUntil: Date | null }>;
  /** Удачный вход: счётчик и блокировка сбрасываются; rehash — новый хеш того же пароля. */
  recordLoginSuccess(id: number, now: Date, rehash: string | null): Promise<void>;

  createSession(input: INewSession): Promise<ISessionRecord>;
  /** Живая сессия с пользователем; отметка активности обновляется не чаще раза в минуту. */
  findLiveSession(tokenHash: Buffer, now: Date, idleMs: number): Promise<{ session: ISessionRecord; user: IUserRecord } | null>;
  listLiveSessions(userId: number, now: Date, idleMs: number): Promise<ISessionRecord[]>;
  revokeSessionByToken(tokenHash: Buffer, reason: RevokeReason, now: Date): Promise<ISessionRecord | null>;
  revokeSessionById(userId: number, sessionId: number, reason: RevokeReason, now: Date): Promise<boolean>;
  /** Отзыв всех сессий пользователя, кроме exceptSessionId. Возвращает число отозванных. */
  revokeUserSessions(userId: number, reason: RevokeReason, now: Date, exceptSessionId?: number): Promise<number>;

  logEvent(input: IAuthEventInput, now: Date): Promise<void>;
  listEvents(filter: { userId?: number; beforeId?: number; limit: number }): Promise<IAuthEventRecord[]>;
}

/** Отметка активности сессии пишется не на каждый запрос: иначе каждое чтение карточки — запись в базу. */
export const TOUCH_INTERVAL_MS = 60_000;
