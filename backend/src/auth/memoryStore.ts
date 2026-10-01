// Пользователи, сессии и ключи доступа в памяти — для unit-тестов HTTP-слоя без базы. В рабочем процессе
// не используется: там pgAuthStore. Инварианты те же (auth/store.ts), их проверяет auth.test.ts.

import {
  TOUCH_INTERVAL_MS,
  registrationDecisionProblem,
  type IAuthEventInput,
  type IAuthEventRecord,
  type IAuthStore,
  type IPasskeyRecord,
  type ISessionRecord,
  type IUserRecord,
} from './store.js';

interface IStoredSession extends ISessionRecord {
  tokenHash: Buffer;
  revokedAt: Date | null;
  revokedReason: string | null;
}

interface IStoredPasskey extends IPasskeyRecord {
  revokedAt: Date | null;
  revokedBy: string | null;
}

export const createMemoryAuthStore = (): IAuthStore & { sessions: IStoredSession[]; events: IAuthEventRecord[]; passkeys: IStoredPasskey[] } => {
  const users: IUserRecord[] = [];
  const sessions: IStoredSession[] = [];
  const events: IAuthEventRecord[] = [];
  const passkeys: IStoredPasskey[] = [];
  let userSeq = 0;
  let sessionSeq = 0;
  let eventSeq = 0;
  let passkeySeq = 0;

  const copy = (u: IUserRecord): IUserRecord => ({ ...u });
  const isLive = (s: IStoredSession, now: Date, idleMs: number): boolean =>
    s.revokedAt === null && s.expiresAt > now && now.getTime() - s.lastSeenAt.getTime() < idleMs;
  const publicSession = ({ tokenHash: _t, revokedAt: _r, revokedReason: _rr, ...s }: IStoredSession): ISessionRecord => ({ ...s });
  const publicPasskey = ({ revokedAt: _r, revokedBy: _b, ...p }: IStoredPasskey): IPasskeyRecord => ({ ...p, transports: [...p.transports] });

  return {
    sessions,
    events,
    passkeys,

    async findUserByLogin(login) {
      const u = users.find(x => x.login === login);
      return u ? copy(u) : null;
    },

    async findUserById(id) {
      const u = users.find(x => x.id === id);
      return u ? copy(u) : null;
    },

    async listUsers(now, idleMs) {
      return [...users]
        .sort((a, b) => a.login.localeCompare(b.login))
        .map(u => ({
          ...copy(u),
          liveSessions: sessions.filter(s => s.userId === u.id && isLive(s, now, idleMs)).length,
          passkeys: passkeys.filter(p => p.userId === u.id && p.revokedAt === null).length,
        }));
    },

    async countUsers() {
      return users.length;
    },

    async createUser(input, now) {
      if (users.some(u => u.login === input.login)) return 'login_taken';
      userSeq += 1;
      const user: IUserRecord = {
        id: userSeq,
        ...input,
        // Заявка создаётся выключенной: войти можно только после одобрения.
        isActive: input.registration === 'approved',
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      users.push(user);
      return copy(user);
    },

    async updateUser(id, expectedVersion, patch, now) {
      const u = users.find(x => x.id === id);
      if (!u) return { ok: false, code: 'not_found' };
      if (u.version !== expectedVersion) return { ok: false, code: 'version_conflict' };
      const before = copy(u);
      const role = patch.role ?? u.role;
      const isActive = patch.isActive ?? u.isActive;
      if (isActive && u.registration !== 'approved') return { ok: false, code: 'not_approved' };
      if (u.role === 'admin' && u.isActive && (role !== 'admin' || !isActive)) {
        if (!users.some(x => x.id !== id && x.role === 'admin' && x.isActive)) return { ok: false, code: 'last_admin' };
      }
      Object.assign(u, { displayName: patch.displayName ?? u.displayName, role, isActive, updatedAt: now, version: u.version + 1 });
      return { ok: true, user: copy(u), before };
    },

    async decideRegistration(id, expectedVersion, decision, now) {
      const u = users.find(x => x.id === id);
      if (!u) return { ok: false, code: 'not_found' };
      const problem = registrationDecisionProblem(u.registration, decision.decision);
      if (problem) return { ok: false, code: problem };
      if (u.version !== expectedVersion) return { ok: false, code: 'version_conflict' };
      const before = copy(u);
      const approved = decision.decision === 'approved';
      Object.assign(u, {
        registration: decision.decision,
        isActive: approved,
        role: approved ? decision.role : u.role,
        updatedAt: now,
        version: u.version + 1,
      });
      return { ok: true, user: copy(u), before };
    },

    async setPassword(id, passwordHash, mustChangePassword, now) {
      const u = users.find(x => x.id === id);
      if (!u) return null;
      Object.assign(u, {
        passwordHash,
        mustChangePassword,
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: now,
        updatedAt: now,
        version: u.version + 1,
      });
      return copy(u);
    },

    async recordLoginFailure(id, threshold, lockMs, now) {
      const u = users.find(x => x.id === id);
      if (!u) return { lockedUntil: null };
      if (u.failedAttempts + 1 >= threshold) {
        u.failedAttempts = 0;
        u.lockedUntil = new Date(now.getTime() + lockMs);
      } else {
        u.failedAttempts += 1;
      }
      return { lockedUntil: u.lockedUntil !== null && u.lockedUntil > now ? u.lockedUntil : null };
    },

    async recordLoginSuccess(id, now, rehash) {
      const u = users.find(x => x.id === id);
      if (!u) return;
      Object.assign(u, { failedAttempts: 0, lockedUntil: null, lastLoginAt: now, passwordHash: rehash ?? u.passwordHash });
    },

    async createSession(input) {
      sessionSeq += 1;
      const s: IStoredSession = {
        id: sessionSeq,
        tokenHash: input.tokenHash,
        userId: input.userId,
        createdAt: input.now,
        lastSeenAt: input.now,
        expiresAt: input.expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
        revokedAt: null,
        revokedReason: null,
      };
      sessions.push(s);
      return publicSession(s);
    },

    async findLiveSession(tokenHash, now, idleMs) {
      const s = sessions.find(x => x.tokenHash.equals(tokenHash));
      if (!s || !isLive(s, now, idleMs)) return null;
      const u = users.find(x => x.id === s.userId);
      if (!u || !u.isActive) return null;
      if (now.getTime() - s.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) s.lastSeenAt = now;
      return { session: publicSession(s), user: copy(u) };
    },

    async listLiveSessions(userId, now, idleMs) {
      return sessions
        .filter(s => s.userId === userId && isLive(s, now, idleMs))
        .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime() || b.id - a.id)
        .map(publicSession);
    },

    async revokeSessionByToken(tokenHash, reason, now) {
      const s = sessions.find(x => x.tokenHash.equals(tokenHash) && x.revokedAt === null);
      if (!s) return null;
      s.revokedAt = now;
      s.revokedReason = reason;
      return publicSession(s);
    },

    async revokeSessionById(userId, sessionId, reason, now) {
      const s = sessions.find(x => x.id === sessionId && x.userId === userId && x.revokedAt === null);
      if (!s) return false;
      s.revokedAt = now;
      s.revokedReason = reason;
      return true;
    },

    async revokeUserSessions(userId, reason, now, exceptSessionId) {
      let n = 0;
      for (const s of sessions) {
        if (s.userId !== userId || s.revokedAt !== null || s.id === exceptSessionId) continue;
        s.revokedAt = now;
        s.revokedReason = reason;
        n += 1;
      }
      return n;
    },

    async listPasskeys(userId) {
      return passkeys
        .filter(p => p.userId === userId && p.revokedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .map(publicPasskey);
    },

    async findPasskey(credentialId) {
      const p = passkeys.find(x => x.credentialId.equals(credentialId) && x.revokedAt === null);
      return p ? publicPasskey(p) : null;
    },

    async findPasskeyUserHandle(userId) {
      return passkeys.find(p => p.userId === userId)?.userHandle ?? null;
    },

    async createPasskey(input, now) {
      if (passkeys.some(p => p.credentialId.equals(input.credentialId))) return 'credential_taken';
      passkeySeq += 1;
      const p: IStoredPasskey = { ...input, transports: [...input.transports], id: passkeySeq, createdAt: now, lastUsedAt: null, revokedAt: null, revokedBy: null };
      passkeys.push(p);
      return publicPasskey(p);
    },

    async recordPasskeyUse(id, signCount, backedUp, now) {
      const p = passkeys.find(x => x.id === id);
      if (!p) return;
      Object.assign(p, { signCount, backedUp, lastUsedAt: now });
      const u = users.find(x => x.id === p.userId);
      if (u) u.lastLoginAt = now;
    },

    async revokePasskey(userId, passkeyId, by, now) {
      const p = passkeys.find(x => x.id === passkeyId && x.userId === userId && x.revokedAt === null);
      if (!p) return null;
      Object.assign(p, { revokedAt: now, revokedBy: by });
      return publicPasskey(p);
    },

    async logEvent(input: IAuthEventInput, now) {
      eventSeq += 1;
      events.push({
        id: eventSeq,
        at: now,
        event: input.event,
        userId: input.userId,
        userLogin: users.find(u => u.id === input.userId)?.login ?? null,
        actor: input.actor,
        ip: input.ip,
        details: input.details ?? {},
      });
    },

    async listEvents(filter) {
      return events
        .filter(e => (filter.userId === undefined || e.userId === filter.userId) && (filter.beforeId === undefined || e.id < filter.beforeId))
        .sort((a, b) => b.id - a.id)
        .slice(0, filter.limit);
    },
  };
};
