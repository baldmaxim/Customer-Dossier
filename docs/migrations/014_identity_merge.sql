-- 014: юрлица, бренды и группы; типизированные реквизиты; иерархия объектов;
-- очередь неоднозначных совпадений; журнал слияний с отменой.
--
-- companies остаётся единственной канонической таблицей компаний (без второй
-- конкурирующей базы): тип сущности — колонка, реквизиты — отдельный реестр,
-- companies.tax_id — совместимая проекция основного реквизита для старого чтения.

-- Тип сущности. Для существующих строк неизвестен: из текста без реквизитов
-- нельзя сказать, юрлицо это или бренд.
ALTER TABLE companies ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (entity_type IN ('legal_entity', 'brand', 'group', 'unknown'));
-- Версия для оптимистичной блокировки слияний и ручных правок.
ALTER TABLE companies ADD COLUMN version INT NOT NULL DEFAULT 1;
-- Какой версией нормализатора посчитаны name_norm/name_latin. NULL — до версионирования.
ALTER TABLE companies ADD COLUMN normalizer_version TEXT;

ALTER TABLE projects ADD COLUMN version INT NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN normalizer_version TEXT;
-- Иерархия: комплекс → очередь → корпус. Корпус одного ЖК — отдельная запись со ссылкой на родителя.
ALTER TABLE projects ADD COLUMN project_level TEXT NOT NULL DEFAULT 'complex'
  CHECK (project_level IN ('complex', 'phase', 'building'));
ALTER TABLE projects ADD COLUMN parent_project_id BIGINT REFERENCES projects(id);
-- Номер/обозначение очереди или корпуса ровно в нормализованном виде («3», «2а»).
ALTER TABLE projects ADD COLUMN level_label TEXT;
-- Откуда город и адрес: из текста публикации, от оператора; NULL — legacy, происхождение не сохранилось.
ALTER TABLE projects ADD COLUMN geo_source TEXT CHECK (geo_source IS NULL OR geo_source IN ('text', 'manual'));
ALTER TABLE projects ADD COLUMN geo_revision_id BIGINT REFERENCES document_revisions(id);
ALTER TABLE projects ADD CONSTRAINT projects_hierarchy CHECK (
  (project_level = 'complex' AND parent_project_id IS NULL AND level_label IS NULL)
  OR (project_level <> 'complex' AND parent_project_id IS NOT NULL AND level_label IS NOT NULL)
);
ALTER TABLE projects ADD CONSTRAINT projects_not_own_parent CHECK (parent_project_id IS NULL OR parent_project_id <> id);
CREATE UNIQUE INDEX projects_child_uidx ON projects (parent_project_id, project_level, level_label)
  WHERE parent_project_id IS NOT NULL AND merged_into_id IS NULL;

-- Реквизиты по типу и юрисдикции. Формат/контрольная сумма (validation_status) отдельно
-- от принадлежности субъекту (evidence/редакция, из собственной цитаты сущности).
CREATE TABLE entity_identifiers (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id         BIGINT NOT NULL REFERENCES companies(id),
  jurisdiction       TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}$'),
  identifier_type    TEXT NOT NULL CHECK (identifier_type IN ('inn', 'ogrn', 'ogrnip', 'kpp', 'bin', 'other')),
  -- Строка, не число: ведущие нули значимы.
  value              TEXT NOT NULL CHECK (value ~ '^[0-9A-Za-z]+$'),
  validation_status  TEXT NOT NULL CHECK (validation_status IN ('checksum_valid', 'format_only', 'unchecked')),
  origin             TEXT NOT NULL CHECK (origin IN ('extraction', 'legacy_import', 'manual')),
  evidence_id        BIGINT REFERENCES evidence(id),
  source_revision_id BIGINT REFERENCES document_revisions(id),
  valid_from         DATE,
  valid_to           DATE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_by         TEXT NOT NULL DEFAULT 'system',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entity_identifiers_period CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

-- Один активный реквизит — у одной сущности; слияние проверяет коллизию до записи.
CREATE UNIQUE INDEX entity_identifiers_active_uidx ON entity_identifiers (jurisdiction, identifier_type, value)
  WHERE status = 'active';
CREATE INDEX entity_identifiers_company_idx ON entity_identifiers (company_id) WHERE status = 'active';

-- Явные связи между компаниями: бренд юрлица, участник группы, правопреемник.
-- Общий телефон/домен/адрес/руководитель — не связь, а повод для ручной проверки.
CREATE TABLE company_relations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_company_id  BIGINT NOT NULL REFERENCES companies(id),
  to_company_id    BIGINT NOT NULL REFERENCES companies(id),
  relation_type    TEXT NOT NULL CHECK (relation_type IN ('brand_of', 'member_of_group', 'successor_of')),
  status           TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'confirmed', 'rejected')),
  evidence_id      BIGINT REFERENCES evidence(id),
  note             TEXT,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       TEXT,
  decided_at       TIMESTAMPTZ,
  CONSTRAINT company_relations_not_self CHECK (from_company_id <> to_company_id),
  UNIQUE (from_company_id, to_company_id, relation_type)
);

