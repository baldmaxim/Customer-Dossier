-- 013: неизменяемые запуски извлечения, наборы кандидатов и атомарная публикация.
--
-- revision → extraction_run (fingerprint, lease/fencing) → extraction_chunks (диапазоны)
--          → extraction_chunk_responses (ответы модели, append-only)
--          → candidate_set / candidate_assertions (не опубликовано)
--          → item_publications (указатель на опубликованный набор публикации, версия)
--
-- Старый путь (raw_documents → extractions → apply с удалением вклада) остаётся
-- заблокированным. Legacy-таблицы канона новым конвейером не пишутся; карточки
-- читают их через представления ниже, где переразобранные документы замещаются
-- опубликованными утверждениями.

CREATE TABLE extraction_runs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision_id       BIGINT NOT NULL REFERENCES document_revisions(id),
  -- sha256 параметров: промпт, схема, модель, провайдер, параметры генерации, версия нарезки.
  fingerprint       TEXT NOT NULL,
  fingerprint_json  JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  -- Lease: кто и до какого момента держит запуск. fencing_token растёт при каждом захвате;
  -- запись с устаревшим токеном отвергается — два worker'а не пишут в один запуск.
  lease_owner       TEXT,
  lease_expires_at  TIMESTAMPTZ,
  fencing_token     BIGINT NOT NULL DEFAULT 0,
  claim_count       INT NOT NULL DEFAULT 0,
  covered_chars     INT,
  total_chars       INT,
  relevant          BOOLEAN,
  error             TEXT,
  requested_by      TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ
);

CREATE INDEX extraction_runs_queue_idx ON extraction_runs (status, created_at) WHERE status IN ('queued', 'running');
CREATE INDEX extraction_runs_revision_idx ON extraction_runs (revision_id, created_at DESC);
-- Одна живая очередь на пару редакция+параметры: повторный запрос не плодит дубликаты.
CREATE UNIQUE INDEX extraction_runs_live_uidx ON extraction_runs (revision_id, fingerprint) WHERE status IN ('queued', 'running');

CREATE TABLE extraction_chunks (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id       BIGINT NOT NULL REFERENCES extraction_runs(id),
  chunk_index  INT NOT NULL CHECK (chunk_index >= 0),
  -- Диапазон в code points document_revisions.body, [range_start, range_end).
  range_start  INT NOT NULL CHECK (range_start >= 0),
  range_end    INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'ok', 'failed')),
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT,
  UNIQUE (run_id, chunk_index),
  CONSTRAINT extraction_chunks_range CHECK (range_end > range_start)
);

CREATE TABLE extraction_chunk_responses (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chunk_id       BIGINT NOT NULL REFERENCES extraction_chunks(id),
  attempt_no     INT NOT NULL,
  fencing_token  BIGINT NOT NULL,
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok', 'invalid_json', 'schema_error', 'llm_error', 'timeout', 'truncated_input')),
  payload        JSONB,
  payload_hash   TEXT,
  raw_response   TEXT,
  error          TEXT,
  tokens_in      INT,
  tokens_out     INT,
  latency_ms     INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, attempt_no)
);

CREATE TRIGGER extraction_chunk_responses_append_only
  BEFORE UPDATE OR DELETE ON extraction_chunk_responses
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

CREATE TABLE candidate_sets (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id          BIGINT NOT NULL UNIQUE REFERENCES extraction_runs(id),
  revision_id     BIGINT NOT NULL REFERENCES document_revisions(id),
  source_item_id  BIGINT NOT NULL REFERENCES source_items(id),
  relevant        BOOLEAN NOT NULL,
  status          TEXT NOT NULL DEFAULT 'built'
                  CHECK (status IN ('built', 'published', 'superseded', 'rejected_policy', 'rejected_stale', 'discarded')),
  status_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX candidate_sets_item_idx ON candidate_sets (source_item_id, created_at DESC);

CREATE TABLE candidate_assertions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  set_id         BIGINT NOT NULL REFERENCES candidate_sets(id),
  -- Содержание утверждения; стороны — ссылками на mention-id внутри запуска (c<чанк>:<вид>:<n>),
  -- компании и объекты разрешаются только при публикации.
  content        JSONB NOT NULL,
  -- Найденные в тексте основания: [{chunkId, spanStart, spanEnd, quote, stance}].
  evidence       JSONB NOT NULL DEFAULT '[]'::jsonb,
  grounded       BOOLEAN NOT NULL,
  confidence     NUMERIC(4, 3),
  rejected_reason TEXT
);

