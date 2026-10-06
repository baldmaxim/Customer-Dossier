-- Сайты компаний: поиск в интернете и решение человека (этап 25A, ADR-018).
--
-- Модель с веб-поиском OpenRouter предлагает официальный сайт компании; кандидат принимается, только если
-- его хост был среди найденных поиском страниц (модель не выдумывает адрес). Портал открывает главную и до
-- трёх страниц «Контакты / О компании» кандидата и ищет на них реквизит компании — хранятся только признаки,
-- не текст. Решает оператор: «Это сайт компании», «Не он», «Указать вручную». Чтение подтверждённого сайта —
-- этап 25B; здесь допуск источника не выдаётся.
--
--  company_site_searches   — очередь поиска: строка на компанию, срок следующего поиска, неудачи подряд;
--  company_site_candidates — найденные и указанные вручную сайты с признаками проверки и решением оператора;
--  site_search_requests    — журнал попыток поиска: каждая попытка занимает место в суточном лимите ДО запроса.
--                            Без ссылки на компанию: это расход, а не сведения о ней.
--
-- В канон ничего не идёт; companies.website не пишется.

CREATE TABLE company_site_searches (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  query           TEXT,
  -- found — модель назвала сайт, найденный поиском; none — сайта не нашлось; no_citations — поиск не вернул
  -- ни одной страницы, и предложениям модели верить не на чем. NULL — ещё не искали.
  outcome         TEXT,
  result_count    INTEGER,
  searched_at     TIMESTAMPTZ,
  next_search_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  requested_by    TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_site_searches_company UNIQUE (company_id),
  CONSTRAINT company_site_searches_outcome CHECK (outcome IS NULL OR outcome IN ('found', 'none', 'no_citations')),
  CONSTRAINT company_site_searches_searched CHECK ((outcome IS NULL) = (searched_at IS NULL))
);

CREATE INDEX company_site_searches_due ON company_site_searches (next_search_at);

CREATE TABLE company_site_candidates (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  -- Хост без «www.» в нижнем регистре; url — origin (https://host/).
  host            TEXT NOT NULL,
  url             TEXT NOT NULL,
  found_via       TEXT NOT NULL,
  -- Из выдачи поиска: заголовок и фрагмент найденной страницы; объяснение модели — почему это сайт компании.
  title           TEXT,
  snippet         TEXT,
  model_reason    TEXT,
  model           TEXT,
  prompt_version  TEXT,
  -- Проверка кандидата: главная и до трёх страниц того же хоста. Хранятся только признаки.
  check_status    TEXT NOT NULL DEFAULT 'not_checked',
  checked_at      TIMESTAMPTZ,
  check_error     TEXT,
  page_title      TEXT,
  inn_on_page     BOOLEAN,
  ogrn_on_page    BOOLEAN,
  name_on_page    BOOLEAN,
  -- Другие ИНН с верной контрольной суммой, написанные на страницах после слова «ИНН».
  other_inns      TEXT[] NOT NULL DEFAULT '{}',
  state           TEXT NOT NULL DEFAULT 'pending',
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_site_candidates_host_unique UNIQUE (company_id, host),
  CONSTRAINT company_site_candidates_host CHECK (host ~ '^[a-z0-9.-]+$' AND host NOT LIKE 'www.%'),
  CONSTRAINT company_site_candidates_url CHECK (url ~ '^https?://[^/]+/$'),
  CONSTRAINT company_site_candidates_found_via CHECK (found_via IN ('web_search', 'operator')),
  CONSTRAINT company_site_candidates_check_status CHECK (check_status IN (
    'not_checked', 'ok', 'unreachable', 'blocked', 'redirect_other_host', 'js_only', 'not_html')),
  CONSTRAINT company_site_candidates_checked CHECK ((check_status = 'not_checked') = (checked_at IS NULL)),
  CONSTRAINT company_site_candidates_state CHECK (state IN ('pending', 'confirmed', 'rejected')),
  CONSTRAINT company_site_candidates_decided CHECK ((state = 'pending') = (decided_at IS NULL))
);

CREATE INDEX company_site_candidates_company ON company_site_candidates (company_id);
CREATE INDEX company_site_candidates_unchecked ON company_site_candidates (id) WHERE check_status = 'not_checked';
CREATE INDEX company_site_candidates_host_idx ON company_site_candidates (host) WHERE state = 'confirmed';

CREATE TABLE site_search_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  -- Номер компании без внешнего ключа: журнал расхода переживает слияние как есть.
  company_id      BIGINT,
  actor           TEXT NOT NULL,
  model           TEXT NOT NULL,
  max_results     INTEGER NOT NULL,
  -- pending занимает место в лимите, пока попытка не закончилась (упавший процесс — тоже, с запасом).
  outcome         TEXT NOT NULL,
  citations       INTEGER,
  accepted        INTEGER,
  error           TEXT,
  CONSTRAINT site_search_requests_outcome CHECK (outcome IN ('pending', 'found', 'none', 'no_citations', 'llm_error', 'invalid_answer'))
);

CREATE INDEX site_search_requests_time ON site_search_requests (requested_at);
