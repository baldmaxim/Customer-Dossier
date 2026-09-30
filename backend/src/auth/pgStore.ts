// Пользователи и сессии в PostgreSQL (миграция 031, ADR-014). Контракт и инварианты — auth/store.ts.

import type { PoolClient, QueryResultRow } from 'pg';

import { getPool, withTransaction } from '../db/pool.js';
import { isRole } from './permissions.js';
import {
  TOUCH_INTERVAL_MS,
  type IAuthEventInput,
  type IAuthEventRecord,
  type IAuthStore,
  type INewSession,
  type INewUser,
  type ISessionRecord,
  type IUserPatch,
  type IUserRecord,
  type RevokeReason,
  type UpdateUserResult,
} from './store.js';

const userColumns = (a: string): string => `
  ${a}.id, ${a}.login, ${a}.display_name AS "displayName", ${a}.role, ${a}.password_hash AS "passwordHash",
  ${a}.must_change_password AS "mustChangePassword", ${a}.is_active AS "isActive",
  ${a}.failed_attempts AS "failedAttempts", ${a}.locked_until AS "lockedUntil", ${a}.last_login_at AS "lastLoginAt",
  ${a}.password_changed_at AS "passwordChangedAt", ${a}.created_at AS "createdAt", ${a}.created_by AS "createdBy",
  ${a}.updated_at AS "updatedAt", ${a}.version`;

const SESSION_COLUMNS = `
  id, user_id AS "userId", created_at AS "createdAt", last_seen_at AS "lastSeenAt",
  expires_at AS "expiresAt", ip, user_agent AS "userAgent"`;

/** Живая сессия: не отозвана, не истекла и не простаивала дольше idle (параметры: сейчас, idle в мс). */
const LIVE = (a: string, nowParam: number, idleParam: number): string =>
  `${a}.revoked_at IS NULL AND ${a}.expires_at > $${nowParam}::timestamptz
   AND ${a}.last_seen_at > $${nowParam}::timestamptz - ($${idleParam}::double precision * interval '1 millisecond')`;

type UserRow = Omit<IUserRecord, 'role'> & { role: string };

/** Роль из базы проверяется: CHECK таблицы и список в коде обязаны совпадать. */
const toUser = (row: UserRow): IUserRecord => {
  if (!isRole(row.role)) throw new Error(`users.role: неизвестная роль у пользователя ${row.id}`);
  return { ...row, role: row.role };
};

const rows = async <T extends QueryResultRow>(sql: string, params: unknown[], client?: PoolClient): Promise<T[]> =>
  (await (client ?? getPool()).query<T>(sql, params)).rows;

