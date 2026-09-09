-- 003: сырой слой. Тексты как есть + дедупликация.

CREATE TYPE doc_status AS ENUM ('new', 'queued', 'extracting', 'extracted', 'failed', 'skipped');

CREATE TABLE raw_documents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id       BIGINT      NOT NULL REFERENCES sources(id),
  source_run_id   BIGINT      REFERENCES source_runs(id),
  -- 'channel/1234' для Telegram, путь статьи для сайта
  external_id     TEXT,
  url             TEXT,
  title           TEXT,
  body            TEXT        NOT NULL,
  lang            TEXT,
  published_at    TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- sha256 нормализованного текста: репост с чужой подписью даёт тот же хэш
  content_hash    BYTEA       NOT NULL,
  -- sha256 первых 200 символов — ловит частично изменённые перепечатки
  lead_hash       BYTEA       NOT NULL,
  body_len        INT         NOT NULL,
  duplicate_of_id BIGINT      REFERENCES raw_documents(id),
  forward_from    TEXT,
  status          doc_status  NOT NULL DEFAULT 'new',
  attempts        SMALLINT    NOT NULL DEFAULT 0,
  last_error      TEXT,
  ts              tsvector GENERATED ALWAYS AS (
                    to_tsvector('russian', coalesce(title, '') || ' ' || body)
                  ) STORED
);

CREATE UNIQUE INDEX raw_documents_hash_uidx ON raw_documents (content_hash);
CREATE UNIQUE INDEX raw_documents_ext_uidx  ON raw_documents (source_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX raw_documents_queue_idx ON raw_documents (status, published_at DESC NULLS LAST, id)
  WHERE status IN ('new', 'queued', 'extracting');
CREATE INDEX raw_documents_ts_idx   ON raw_documents USING GIN (ts);
CREATE INDEX raw_documents_pub_idx  ON raw_documents (published_at DESC);
CREATE INDEX raw_documents_lead_idx ON raw_documents (lead_hash);

-- Один и тот же текст, увиденный в нескольких каналах: LLM зовём один раз,
-- но атрибуцию источников не теряем.
CREATE TABLE document_sightings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT      NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  source_id   BIGINT      NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT,
  url         TEXT,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, source_id, external_id)
);

CREATE INDEX document_sightings_doc_idx ON document_sightings (document_id);