-- Неоднозначное точное совпадение: несколько кандидатов без реквизитов. Сущность не
-- создаётся и первая строка не выбирается; якорь — редакция публикации.
CREATE TABLE resolution_ambiguities (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind     entity_kind NOT NULL,
  surface         TEXT NOT NULL,
  name_key        TEXT NOT NULL,
  candidate_ids   BIGINT[] NOT NULL,
  revision_id     BIGINT REFERENCES document_revisions(id),
  occurrences     INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_entity_id BIGINT,
  decided_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX resolution_ambiguities_anchor_uidx
  ON resolution_ambiguities (entity_kind, name_key, coalesce(revision_id, 0));
CREATE INDEX resolution_ambiguities_open_idx ON resolution_ambiguities (created_at DESC) WHERE status = 'open';

-- Журнал слияний. Исходная сущность не удаляется: tombstone merged_into_id + запись здесь.
CREATE TABLE entity_merges (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_kind            entity_kind NOT NULL,
  source_id              BIGINT NOT NULL,
  target_id              BIGINT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'undone')),
  idempotency_key        TEXT NOT NULL UNIQUE,
  request_hash           TEXT NOT NULL,
  queue_id               BIGINT REFERENCES merge_queue(id),
  actor                  TEXT NOT NULL,
  reason                 TEXT,
  source_version_before  INT NOT NULL,
  target_version_before  INT NOT NULL,
  target_version_after   INT NOT NULL,
  -- Названия, реквизиты и алиасы обеих сторон на момент слияния: исторические подписи
  -- восстановимы для будущих снимков.
  source_snapshot        JSONB NOT NULL,
  target_snapshot        JSONB NOT NULL,
  counts                 JSONB NOT NULL,
  -- Зависимости обеих сторон сразу после слияния — основание для безопасной отмены.
  after_state            JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at              TIMESTAMPTZ,
  undone_by              TEXT,
  undo_idempotency_key   TEXT UNIQUE,
  CONSTRAINT entity_merges_not_self CHECK (source_id <> target_id)
);

CREATE INDEX entity_merges_source_idx ON entity_merges (entity_kind, source_id);
CREATE INDEX entity_merges_target_idx ON entity_merges (entity_kind, target_id);

-- Журнал меняется один раз: applied → undone, содержание неизменяемо, удаление запрещено.
CREATE FUNCTION entity_merges_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'entity_merges: удаление запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'applied' OR NEW.status <> 'undone'
     OR (NEW.entity_kind, NEW.source_id, NEW.target_id, NEW.idempotency_key, NEW.request_hash, NEW.queue_id, NEW.actor,
         NEW.reason, NEW.source_version_before, NEW.target_version_before, NEW.target_version_after,
         NEW.source_snapshot, NEW.target_snapshot, NEW.counts, NEW.after_state, NEW.created_at)
        IS DISTINCT FROM
        (OLD.entity_kind, OLD.source_id, OLD.target_id, OLD.idempotency_key, OLD.request_hash, OLD.queue_id, OLD.actor,
         OLD.reason, OLD.source_version_before, OLD.target_version_before, OLD.target_version_after,
         OLD.source_snapshot, OLD.target_snapshot, OLD.counts, OLD.after_state, OLD.created_at) THEN
    RAISE EXCEPTION 'entity_merges: журнал неизменяем, допустима только отмена' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entity_merges_guard BEFORE UPDATE OR DELETE ON entity_merges
  FOR EACH ROW EXECUTE FUNCTION entity_merges_guard();

-- Каждое изменение слияния: таблица, строка, колонка, было/стало, образ удалённой строки.
-- По нему выполняется отмена в обратном порядке.
CREATE TABLE entity_merge_moves (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  merge_id     BIGINT NOT NULL REFERENCES entity_merges(id),
  seq          INT NOT NULL,
  table_name   TEXT NOT NULL,
  row_id       BIGINT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('update', 'delete', 'insert', 'supersede')),
  column_name  TEXT,
  old_value    TEXT,
  new_value    TEXT,
  before_image JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merge_id, seq)
);

CREATE TRIGGER entity_merge_moves_append_only BEFORE UPDATE OR DELETE ON entity_merge_moves
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Доказательство, скопированное слиянием на утверждение о живой сущности, знает оригинал.
ALTER TABLE evidence ADD COLUMN copied_from_evidence_id BIGINT REFERENCES evidence(id);
-- Отложенная проверка: id слияния резервируется в начале транзакции, запись журнала — в конце.
ALTER TABLE evidence ADD COLUMN merge_id BIGINT REFERENCES entity_merges(id) DEFERRABLE INITIALLY DEFERRED;

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
        NEW.extraction_chunk_id, NEW.copied_from_evidence_id, NEW.merge_id)
       IS DISTINCT FROM
       (OLD.assertion_id, OLD.revision_id, OLD.stance, OLD.span_start, OLD.span_end, OLD.quote, OLD.context_before,
        OLD.context_after, OLD.origin, OLD.extraction_id, OLD.legacy_kind, OLD.legacy_id, OLD.created_at,
        OLD.extraction_chunk_id, OLD.copied_from_evidence_id, OLD.merge_id) THEN
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
