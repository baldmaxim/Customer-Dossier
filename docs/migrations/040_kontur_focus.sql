-- Контур.Фокус: сведения ЕГРЮЛ/ЕГРИП о компаниях портала по ИНН/ОГРН (ADR-015).
--
-- Фокус — платный справочный сервис, а не источник публикаций: в sources его нет, допуск — ключ,
-- который задаёт администратор, и рубильник FOCUS_ENABLED. Спрашиваем только реквизит компании;
-- тексты публикаций туда не уходят.
--
-- Таблицы не ссылаются на компании: компания находится по реквизиту при чтении (как реестр ДОМ.РФ,
-- этап 20D), поэтому слияние компаний их не переносит и висячих ссылок не оставляет.
--
--  focus_checks   — что и когда спрашивали: одна строка на реквизит, срок следующей проверки, ошибка;
--  focus_records  — ответы Фокуса как есть (payload): новая строка — только когда ответ изменился,
--                   строки не правятся и не удаляются; что изменилось — считается на чтении;
--  focus_requests — журнал обращений к API: сколько запросов ушло за сутки (лимит FOCUS_DAILY_LIMIT —
--                   это деньги тарифа) и чем ответил Фокус. Ключ доступа сюда не пишется.
--
-- В канон (утверждения, доказательства) сведения Фокуса не идут: это выписка на дату, а изменчивое
-- (руководитель, адрес, статус) конвейер отозвать не умеет.

CREATE TABLE focus_checks (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- inn — ИНН юрлица или ИП; ogrn — ОГРН или ОГРНИП, когда ИНН у компании нет.
  identifier_type  TEXT NOT NULL,
  identifier       TEXT NOT NULL,
  -- Последний ответ Фокуса по существу: found — запись есть, not_found — Фокус её не знает.
  outcome          TEXT,
  checked_at       TIMESTAMPTZ,
  next_check_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Неудачи подряд и текст последней: по ним растёт пауза до повтора.
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  -- Кто последним запросил обновление вручную (логин); по расписанию — NULL.
  requested_by     TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT focus_checks_type CHECK (identifier_type IN ('inn', 'ogrn')),
  CONSTRAINT focus_checks_value CHECK (identifier ~ '^[0-9]{10,15}$'),
  CONSTRAINT focus_checks_outcome CHECK (outcome IS NULL OR outcome IN ('found', 'not_found')),
  CONSTRAINT focus_checks_checked CHECK ((outcome IS NULL) = (checked_at IS NULL)),
  CONSTRAINT focus_checks_unique UNIQUE (identifier_type, identifier)
);

CREATE INDEX focus_checks_due_idx ON focus_checks (next_check_at);

CREATE TABLE focus_records (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- По чему спрашивали (focus_checks) и каким методом API.
  identifier_type  TEXT NOT NULL,
  identifier       TEXT NOT NULL,
  method           TEXT NOT NULL,
  -- Что ответил Фокус: реквизиты из самого ответа.
  inn              TEXT,
  ogrn             TEXT,
  -- Элемент ответа целиком: карта полей меняется на чтении, без повторного (платного) запроса.
  payload          JSONB NOT NULL,
  -- sha256-canonical-json@1 от payload: тот же ответ второй строки не создаёт.
  payload_hash     TEXT NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT focus_records_type CHECK (identifier_type IN ('inn', 'ogrn')),
  CONSTRAINT focus_records_method CHECK (method IN ('req', 'egrDetails')),
  CONSTRAINT focus_records_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX focus_records_lookup_idx ON focus_records (identifier_type, identifier, method, fetched_at DESC, id DESC);

CREATE TABLE focus_requests (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  method            TEXT NOT NULL,
  -- Сколько реквизитов в запросе: столько списывает тариф.
  identifiers_count INTEGER NOT NULL,
  -- NULL — до Фокуса запрос не дошёл (сеть, время ожидания).
  http_status       INTEGER,
  outcome           TEXT NOT NULL,
  error             TEXT,
  -- Логин того, кто нажал «Обновить», или scheduler.
  actor             TEXT NOT NULL,
  CONSTRAINT focus_requests_method CHECK (method IN ('req', 'egrDetails', 'stat')),
  CONSTRAINT focus_requests_count CHECK (identifiers_count >= 0),
  CONSTRAINT focus_requests_outcome CHECK (outcome IN ('ok', 'key_rejected', 'method_forbidden', 'quota_exhausted', 'rate_limited', 'bad_response', 'http_error', 'network'))
);

CREATE INDEX focus_requests_time_idx ON focus_requests (requested_at DESC);

-- Ключ Контур.Фокуса задаётся в админке так же, как ключ OpenRouter: шифротекстом (миграция 032).
ALTER TABLE app_secrets DROP CONSTRAINT app_secrets_name_known;
ALTER TABLE app_secrets ADD CONSTRAINT app_secrets_name_known CHECK (name IN ('openrouter_api_key', 'kontur_focus_api_key'));
