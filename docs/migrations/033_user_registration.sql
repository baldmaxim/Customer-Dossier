-- 033: заявка на доступ — самостоятельная регистрация с одобрением администратора (ADR-014, дополнение).
--
-- Человек сам вводит логин, имя и пароль на экране входа. Учётная запись создаётся сразу, но
-- выключенной и в состоянии «заявка» (pending): войти нельзя, пока администратор в «Пользователях»
-- не одобрит её с ролью (approved) или не отклонит (rejected). Отклонённая запись не удаляется:
-- логин остаётся занятым и стоит в журнале, а решение можно пересмотреть.
--
-- Только добавление. Существующие строки получают approved — их создавали администратор или консоль.
-- Данные не меняются и не удаляются; ограничение журнала пересоздаётся шире прежнего (все старые
-- виды событий в новом списке есть), как в 026.

ALTER TABLE users
  ADD COLUMN registration TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE users
  ADD CONSTRAINT users_registration_known CHECK (registration IN ('pending', 'approved', 'rejected'));

-- Заявка и отклонённая заявка не входят никогда — это держит база, а не только код:
-- включить вход можно только одобрением.
ALTER TABLE users
  ADD CONSTRAINT users_registration_inactive CHECK (registration = 'approved' OR NOT is_active);

COMMENT ON COLUMN users.registration IS
  'approved — создан администратором, консолью или заявка одобрена; pending — заявка ждёт решения; rejected — отклонена';

-- Журнал: подана заявка, одобрена, отклонена. Отказ во входе по заявке — login_failed с причиной
-- registration_pending / registration_rejected в details, нового вида для него не нужно.
ALTER TABLE auth_events DROP CONSTRAINT auth_events_event_known;
ALTER TABLE auth_events ADD CONSTRAINT auth_events_event_known CHECK (event IN (
  'login_succeeded', 'login_failed', 'logout', 'password_changed', 'password_reset',
  'user_created', 'user_updated', 'user_disabled', 'user_enabled', 'session_revoked',
  'registration_requested', 'registration_approved', 'registration_rejected'
));
