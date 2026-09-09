-- 005: канонический слой. Компании, проекты, роли, упоминания, события.

CREATE TYPE entity_kind AS ENUM ('company', 'project');
CREATE TYPE sentiment   AS ENUM ('positive', 'neutral', 'negative');

CREATE TABLE companies (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           TEXT NOT NULL,               -- каноническое отображаемое
  name_norm      TEXT NOT NULL,               -- без ОПФ/кавычек, lower, каз. буквы -> рус.
  name_latin     TEXT NOT NULL,               -- транслит name_norm в латиницу
  name_key       TEXT GENERATED ALWAYS AS (replace(name_latin, ' ', '')) STORED,
  legal_form     TEXT,                        -- ТОО/АО/ИП/ЖШС/КГП/ГКП/РГП/ТДО/...
  bin            CHAR(12),
  city           TEXT,
  website        TEXT,
  is_verified    BOOLEAN     NOT NULL DEFAULT false,
  merged_into_id BIGINT      REFERENCES companies(id),   -- tombstone после слияния
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_bin_fmt CHECK (bin IS NULL OR bin ~ '^[0-9]{12}$')
);

CREATE UNIQUE INDEX companies_bin_uidx ON companies (bin)
  WHERE bin IS NOT NULL AND merged_into_id IS NULL;
CREATE INDEX companies_norm_trgm  ON companies USING GIN (name_norm  gin_trgm_ops);
CREATE INDEX companies_latin_trgm ON companies USING GIN (name_latin gin_trgm_ops);
CREATE INDEX companies_key_idx    ON companies (name_key) WHERE merged_into_id IS NULL;

CREATE TABLE projects (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               TEXT NOT NULL,
  name_norm          TEXT NOT NULL,
  name_latin         TEXT NOT NULL,
  name_key           TEXT GENERATED ALWAYS AS (replace(name_latin, ' ', '')) STORED,
  kind               TEXT NOT NULL DEFAULT 'other'
                     CHECK (kind IN ('residential','office','industrial','infrastructure','social','other')),
  stage              TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (stage IN ('announced','design','construction','suspended','commissioned','cancelled','unknown')),
  city               TEXT,
  address            TEXT,
  planned_completion DATE,
  actual_completion  DATE,
  merged_into_id     BIGINT      REFERENCES projects(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_norm_trgm  ON projects USING GIN (name_norm  gin_trgm_ops);
CREATE INDEX projects_latin_trgm ON projects USING GIN (name_latin gin_trgm_ops);
CREATE INDEX projects_city_idx   ON projects (city) WHERE merged_into_id IS NULL;

-- Роль — не свойство компании: одна и та же компания бывает заказчиком на одном
-- объекте и подрядчиком на другом. Поэтому роль живёт на связи.
CREATE TABLE project_participants (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id           BIGINT NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  company_id           BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role                 TEXT   NOT NULL CHECK (role IN
                       ('customer','general_contractor','contractor','designer','investor','operator')),
  started_on           DATE,
  ended_on             DATE,
  is_current           BOOLEAN       NOT NULL DEFAULT true,
  confidence           NUMERIC(4,3)  NOT NULL DEFAULT 0.5,
  evidence_document_id BIGINT        REFERENCES raw_documents(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT pp_period CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);

CREATE UNIQUE INDEX pp_current_uidx ON project_participants (project_id, company_id, role)
  WHERE ended_on IS NULL;
CREATE INDEX pp_company_idx ON project_participants (company_id, role) WHERE is_current;
CREATE INDEX pp_project_idx ON project_participants (project_id);

-- entity_id — полиморфная ссылка без FK: осознанный размен, иначе нужны две
-- почти одинаковые таблицы. Цена — при слиянии сущностей entity_id переставляем
-- вручную, ровно в одной функции (resolve/merge.ts).
CREATE TABLE mentions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id    BIGINT       NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  extraction_id  BIGINT       REFERENCES extractions(id) ON DELETE SET NULL,
  entity_kind    entity_kind  NOT NULL,
  entity_id      BIGINT       NOT NULL,
  surface_form   TEXT         NOT NULL,       -- как названо в тексте
  role           TEXT         CHECK (role IS NULL OR role IN
                 ('customer','general_contractor','contractor','designer','investor','operator')),
  quote          TEXT         NOT NULL,
  quote_verified BOOLEAN      NOT NULL DEFAULT false,
  sentiment      sentiment    NOT NULL DEFAULT 'neutral',
  confidence     NUMERIC(4,3) NOT NULL,
  published_at   TIMESTAMPTZ  NOT NULL,       -- денорм. из документа: окна 90 дней
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mentions_uidx ON mentions (document_id, entity_kind, entity_id, md5(quote));
CREATE INDEX mentions_feed_idx ON mentions (entity_kind, entity_id, published_at DESC);
CREATE INDEX mentions_neg_idx  ON mentions (entity_kind, entity_id, published_at DESC)
  WHERE sentiment = 'negative';

CREATE TABLE events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN (
                    'construction_start','milestone','delay','deadline_missed','court_case',
                    'contractor_change','commissioning','bankruptcy','license_revoked',
                    'tender_award','other')),
  occurred_on     DATE,                      -- дата события, НЕ дата поста
  project_id      BIGINT REFERENCES projects(id)  ON DELETE SET NULL,
  company_id      BIGINT REFERENCES companies(id) ON DELETE SET NULL,
  counterparty_id BIGINT REFERENCES companies(id) ON DELETE SET NULL,  -- кого сменили и т.п.
  role            TEXT,
  severity        SMALLINT     NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 3),
  amount_kzt      NUMERIC(18,2),
  document_id     BIGINT       NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  extraction_id   BIGINT       REFERENCES extractions(id) ON DELETE SET NULL,
  quote           TEXT         NOT NULL,
  confidence      NUMERIC(4,3) NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','confirmed','rejected')),
  details         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX events_uidx ON events
  (document_id, type, coalesce(project_id, 0), coalesce(company_id, 0));
CREATE INDEX events_company_idx ON events (company_id, occurred_on DESC) WHERE status <> 'rejected';
CREATE INDEX events_project_idx ON events (project_id, occurred_on DESC) WHERE status <> 'rejected';
CREATE INDEX events_details_gin ON events USING GIN (details jsonb_path_ops);