CREATE INDEX candidate_assertions_set_idx ON candidate_assertions (set_id);

CREATE TABLE item_publications (
  source_item_id        BIGINT PRIMARY KEY REFERENCES source_items(id),
  active_set_id         BIGINT REFERENCES candidate_sets(id),
  version               INT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE publication_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_item_id   BIGINT NOT NULL REFERENCES source_items(id),
  from_set_id      BIGINT REFERENCES candidate_sets(id),
  to_set_id        BIGINT REFERENCES candidate_sets(id),
  action           TEXT NOT NULL CHECK (action IN ('publish', 'rejected_policy', 'rejected_stale')),
  actor            TEXT NOT NULL,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER publication_history_append_only
  BEFORE UPDATE OR DELETE ON publication_history
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Какие доказательства внёс какой набор: доказательство может принадлежать нескольким
-- наборам (одинаковая позиция в повторном разборе), а снимается только своё.
CREATE TABLE candidate_set_evidence (
  set_id       BIGINT NOT NULL REFERENCES candidate_sets(id),
  evidence_id  BIGINT NOT NULL REFERENCES evidence(id),
  PRIMARY KEY (set_id, evidence_id)
);

CREATE INDEX candidate_set_evidence_evidence_idx ON candidate_set_evidence (evidence_id);

-- Различитель недоопределённого события: без даты, суммы и контрагента два суда одной
-- компании иначе имели бы одно содержание. Входит в content_key и неизменяем.
ALTER TABLE assertions ADD COLUMN event_discriminator TEXT;

CREATE OR REPLACE FUNCTION assertions_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'assertions: удаление запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.predicate, NEW.role, NEW.event_type, NEW.subject_company_id, NEW.subject_project_id, NEW.subject_text,
      NEW.object_company_id, NEW.object_project_id, NEW.object_text, NEW.counterparty_company_id,
      NEW.scope_building, NEW.work_package,
      NEW.valid_from, NEW.valid_to, NEW.period_precision, NEW.modality, NEW.value_type, NEW.value_numeric,
      NEW.value_currency, NEW.content_key, NEW.supersedes_assertion_id, NEW.origin, NEW.created_at,
      NEW.event_discriminator)
     IS DISTINCT FROM
     (OLD.predicate, OLD.role, OLD.event_type, OLD.subject_company_id, OLD.subject_project_id, OLD.subject_text,
      OLD.object_company_id, OLD.object_project_id, OLD.object_text, OLD.counterparty_company_id,
      OLD.scope_building, OLD.work_package,
      OLD.valid_from, OLD.valid_to, OLD.period_precision, OLD.modality, OLD.value_type, OLD.value_numeric,
      OLD.value_currency, OLD.content_key, OLD.supersedes_assertion_id, OLD.origin, OLD.created_at,
      OLD.event_discriminator) THEN
    RAISE EXCEPTION 'assertions: содержание утверждения неизменяемо — новый смысл оформляется новым утверждением'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Доказательство знает, из какого чанка оно получено: evidence → chunk → run → revision.
ALTER TABLE evidence ADD COLUMN extraction_chunk_id BIGINT REFERENCES extraction_chunks(id);

-- Доказательство, чей набор замещён новым разбором, — superseded: строка остаётся.
ALTER TABLE evidence DROP CONSTRAINT evidence_status_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_status_check
  CHECK (status IN ('active', 'withdrawn', 'unavailable', 'superseded'));