/** Сериализация правок ролей и активности: проверка «последнего администратора» без гонки двух правок. */
const ADMINS_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('tg_info:users:admins'))`;

export const pgAuthStore: IAuthStore = {
  async findUserByLogin(login) {
    const [row] = await rows<UserRow>(`SELECT ${userColumns('u')} FROM users u WHERE u.login = $1`, [login]);
    return row ? toUser(row) : null;
  },

  async findUserById(id) {
    const [row] = await rows<UserRow>(`SELECT ${userColumns('u')} FROM users u WHERE u.id = $1`, [id]);
    return row ? toUser(row) : null;
  },

  async listUsers(now, idleMs) {
    const result = await rows<UserRow & { liveSessions: number }>(
      `SELECT ${userColumns('u')},
              (SELECT count(*)::int FROM user_sessions s WHERE s.user_id = u.id AND ${LIVE('s', 1, 2)}) AS "liveSessions"
         FROM users u
        ORDER BY u.login`,
      [now, idleMs],
    );
    return result.map(r => ({ ...toUser(r), liveSessions: r.liveSessions }));
  },

  async countUsers() {
    const [row] = await rows<{ n: number }>('SELECT count(*)::int AS n FROM users', []);
    return row?.n ?? 0;
  },

  async createUser(input: INewUser, now) {
    const [row] = await rows<UserRow>(
      `INSERT INTO users (login, display_name, role, password_hash, must_change_password, created_by,
                          created_at, updated_at, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
       ON CONFLICT (login) DO NOTHING
       RETURNING ${userColumns('users')}`,
      [input.login, input.displayName, input.role, input.passwordHash, input.mustChangePassword, input.createdBy, now],
    );
    return row ? toUser(row) : 'login_taken';
  },

  async updateUser(id, expectedVersion, patch: IUserPatch, now): Promise<UpdateUserResult> {
    return withTransaction(async client => {
      await client.query(ADMINS_LOCK_SQL);
      const [beforeRow] = await rows<UserRow>(`SELECT ${userColumns('u')} FROM users u WHERE u.id = $1 FOR UPDATE`, [id], client);
      if (!beforeRow) return { ok: false, code: 'not_found' };
      const before = toUser(beforeRow);
      if (before.version !== expectedVersion) return { ok: false, code: 'version_conflict' };

      const role = patch.role ?? before.role;
      const isActive = patch.isActive ?? before.isActive;
      if (before.role === 'admin' && before.isActive && (role !== 'admin' || !isActive)) {
        const [other] = await rows<{ n: number }>(
          `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
          [id],
          client,
        );
        if ((other?.n ?? 0) === 0) return { ok: false, code: 'last_admin' };
      }

      const [row] = await rows<UserRow>(
        `UPDATE users SET display_name = $2, role = $3, is_active = $4, updated_at = $5, version = version + 1
          WHERE id = $1
          RETURNING ${userColumns('users')}`,
        [id, patch.displayName ?? before.displayName, role, isActive, now],
        client,
      );
      if (!row) return { ok: false, code: 'not_found' };
      return { ok: true, user: toUser(row), before };
    });
  },

  async setPassword(id, passwordHash, mustChangePassword, now) {
    const [row] = await rows<UserRow>(
      `UPDATE users SET password_hash = $2, must_change_password = $3, failed_attempts = 0, locked_until = NULL,
                        password_changed_at = $4, updated_at = $4, version = version + 1
        WHERE id = $1
        RETURNING ${userColumns('users')}`,
      [id, passwordHash, mustChangePassword, now],
    );
    return row ? toUser(row) : null;
  },

  async recordLoginFailure(id, threshold, lockMs, now) {
    // На пороге счётчик обнуляется: после блокировки снова доступно `threshold` попыток,
    // а не одна до следующей блокировки.
    const [row] = await rows<{ lockedUntil: Date | null }>(
      `UPDATE users SET
         locked_until = CASE WHEN failed_attempts + 1 >= $2
                             THEN $3::timestamptz + ($4::double precision * interval '1 millisecond')
                             ELSE locked_until END,
         failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END
       WHERE id = $1
       RETURNING locked_until AS "lockedUntil"`,
      [id, threshold, now, lockMs],
    );
    const lockedUntil = row?.lockedUntil ?? null;
    return { lockedUntil: lockedUntil !== null && lockedUntil > now ? lockedUntil : null };
  },

  async recordLoginSuccess(id, now, rehash) {
    await getPool().query(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = $2,
                        password_hash = COALESCE($3, password_hash)
        WHERE id = $1`,
      [id, now, rehash],
    );
  },

  async createSession(input: INewSession) {
    const [row] = await rows<ISessionRecord>(
      `INSERT INTO user_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $3, $4, $5, $6)
       RETURNING ${SESSION_COLUMNS}`,
      [input.tokenHash, input.userId, input.now, input.expiresAt, input.ip, input.userAgent],
    );
    if (!row) throw new Error('user_sessions: вставка не вернула строку');
    return row;
  },

  async findLiveSession(tokenHash, now, idleMs) {
    const [row] = await rows<UserRow & { sessionId: number; sessionCreatedAt: Date; lastSeenAt: Date; expiresAt: Date; ip: string | null; userAgent: string | null }>(
      `SELECT ${userColumns('u')},
              s.id AS "sessionId", s.created_at AS "sessionCreatedAt", s.last_seen_at AS "lastSeenAt",
              s.expires_at AS "expiresAt", s.ip, s.user_agent AS "userAgent"
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND u.is_active AND ${LIVE('s', 2, 3)}`,
      [tokenHash, now, idleMs],
    );
    if (!row) return null;
    const { sessionId, sessionCreatedAt, lastSeenAt, expiresAt, ip, userAgent, ...userRow } = row;
    let seen = lastSeenAt;
    if (now.getTime() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await getPool().query('UPDATE user_sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL', [sessionId, now]);
      seen = now;
    }
    return {
      session: { id: sessionId, userId: userRow.id, createdAt: sessionCreatedAt, lastSeenAt: seen, expiresAt, ip, userAgent },
      user: toUser(userRow),
    };
  },

  async listLiveSessions(userId, now, idleMs) {
    return rows<ISessionRecord>(
      `SELECT ${SESSION_COLUMNS} FROM user_sessions s WHERE s.user_id = $1 AND ${LIVE('s', 2, 3)} ORDER BY s.last_seen_at DESC, s.id DESC`,
      [userId, now, idleMs],
    );
  },

  async revokeSessionByToken(tokenHash, reason: RevokeReason, now) {
    const [row] = await rows<ISessionRecord>(
      `UPDATE user_sessions SET revoked_at = $3, revoked_reason = $2
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING ${SESSION_COLUMNS}`,
      [tokenHash, reason, now],
    );
    return row ?? null;
  },

  async revokeSessionById(userId, sessionId, reason, now) {
    const result = await getPool().query(
      `UPDATE user_sessions SET revoked_at = $4, revoked_reason = $3
        WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`,
      [userId, sessionId, reason, now],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async revokeUserSessions(userId, reason, now, exceptSessionId) {
    const result = await getPool().query(
      `UPDATE user_sessions SET revoked_at = $3, revoked_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL AND ($4::bigint IS NULL OR id <> $4)`,
      [userId, reason, now, exceptSessionId ?? null],
    );
    return result.rowCount ?? 0;
  },

  async logEvent(input: IAuthEventInput, now) {
    await getPool().query(
      `INSERT INTO auth_events (at, event, user_id, actor, ip, details) VALUES ($1, $2, $3, $4, $5, $6)`,
      [now, input.event, input.userId, input.actor, input.ip, JSON.stringify(input.details ?? {})],
    );
  },

  async listEvents(filter) {
    return rows<IAuthEventRecord>(
      `SELECT e.id, e.at, e.event, e.user_id AS "userId", u.login AS "userLogin", e.actor, e.ip, e.details
         FROM auth_events e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE ($1::bigint IS NULL OR e.user_id = $1) AND ($2::bigint IS NULL OR e.id < $2)
        ORDER BY e.id DESC
        LIMIT $3`,
      [filter.userId ?? null, filter.beforeId ?? null, filter.limit],
    );
  },
};
