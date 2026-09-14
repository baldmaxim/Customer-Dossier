-- 012: утверждения, доказательства и решения аналитика.
--
-- Только расширение. Legacy mentions / events / project_participants остаются
-- и продолжают питать текущие карточки.
--
--   assertions        что утверждается: предикат, стороны, объект, период, модальность.
--                     Содержательные поля неизменяемы: новый смысл — новое утверждение.
--   evidence          конкретная редакция + точный фрагмент; supports / contradicts / mentions.
--                     Отзыв — статус, а не удаление.
--   review_decisions  append-only история решений с версией утверждения и хэшем набора
--                     доказательств на момент решения.
--
-- Offsets фрагмента — в символах Unicode (code points) текста document_revisions.body,
-- интервал [span_start, span_end). Совпадение quote с фрагментом проверяет база.

CREATE TYPE assertion_status AS ENUM ('candidate', 'text_grounded', 'reviewed_supported', 'disputed', 'rejected');
CREATE TYPE assertion_modality AS ENUM ('reported_fact', 'claim', 'planned', 'possible', 'negated', 'unknown');
CREATE TYPE evidence_stance AS ENUM ('supports', 'contradicts', 'mentions');

CREATE TABLE assertions (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  predicate              TEXT NOT NULL
                         CHECK (predicate IN ('participates_in_project', 'event', 'company_mentioned', 'project_mentioned')),
  role                   TEXT CHECK (role IS NULL OR role IN
                         ('customer', 'general_contractor', 'contractor', 'designer', 'investor', 'operator')),
  event_type             TEXT,
  -- Стороны: реальные FK на канонические таблицы, не полиморфный id без контроля.
  subject_company_id     BIGINT REFERENCES companies(id),
  subject_project_id     BIGINT REFERENCES projects(id),
  -- Неразрешённая сторона (поверхностная форма из текста) — только у кандидата.
  subject_text           TEXT,
  object_company_id      BIGINT REFERENCES companies(id),
  object_project_id      BIGINT REFERENCES projects(id),
  object_text            TEXT,
  -- Вторая компания события (кого сменили, с кем спор). Не договор и не вина.
  counterparty_company_id BIGINT REFERENCES companies(id),
  -- Уточнение объекта участия: корпус/очередь и пакет работ. NULL — не установлено.
  scope_building         TEXT,
  work_package           TEXT,
  valid_from             DATE,
  valid_to               DATE,
  period_precision       TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (period_precision IN ('day', 'month', 'quarter', 'year', 'unknown')),
  modality               assertion_modality NOT NULL DEFAULT 'unknown',
  value_type             TEXT,
  value_numeric          NUMERIC(20, 2),
  value_currency         TEXT,
  -- sha256 содержательной идентичности: одинаковый смысл — одно утверждение.
  content_key            TEXT NOT NULL UNIQUE,
  -- Новый смысл старого утверждения: связь, но не наследование решений.
  supersedes_assertion_id BIGINT REFERENCES assertions(id),
  -- Текущее состояние (производное: последние доказательства и решения).
  status                 assertion_status NOT NULL DEFAULT 'candidate',
  needs_revalidation     BOOLEAN NOT NULL DEFAULT false,
  -- Версия для оптимистичной блокировки: растёт при каждом изменении состояния.
  version                INT NOT NULL DEFAULT 1,
  -- Разные числа, не одно: уверенность модели и уверенность сопоставления сущностей.
  confidence_extraction  NUMERIC(4, 3),
  confidence_identity    NUMERIC(4, 3),
  origin                 TEXT NOT NULL CHECK (origin IN ('extraction', 'legacy_import', 'manual')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assertions_subject_resolved CHECK (
    num_nonnulls(subject_company_id, subject_project_id) = 1
    OR (num_nonnulls(subject_company_id, subject_project_id) = 0
        AND subject_text IS NOT NULL AND status IN ('candidate', 'rejected'))
  ),
  CONSTRAINT assertions_object_single CHECK (num_nonnulls(object_company_id, object_project_id) <= 1),
  CONSTRAINT assertions_period CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT assertions_predicate_shape CHECK (
    CASE predicate
      WHEN 'participates_in_project' THEN role IS NOT NULL AND subject_project_id IS NULL
           AND (object_project_id IS NOT NULL OR (object_text IS NOT NULL AND status IN ('candidate', 'rejected')))
      WHEN 'event' THEN event_type IS NOT NULL
      WHEN 'company_mentioned' THEN subject_project_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
      WHEN 'project_mentioned' THEN subject_company_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
    END
  )
);

CREATE INDEX assertions_subject_company_idx ON assertions (subject_company_id) WHERE subject_company_id IS NOT NULL;
CREATE INDEX assertions_object_project_idx ON assertions (object_project_id) WHERE object_project_id IS NOT NULL;
CREATE INDEX assertions_status_idx ON assertions (status, needs_revalidation);

-- Содержание утверждения неизменяемо; меняется только состояние.
CREATE FUNCTION assertions_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'assertions: удаление запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.predicate, NEW.role, NEW.event_type, NEW.subject_company_id, NEW.subject_project_id, NEW.subject_text,
      NEW.object_company_id, NEW.object_project_id, NEW.object_text, NEW.counterparty_company_id,
      NEW.scope_building, NEW.work_package,
      NEW.valid_from, NEW.valid_to, NEW.period_precision, NEW.modality, NEW.value_type, NEW.value_numeric,
      NEW.value_currency, NEW.content_key, NEW.supersedes_assertion_id, NEW.origin, NEW.created_at)
     IS DISTINCT FROM
     (OLD.predicate, OLD.role, OLD.event_type, OLD.subject_company_id, OLD.subject_project_id, OLD.subject_text,
      OLD.object_company_id, OLD.object_project_id, OLD.object_text, OLD.counterparty_company_id,
      OLD.scope_building, OLD.work_package,
      OLD.valid_from, OLD.valid_to, OLD.period_precision, OLD.modality, OLD.value_type, OLD.value_numeric,
      OLD.value_currency, OLD.content_key, OLD.supersedes_assertion_id, OLD.origin, OLD.created_at) THEN
    RAISE EXCEPTION 'assertions: содержание утверждения неизменяемо — новый смысл оформляется новым утверждением'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assertions_content_guard
  BEFORE UPDATE OR DELETE ON assertions
  FOR EACH ROW EXECUTE FUNCTION assertions_content_immutable();