-- Неизменяемость доказательства теперь включает и ссылку на чанк.
CREATE OR REPLACE FUNCTION evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fragment TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence: удаление запрещено, используйте отзыв' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.assertion_id, NEW.revision_id, NEW.stance, NEW.span_start, NEW.span_end, NEW.quote, NEW.context_before,
        NEW.context_after, NEW.origin, NEW.extraction_id, NEW.legacy_kind, NEW.legacy_id, NEW.created_at,
        NEW.extraction_chunk_id)
       IS DISTINCT FROM
       (OLD.assertion_id, OLD.revision_id, OLD.stance, OLD.span_start, OLD.span_end, OLD.quote, OLD.context_before,
        OLD.context_after, OLD.origin, OLD.extraction_id, OLD.legacy_kind, OLD.legacy_id, OLD.created_at,
        OLD.extraction_chunk_id) THEN
      RAISE EXCEPTION 'evidence: содержание доказательства неизменяемо' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT substring(r.body FROM NEW.span_start + 1 FOR NEW.span_end - NEW.span_start)
    INTO fragment FROM document_revisions r WHERE r.id = NEW.revision_id;
  IF fragment IS DISTINCT FROM NEW.quote THEN
    RAISE EXCEPTION 'evidence: quote не совпадает с фрагментом редакции % [% , %)', NEW.revision_id, NEW.span_start, NEW.span_end
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Legacy-документы, чья публикация уже переразобрана новым конвейером:
-- их прежний вклад в карточки замещается опубликованными утверждениями.
CREATE VIEW replaced_legacy_documents_v AS
SELECT DISTINCT r.legacy_document_id AS document_id
FROM item_publications p
JOIN document_revisions r ON r.source_item_id = p.source_item_id
WHERE p.active_set_id IS NOT NULL AND r.legacy_document_id IS NOT NULL;

-- Опубликованные новым конвейером утверждения с активными доказательствами активного набора.
CREATE VIEW published_assertions_v AS
SELECT DISTINCT ON (a.id, cs.id)
       a.*, cs.source_item_id, cs.revision_id AS published_revision_id, r.legacy_document_id AS evidence_document_id
FROM item_publications p
JOIN candidate_sets cs ON cs.id = p.active_set_id
JOIN candidate_set_evidence cse ON cse.set_id = cs.id
JOIN evidence e ON e.id = cse.evidence_id AND e.status = 'active'
JOIN assertions a ON a.id = e.assertion_id AND a.status <> 'rejected'
JOIN document_revisions r ON r.id = cs.revision_id;

-- Роли на объектах для карточек: legacy, пока документ не переразобран, плюс опубликованное.
CREATE VIEW card_participations_v AS
SELECT pp.project_id, pp.company_id, pp.role, pp.confidence, pp.evidence_document_id, pp.is_current,
       'legacy'::text AS origin, NULL::bigint AS assertion_id
FROM project_participants pp
WHERE pp.evidence_document_id IS NULL
   OR pp.evidence_document_id NOT IN (SELECT document_id FROM replaced_legacy_documents_v)
UNION ALL
SELECT pa.object_project_id, pa.subject_company_id, pa.role, coalesce(pa.confidence_extraction, 0.5),
       pa.evidence_document_id, true, 'published', pa.id
FROM published_assertions_v pa
WHERE pa.predicate = 'participates_in_project' AND pa.subject_company_id IS NOT NULL AND pa.object_project_id IS NOT NULL;

-- События для карточек по тому же правилу. id опубликованных — отрицательные id утверждений,
-- чтобы не пересекаться с legacy events.id. Вручную подтверждённое legacy-событие
-- остаётся видимым и после переразбора: ручное решение не пропадает из карточки.
CREATE VIEW card_events_v AS
SELECT e.id, e.type, e.occurred_on, e.project_id, e.company_id, e.counterparty_id, e.severity, e.amount_rub,
       e.document_id, e.quote, e.confidence, e.status, 'legacy'::text AS origin
FROM events e
WHERE e.status = 'confirmed'
   OR e.document_id NOT IN (SELECT document_id FROM replaced_legacy_documents_v)
UNION ALL
SELECT -pa.id, pa.event_type, pa.valid_from, coalesce(pa.object_project_id, pa.subject_project_id),
       pa.subject_company_id, pa.counterparty_company_id,
       (CASE WHEN pa.event_type IN ('bankruptcy', 'license_revoked') THEN 3
             WHEN pa.event_type IN ('court_case', 'deadline_missed') THEN 2
             WHEN pa.event_type IN ('delay', 'contractor_change') THEN 1
             ELSE 0 END)::smallint,
       CASE WHEN pa.value_type = 'amount' THEN pa.value_numeric END,
       pa.evidence_document_id,
       (SELECT ev.quote FROM evidence ev WHERE ev.assertion_id = pa.id AND ev.status = 'active' ORDER BY ev.id LIMIT 1),
       coalesce(pa.confidence_extraction, 0.5), pa.status::text, 'published'
FROM published_assertions_v pa
WHERE pa.predicate = 'event';
