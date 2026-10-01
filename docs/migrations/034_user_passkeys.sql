-- 034: вход по ключу доступа (passkey, WebAuthn) — ADR-014, дополнение 01.10.2026.
--
-- Ключ доступа — пара ключей на устройстве пользователя (iCloud Keychain, Google, Windows Hello,
-- аппаратный ключ). Здесь хранится только открытая часть: по ней сервер проверяет подпись входа.
-- Секретов в таблице нет — утечка дампа не даёт войти.
--
-- Ключ добавляет сам вошедший пользователь (с подтверждением паролем), убирает он сам или
-- администратор. Строка не удаляется, а отзывается (revoked_at): по ней видно в журнале, каким
-- ключом входили. Отозванный ключ войти не даёт.
--
-- Только добавление. Ограничение журнала пересоздаётся шире прежнего (все старые виды есть), как в 033.

CREATE TABLE user_passkeys (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  -- Идентификатор учётных данных от аутентификатора: по нему находится ключ при входе без логина.
  credential_id BYTEA NOT NULL,
  -- Открытый ключ в формате COSE, как его вернул аутентификатор.
  public_key    BYTEA NOT NULL,
  -- Счётчик подписей. У синхронизируемых ключей всегда 0; у аппаратных растёт — откат = копия ключа.
  sign_count    BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[] NOT NULL DEFAULT '{}',
  -- user.id WebAuthn: случайный, один на пользователя (берётся с первого ключа), без логина внутри.
  user_handle   BYTEA NOT NULL,
  -- singleDevice — живёт на одном устройстве; multiDevice — синхронизируется (iCloud, Google).
  device_type   TEXT NOT NULL,
  backed_up     BOOLEAN NOT NULL,
  -- Модель аутентификатора (AAGUID); нули — аутентификатор её не сообщил.
  aaguid        TEXT NOT NULL,
  -- Подпись для пользователя: «iPhone», «рабочий ноутбук».
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  -- Кто отозвал: логин самого пользователя или администратора.
  revoked_by    TEXT,
  CONSTRAINT user_passkeys_credential_id_len CHECK (octet_length(credential_id) BETWEEN 1 AND 1023),
  CONSTRAINT user_passkeys_user_handle_len CHECK (octet_length(user_handle) BETWEEN 1 AND 64),
  CONSTRAINT user_passkeys_sign_count_nonneg CHECK (sign_count >= 0),
  CONSTRAINT user_passkeys_device_type_known CHECK (device_type IN ('singleDevice', 'multiDevice')),
  CONSTRAINT user_passkeys_name_len CHECK (char_length(name) BETWEEN 1 AND 60),
  CONSTRAINT user_passkeys_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX user_passkeys_credential_id_key ON user_passkeys (credential_id);
CREATE INDEX user_passkeys_user_live_idx ON user_passkeys (user_id) WHERE revoked_at IS NULL;

-- Журнал: ключ добавлен, ключ отозван. Вход ключом — login_succeeded / login_failed с method = passkey
-- в details, нового вида для него не нужно.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_known;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_known CHECK (event IN (
  'login_succeeded', 'login_failed', 'logout', 'password_changed', 'password_reset',
  'user_created', 'user_updated', 'user_disabled', 'user_enabled', 'session_revoked',
  'registration_requested', 'registration_approved', 'registration_rejected',
  'passkey_added', 'passkey_removed'
));
