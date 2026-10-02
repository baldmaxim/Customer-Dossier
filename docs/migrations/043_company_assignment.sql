-- Назначение имён без ИНН компаниям (ADR-016, этап 23D).
--
-- Публикации разбираются и назначаются существующим компаниям; спорное решает человек. Имя из текста без
-- реквизита — упоминание: в каталог компаний оно не входит и ждёт решения — «это компания X» (слияние через
-- предпросмотр, resolve/entityMerge.ts), «это юрлицо с ИНН …» (реквизит origin = 'manual'), «не компания».
--
--  company_name_searches    — поиск юрлица по названию в Контур.Фокусе (метод suggest): одна строка на
--                             упоминание, срок следующего поиска, ошибка. Запрос платный — в расход тарифа;
--  company_name_suggestions — что Фокус предложил: элемент ответа как есть (payload), карта — на чтении.
--                             Это кэш платного ответа, а не решение: новый поиск заменяет строки упоминания;
--  company_dismissals       — «не компания»: кто, когда и почему; снятие — отметкой revoked_*, строка не
--                             удаляется. Действующая отметка у компании одна.
--
-- Все три таблицы ссылаются на компанию — переносятся слиянием и входят в dependencyState.

CREATE TABLE company_name_searches (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      BIGINT NOT NULL UNIQUE REFERENCES companies(id),
  -- Что ушло в строку поиска: имя карточки на момент поиска.
  query           TEXT NOT NULL,
  result_count    INTEGER NOT NULL DEFAULT 0,
  searched_at     TIMESTAMPTZ,
  next_search_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  -- Логин, если искали кнопкой; по расписанию — NULL.
  requested_by    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_name_suggestions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  inn         TEXT,
  ogrn        TEXT,
  payload     JSONB NOT NULL,
  rank        INTEGER NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_name_suggestions_identifier CHECK (inn IS NOT NULL OR ogrn IS NOT NULL),
  CONSTRAINT company_name_suggestions_inn CHECK (inn IS NULL OR inn ~ '^([0-9]{10}|[0-9]{12})$'),
  CONSTRAINT company_name_suggestions_ogrn CHECK (ogrn IS NULL OR ogrn ~ '^([0-9]{13}|[0-9]{15})$')
);

CREATE UNIQUE INDEX company_name_suggestions_uidx ON company_name_suggestions (company_id, coalesce(inn, ''), coalesce(ogrn, ''));

CREATE TABLE company_dismissals (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    BIGINT NOT NULL REFERENCES companies(id),
  reason        TEXT NOT NULL,
  dismissed_by  TEXT NOT NULL,
  dismissed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by    TEXT,
  revoked_at    TIMESTAMPTZ,
  CONSTRAINT company_dismissals_reason CHECK (length(trim(reason)) > 0),
  CONSTRAINT company_dismissals_revoked CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE UNIQUE INDEX company_dismissals_active_uidx ON company_dismissals (company_id) WHERE revoked_at IS NULL;

-- Поиск по названию — новый метод Фокуса и новый расход тарифа (ADR-015 «Последствия»).
ALTER TABLE focus_requests DROP CONSTRAINT focus_requests_method;
ALTER TABLE focus_requests ADD CONSTRAINT focus_requests_method CHECK (method IN ('req', 'egrDetails', 'stat', 'suggest'));
