-- 011: публикации, неизменяемые версии текста и наблюдения.
--
-- Только расширение схемы. raw_documents и document_sightings остаются и
-- продолжают обслуживать текущие карточки и цитаты (legacy-чтение).
--
--   source_items          личность публикации внутри источника
--   document_revisions    неизменяемая наблюдаемая редакция текста
--   source_observations   факт «видели эту редакцию тогда-то»
--
-- Хэш текста помогает понять, изменилась ли публикация, но личностью не
-- является: один текст в трёх каналах — три публикации.

CREATE TYPE text_completeness AS ENUM ('full', 'excerpt', 'caption_only', 'failed', 'unknown');
CREATE TYPE source_item_state AS ENUM ('present', 'deleted_observed');

CREATE TABLE source_items (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Без каскада: удаление источника не должно уносить историю публикаций.
  source_id                 BIGINT      NOT NULL REFERENCES sources(id),
  -- ext:<external_id> | url:<canonical_url> | text:<sha256> | legacy:<raw_document_id>
  item_key                  TEXT        NOT NULL,
  item_key_kind             TEXT        NOT NULL
                            CHECK (item_key_kind IN ('external_id', 'canonical_url', 'text_hash', 'legacy_document')),
  external_id               TEXT,
  canonical_url             TEXT,
  original_url              TEXT,
  -- Дата публикации по данным источника; неизвестна — NULL.
  published_at              TIMESTAMPTZ,
  state                     source_item_state NOT NULL DEFAULT 'present',
  -- Только реально наблюдавшееся удаление. «Не попала в выборку» сюда не пишется.
  deleted_observed_at       TIMESTAMPTZ,
  first_observed_at         TIMESTAMPTZ NOT NULL,
  last_observed_at          TIMESTAMPTZ NOT NULL,
  -- Текущее состояние по мнению системы и когда оно было наблюдено.
  latest_revision_id        BIGINT,
  latest_state_observed_at  TIMESTAMPTZ,
  latest_source_modified_at TIMESTAMPTZ,
  -- 'unknown' — публикация существовала до начала учёта версий, её прежние
  -- редакции не видели. Не восстанавливается догадкой.
  history_before_import     TEXT        NOT NULL DEFAULT 'complete'
                            CHECK (history_before_import IN ('complete', 'unknown')),
  origin                    TEXT        NOT NULL DEFAULT 'ingest'
                            CHECK (origin IN ('ingest', 'legacy_import')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, item_key),
  CONSTRAINT source_items_deleted_at CHECK (state <> 'deleted_observed' OR deleted_observed_at IS NOT NULL)
);

CREATE INDEX source_items_source_idx ON source_items (source_id, last_observed_at DESC);
CREATE INDEX source_items_canonical_url_idx ON source_items (canonical_url) WHERE canonical_url IS NOT NULL;

CREATE TABLE document_revisions (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_item_id          BIGINT      NOT NULL REFERENCES source_items(id),
  -- Порядковый номер наблюдённой редакции внутри публикации (1, 2, 3…).
  revision_no             INT         NOT NULL CHECK (revision_no > 0),
  title                   TEXT,
  -- Текст ровно в том представлении, в котором он уходит в извлечение и
  -- с которым сверяются цитаты. HTML не хранится: адаптер отдаёт текст.
  body                    TEXT        NOT NULL,
  -- Как получен body: <адаптер>@<версия очистки>, например telegram_web_text@1.
  body_representation     TEXT        NOT NULL,
  -- sha256 канонической формы body (NFC, LF, без хвостовых пробелов строк).
  body_hash               BYTEA       NOT NULL,
  -- Хэш дедупликации перепечаток (как raw_documents.content_hash) — сигнал, не личность.
  dedup_hash              BYTEA       NOT NULL,
  completeness            text_completeness NOT NULL DEFAULT 'unknown',
  completeness_reason     TEXT,
  -- Вложения и их поддержка: [{"kind":"photo","status":"unsupported"}].
  attachments             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  published_at            TIMESTAMPTZ,
  source_modified_at      TIMESTAMPTZ,
  first_observed_at       TIMESTAMPTZ NOT NULL,
  -- На чём основан порядок редакций: дата изменения от источника, порядок
  -- наблюдения или ничего надёжного.
  chronology              TEXT        NOT NULL
                          CHECK (chronology IN ('source_modified_at', 'observed_order', 'unknown')),
  -- Текст совпадает с более ранней редакцией (A → B → A).
  same_content_as_revision_id BIGINT REFERENCES document_revisions(id),
  -- Мост к legacy: документ, к которому привязаны существующие цитаты.
  legacy_document_id      BIGINT      REFERENCES raw_documents(id),
  origin                  TEXT        NOT NULL DEFAULT 'ingest'
                          CHECK (origin IN ('ingest', 'legacy_import')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_item_id, revision_no)
);

CREATE INDEX document_revisions_item_hash_idx ON document_revisions (source_item_id, body_hash);
CREATE INDEX document_revisions_legacy_idx ON document_revisions (legacy_document_id) WHERE legacy_document_id IS NOT NULL;
-- Повторный backfill не создаёт вторую редакцию из того же legacy-документа.
CREATE UNIQUE INDEX document_revisions_legacy_import_uidx
  ON document_revisions (source_item_id, legacy_document_id) WHERE origin = 'legacy_import';

ALTER TABLE source_items
  ADD CONSTRAINT source_items_latest_revision_fk FOREIGN KEY (latest_revision_id) REFERENCES document_revisions(id);

-- Неизменяемость редакций обеспечивает база, а не соглашение в коде:
-- к тексту редакции привязываются цитаты и решения.
CREATE FUNCTION document_revisions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document_revisions неизменяемы: % запрещён', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER document_revisions_no_update
  BEFORE UPDATE OR DELETE ON document_revisions
  FOR EACH ROW EXECUTE FUNCTION document_revisions_immutable();

CREATE TABLE source_observations (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id           BIGINT      NOT NULL REFERENCES sources(id),
  source_item_id      BIGINT      NOT NULL REFERENCES source_items(id),
  -- NULL только у наблюдения удаления.
  revision_id         BIGINT      REFERENCES document_revisions(id),
  source_run_id       BIGINT      REFERENCES source_runs(id) ON DELETE SET NULL,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Когда адаптер получил ответ источника (может быть раньше записи).
  fetched_at          TIMESTAMPTZ,
  observed_url        TEXT,
  outcome             TEXT        NOT NULL CHECK (outcome IN (
                        'new_item', 'new_revision', 'unchanged', 'stale', 'deleted_observed', 'legacy_import')),
  forward_origin      TEXT,
  legacy_sighting_id  BIGINT      REFERENCES document_sightings(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_observations_revision_required CHECK (outcome = 'deleted_observed' OR revision_id IS NOT NULL)
);

CREATE INDEX source_observations_item_idx ON source_observations (source_item_id, observed_at DESC);
CREATE INDEX source_observations_source_idx ON source_observations (source_id, observed_at DESC);
CREATE UNIQUE INDEX source_observations_legacy_sighting_uidx
  ON source_observations (legacy_sighting_id) WHERE legacy_sighting_id IS NOT NULL;

-- Позиция пакетных backfill-команд: повторный запуск продолжает, а не начинает заново.
CREATE TABLE backfill_checkpoints (
  name        TEXT        PRIMARY KEY,
  last_id     BIGINT      NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
