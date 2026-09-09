-- 006: варианты написания и очередь ручного слияния.

CREATE TABLE entity_aliases (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind entity_kind NOT NULL,
  entity_id   BIGINT      NOT NULL,
  alias       TEXT        NOT NULL,     -- ровно как встретилось в тексте
  alias_norm  TEXT        NOT NULL,
  alias_latin TEXT        NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'llm' CHECK (source IN ('llm','manual','seed')),
  hits        INT         NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX aliases_uidx ON entity_aliases (entity_kind, entity_id, alias_norm);
CREATE INDEX aliases_exact_idx   ON entity_aliases (entity_kind, alias_norm);
CREATE INDEX aliases_norm_trgm   ON entity_aliases USING GIN (alias_norm  gin_trgm_ops);
CREATE INDEX aliases_latin_trgm  ON entity_aliases USING GIN (alias_latin gin_trgm_ops);

CREATE TYPE merge_status AS ENUM ('pending', 'merged', 'rejected');

CREATE TABLE merge_queue (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind        entity_kind  NOT NULL,
  source_entity_id   BIGINT       NOT NULL,   -- новичок
  target_entity_id   BIGINT       NOT NULL,   -- в кого предлагается слить
  score              NUMERIC(4,3) NOT NULL,
  -- {"s_latin":0.81,"s_norm":0.62,"bin":"none","city":"match"}
  reasons            JSONB        NOT NULL,
  sample_document_id BIGINT       REFERENCES raw_documents(id) ON DELETE SET NULL,
  status             merge_status NOT NULL DEFAULT 'pending',
  decided_by         TEXT,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT mq_not_self CHECK (source_entity_id <> target_entity_id)
);

-- Одна пара в очереди в любом состоянии: отклонённое не всплывает снова.
CREATE UNIQUE INDEX merge_queue_pair_uidx ON merge_queue
  (entity_kind,
   least(source_entity_id, target_entity_id),
   greatest(source_entity_id, target_entity_id));
CREATE INDEX merge_queue_pending_idx ON merge_queue (score DESC) WHERE status = 'pending';