CREATE TABLE evidence (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assertion_id    BIGINT NOT NULL REFERENCES assertions(id),
  revision_id     BIGINT NOT NULL REFERENCES document_revisions(id),
  stance          evidence_stance NOT NULL,
  span_start      INT NOT NULL CHECK (span_start >= 0),
  span_end        INT NOT NULL,
  quote           TEXT NOT NULL,
  -- До 80 символов вокруг фрагмента: различает одинаковые цитаты в одном тексте.
  context_before  TEXT NOT NULL DEFAULT '',
  context_after   TEXT NOT NULL DEFAULT '',
  origin          TEXT NOT NULL CHECK (origin IN ('extraction', 'legacy_import', 'manual')),
  extraction_id   BIGINT REFERENCES extractions(id) ON DELETE SET NULL,
  legacy_kind     TEXT CHECK (legacy_kind IS NULL OR legacy_kind IN ('mention', 'event', 'project_participant')),
  legacy_id       BIGINT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'unavailable')),
  status_reason   TEXT,
  status_changed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT evidence_span CHECK (span_end > span_start),
  UNIQUE (assertion_id, revision_id, span_start, span_end, stance)
);

CREATE INDEX evidence_assertion_idx ON evidence (assertion_id, status);
CREATE INDEX evidence_revision_idx ON evidence (revision_id);
CREATE INDEX evidence_legacy_idx ON evidence (legacy_kind, legacy_id) WHERE legacy_kind IS NOT NULL;

-- Фрагмент обязан дословно совпадать с неизменяемым текстом редакции;
-- доказательство не удаляется и меняет только статус.
CREATE FUNCTION evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fragment TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence: удаление запрещено, используйте отзыв' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.assertion_id, NEW.revision_id, NEW.stance, NEW.span_start, NEW.span_end, NEW.quote, NEW.context_before,
        NEW.context_after, NEW.origin, NEW.extraction_id, NEW.legacy_kind, NEW.legacy_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.assertion_id, OLD.revision_id, OLD.stance, OLD.span_start, OLD.span_end, OLD.quote, OLD.context_before,
        OLD.context_after, OLD.origin, OLD.extraction_id, OLD.legacy_kind, OLD.legacy_id, OLD.created_at) THEN
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

CREATE TRIGGER evidence_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_guard();

CREATE TABLE review_decisions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assertion_id       BIGINT NOT NULL REFERENCES assertions(id),
  decision           assertion_status NOT NULL
                     CHECK (decision IN ('reviewed_supported', 'disputed', 'rejected', 'candidate')),
  -- Что именно подтверждено: что источник так пишет, или что факт установлен.
  scope              TEXT NOT NULL DEFAULT 'reflects_source'
                     CHECK (scope IN ('reflects_source', 'fact_confirmed')),
  reviewer           TEXT NOT NULL,
  reason             TEXT,
  assertion_version  INT NOT NULL,
  -- sha256 отсортированного набора активных доказательств (id:stance) на момент решения.
  evidence_set_hash  TEXT NOT NULL,
  idempotency_key    TEXT UNIQUE,
  -- Статус известен, обоснования нет (перенос старого ручного статуса).
  provenance_gap     BOOLEAN NOT NULL DEFAULT false,
  legacy_kind        TEXT,
  legacy_id          BIGINT,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_decisions_assertion_idx ON review_decisions (assertion_id, id DESC);
CREATE UNIQUE INDEX review_decisions_legacy_uidx ON review_decisions (legacy_kind, legacy_id) WHERE legacy_kind IS NOT NULL;

CREATE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: история только дополняется, % запрещён', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER review_decisions_append_only
  BEFORE UPDATE OR DELETE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
