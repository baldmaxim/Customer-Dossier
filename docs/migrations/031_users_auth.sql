-- Пользователи портала, серверные сессии и журнал входа (ADR-014).
--
-- Секретов в таблицах нет: пароль хранится хешем scrypt (параметры — в самой строке,
-- чтобы их можно было усилить без миграции), идентификатор сессии — только sha256.
-- Утечка дампа не даёт ни пароля, ни действующей cookie.
--
-- Пользователь не удаляется: его логин стоит в решениях аналитика, журналах публикаций и
-- слияний. Вместо удаления — is_active = false. Логин неизменяем по той же причине.

CREATE TABLE users (
  id                   BIGSERIAL PRIMARY KEY,
  login                TEXT NOT NULL,
  display_name         TEXT NOT NULL,
  -- Роль — ключ из auth/permissions.ts; права роли живут в коде, рядом с маршрутами.
  role                 TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  -- Пароль, выданный администратором или консолью, пользователь меняет при первом входе.
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  password_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           TEXT NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Ожидаемая версия при правке из админки: два администратора не затирают друг друга молча.
  version              INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT users_login_format CHECK (login ~ '^[a-z0-9][a-z0-9._@-]{2,63}$'),
  CONSTRAINT users_role_known CHECK (role IN ('admin', 'operator', 'viewer')),
  CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT users_failed_attempts_nonneg CHECK (failed_attempts >= 0),
  CONSTRAINT users_version_positive CHECK (version >= 1)
);

CREATE UNIQUE INDEX users_login_key ON users (login);

CREATE TABLE user_sessions (
  id             BIGSERIAL PRIMARY KEY,
  -- sha256 идентификатора из cookie. Сам идентификатор знает только браузер.
  token_hash     BYTEA NOT NULL,
  user_id        BIGINT NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  ip             TEXT,
  user_agent     TEXT,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  CONSTRAINT user_sessions_token_hash_len CHECK (octet_length(token_hash) = 32),
  CONSTRAINT user_sessions_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT user_sessions_revoked_reason_known CHECK (
    revoked_reason IS NULL OR revoked_reason IN
      ('logout', 'replaced', 'password_changed', 'password_reset', 'user_disabled', 'admin_revoked')
  )
);

CREATE UNIQUE INDEX user_sessions_token_hash_key ON user_sessions (token_hash);
CREATE INDEX user_sessions_user_live_idx ON user_sessions (user_id) WHERE revoked_at IS NULL;

-- Журнал входа и действий с пользователями. Только добавление: правку и удаление запрещает база.
CREATE TABLE auth_events (
  id            BIGSERIAL PRIMARY KEY,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  event         TEXT NOT NULL,
  -- О ком событие. NULL — попытка входа под несуществующим логином: сам логин не пишем,
  -- в это поле по ошибке вводят пароль.
  user_id       BIGINT REFERENCES users(id),
  -- Кто сделал: логин администратора, логин самого пользователя, 'cli' или 'anonymous'.
  actor         TEXT NOT NULL,
  ip            TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT auth_events_event_known CHECK (event IN (
    'login_succeeded', 'login_failed', 'logout', 'password_changed', 'password_reset',
    'user_created', 'user_updated', 'user_disabled', 'user_enabled', 'session_revoked'
  ))
);

CREATE INDEX auth_events_at_idx ON auth_events (at DESC, id DESC);
CREATE INDEX auth_events_user_idx ON auth_events (user_id, at DESC, id DESC);

CREATE FUNCTION auth_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auth_events неизменяем: % запрещён', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER auth_events_no_update
  BEFORE UPDATE OR DELETE ON auth_events
  FOR EACH ROW EXECUTE FUNCTION auth_events_immutable();
