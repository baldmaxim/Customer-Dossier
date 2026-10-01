-- Компании портала в едином реестре застройщиков ДОМ.РФ (этап 20D, шаг 2).
--
-- Каждую компанию портала (заказчиков и застройщиков первыми) браузерный работник ищет в реестре
-- застройщиков: по ИНН или ОГРН, если они есть, иначе по названию. Найденные застройщики и группы —
-- предложения: оператор подтверждает «это он» или отклоняет. Подтверждённая страница становится обычной
-- страницей реестра (domrf_cards), и её объекты приходят кандидатами, как на шаге 1.
--
-- Обе таблицы ссылаются на компанию и переносятся слиянием (resolve/entityMerge.ts).

CREATE TABLE domrf_company_searches (
  -- id — для журнала слияния (entity_merge_moves ведёт строки по id), компания — уникальна.
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      BIGINT NOT NULL UNIQUE REFERENCES companies(id),
  -- Чем искали: реквизит или название — и что именно ушло в строку поиска.
  query           TEXT NOT NULL,
  found_by        TEXT NOT NULL,
  result_count    INTEGER NOT NULL DEFAULT 0,
  searched_at     TIMESTAMPTZ,
  next_search_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domrf_company_searches_found_by CHECK (found_by IN ('inn', 'name'))
);

CREATE TABLE domrf_company_links (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      BIGINT NOT NULL REFERENCES companies(id),
  kind            TEXT NOT NULL,
  external_ref    TEXT NOT NULL,
  name            TEXT,
  -- inn/name — найдено поиском; manual — страницу указал оператор.
  found_by        TEXT NOT NULL,
  rank            INTEGER,
  state           TEXT NOT NULL DEFAULT 'pending',
  decided_by      TEXT,
  decided_at      TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT domrf_company_links_kind CHECK (kind IN ('developer', 'group')),
  CONSTRAINT domrf_company_links_ref CHECK (external_ref ~ '^[0-9]{1,18}$'),
  CONSTRAINT domrf_company_links_found_by CHECK (found_by IN ('inn', 'name', 'manual')),
  CONSTRAINT domrf_company_links_state CHECK (state IN ('pending', 'confirmed', 'rejected')),
  CONSTRAINT domrf_company_links_decided CHECK ((state = 'pending') = (decided_at IS NULL)),
  CONSTRAINT domrf_company_links_unique UNIQUE (company_id, kind, external_ref)
);

CREATE INDEX domrf_company_links_card_idx ON domrf_company_links (kind, external_ref) WHERE state = 'confirmed';
