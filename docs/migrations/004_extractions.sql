-- 004: результат работы LLM. Сырой JSONB + версия промпта/модели,
-- чтобы можно было переизвлечь и сравнить качество версий.

CREATE TYPE extraction_status AS ENUM ('ok', 'invalid_json', 'schema_error', 'llm_error');

CREATE TABLE extractions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id    BIGINT            NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
  chunk_index    SMALLINT          NOT NULL DEFAULT 0,
  prompt_version TEXT              NOT NULL,
  model          TEXT              NOT NULL,
  schema_version TEXT              NOT NULL,
  status         extraction_status NOT NULL,
  payload        JSONB,
  -- Только при ошибке; чистится по ретеншну 90 дней, иначе таблица распухнет
  -- быстрее, чем сами тексты.
  raw_response   TEXT,
  confidence     NUMERIC(4,3),
  tokens_in      INT,
  tokens_out     INT,
  latency_ms     INT,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT now(),
  applied_at     TIMESTAMPTZ
);

-- Ключ идемпотентности: повтор запуска не зовёт LLM.
-- Переизвлечение = bump PROMPT_VERSION, старые строки остаются.
CREATE UNIQUE INDEX extractions_idem_uidx
  ON extractions (document_id, chunk_index, prompt_version, model);
CREATE INDEX extractions_payload_gin ON extractions USING GIN (payload jsonb_path_ops);
CREATE INDEX extractions_pending_idx ON extractions (document_id)
  WHERE status = 'ok' AND applied_at IS NULL;
CREATE INDEX extractions_errors_idx  ON extractions (created_at DESC) WHERE status <> 'ok';
