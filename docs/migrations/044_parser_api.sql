-- parser-api.com: открытые реестры о компаниях портала по ИНН (этап 24A, ADR-017).
--
-- Посредник к ГИР БО (бухгалтерская отчётность), «Прозрачному бизнесу» ФНС, картотеке арбитражных дел,
-- ФССП и Федресурсу. Как Контур.Фокус (миграция 040) — справочник по реквизиту, а не источник публикаций:
-- в sources его нет, допуск — ключ администратора, рубильник PARSER_API_ENABLED. Спрашиваем только ИНН;
-- тексты публикаций туда не уходят.
--
-- Таблицы не ссылаются на компании: компания находится по ИНН при чтении, слияние их не трогает.
--
--  parser_api_checks   — что и когда проверяли: строка на ИНН и набор сведений (finance, tax, courts, fssp,
--                        bankruptcy), срок следующей проверки, неудачи подряд;
--  parser_api_records  — ответы как есть, набором (поиск → детали, страницы картотеки): новая строка только
--                        при изменении; строки не правятся и не удаляются; карта полей — на чтении;
--  parser_api_requests — журнал запросов: каждая попытка резервирует место в лимите ДО запроса (pending),
--                        оплачиваемым считается только ответ success = 1 (так считает сам сервис).
--                        Ключ доступа сюда не пишется.
--
-- В канон сведения не идут: это выписка на дату, а изменчивое (выручка, долги, дела) конвейер отозвать не умеет.

CREATE TABLE parser_api_checks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inn             TEXT NOT NULL,
  dataset         TEXT NOT NULL,
  -- found — сведения есть; not_found — сервис ответил, что записей нет; partial — получена часть (страницы,
  -- детали), это не «нет записей». Ни одной строки — не проверяли.
  outcome         TEXT,
  checked_at      TIMESTAMPTZ,
  next_check_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  requested_by    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parser_api_checks_inn CHECK (inn ~ '^([0-9]{10}|[0-9]{12})$'),
  CONSTRAINT parser_api_checks_dataset CHECK (dataset IN ('finance', 'tax', 'courts', 'fssp', 'bankruptcy')),
  CONSTRAINT parser_api_checks_outcome CHECK (outcome IS NULL OR outcome IN ('found', 'not_found', 'partial')),
  CONSTRAINT parser_api_checks_checked CHECK ((outcome IS NULL) = (checked_at IS NULL)),
  CONSTRAINT parser_api_checks_unique UNIQUE (inn, dataset)
);

CREATE INDEX parser_api_checks_due_idx ON parser_api_checks (next_check_at);

CREATE TABLE parser_api_records (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inn           TEXT NOT NULL,
  dataset       TEXT NOT NULL,
  -- parser-api-dataset@1: ответы методов набора по порядку (параметры без ключа), окно дат, страницы.
  payload       JSONB NOT NULL,
  payload_hash  TEXT NOT NULL,
  -- Все нужные страницы и детали получены. false — неполный набор: экран так и говорит.
  complete      BOOLEAN NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parser_api_records_inn CHECK (inn ~ '^([0-9]{10}|[0-9]{12})$'),
  CONSTRAINT parser_api_records_dataset CHECK (dataset IN ('finance', 'tax', 'courts', 'fssp', 'bankruptcy')),
  CONSTRAINT parser_api_records_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX parser_api_records_lookup_idx ON parser_api_records (inn, dataset, fetched_at DESC, id DESC);

CREATE TABLE parser_api_requests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  method        TEXT NOT NULL,
  inn           TEXT,
  page          INTEGER,
  http_status   INTEGER,
  -- error_code сервиса: 40301 ключ, 40302 подписка, 40303 адрес, 40304/40305 лимиты, 40001 параметры.
  api_code      INTEGER,
  outcome       TEXT NOT NULL,
  -- Ответ success = 1: сервис списал запрос с тарифа. pending тоже занимает место в лимите.
  billable      BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  actor         TEXT NOT NULL,
  CONSTRAINT parser_api_requests_method CHECK (method IN (
    'bo_search', 'bo_details', 'pb_org', 'kad_search', 'fssp_ur', 'fedresurs_ur', 'fedresurs_org', 'key_check')),
  CONSTRAINT parser_api_requests_outcome CHECK (outcome IN (
    'pending', 'ok', 'key_rejected', 'subscription_expired', 'ip_rejected', 'daily_limit', 'monthly_limit',
    'bad_request', 'bad_response', 'http_error', 'network')),
  CONSTRAINT parser_api_requests_billable CHECK (NOT billable OR outcome = 'ok')
);

CREATE INDEX parser_api_requests_time_idx ON parser_api_requests (requested_at DESC);

-- Ключ parser-api.com задаётся в админке так же, как ключи OpenRouter и Контур.Фокуса.
ALTER TABLE app_secrets DROP CONSTRAINT app_secrets_name_known;
ALTER TABLE app_secrets ADD CONSTRAINT app_secrets_name_known
  CHECK (name IN ('openrouter_api_key', 'kontur_focus_api_key', 'parser_api_key'));
