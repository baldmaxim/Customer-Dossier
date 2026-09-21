-- 025: снимки записей реестра (этап 20A).
--
-- Реестр отличается от новости: он отдаёт те же поля снова и снова, и ценность
-- в том, ЧТО ИЗМЕНИЛОСЬ между снимками (перенос срока сдачи, появление стадии
-- банкротства), а не в единичном значении.
--
-- Текст снимка живёт в document_revisions как обычная редакция (ADR-002):
-- одинаковые данные — наблюдение, изменившиеся — новая неизменяемая редакция.
-- Здесь хранится типизированная форма той же редакции, чтобы карточка не
-- разбирала текст обратно, и чтобы разницу можно было посчитать по полям.
--
-- Одна строка на редакцию (UNIQUE по revision_id): снимок без редакции —
-- значение без доказательства, две строки на редакцию — двойной счёт.
--
-- project_id и company_id заполняет этап 20B после резолва; на этапе 20A они
-- пустые. Это единственные изменяемые колонки: остальное неизменяемо, как и
-- редакция, из которой снимок построен.

CREATE TABLE registry_records (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Без каскада: удаление источника не должно уносить снимки.
  source_id       BIGINT      NOT NULL REFERENCES sources(id),
  -- Тот же ключ публикации, что у source_items: url:<канонический адрес>.
  item_key        TEXT        NOT NULL,
  record_type     TEXT        NOT NULL CHECK (record_type IN ('object', 'developer')),
  -- Идентификатор записи в реестре (objId/devId) как строка: у разных реестров он разный.
  external_ref    TEXT        NOT NULL,
  revision_id     BIGINT      NOT NULL REFERENCES document_revisions(id),
  project_id      BIGINT      REFERENCES projects(id),
  company_id      BIGINT      REFERENCES companies(id),
  -- Дата сведений по самому реестру. NULL — реестр её не сообщил; временем сбора не подменяется.
  as_of           DATE,
  fetched_at      TIMESTAMPTZ NOT NULL,
  -- Типизированные поля снимка: {"поле": {"label": ..., "value": ..., "raw": ...}}.
  payload         JSONB       NOT NULL,
  payload_hash    TEXT        NOT NULL,
  -- Версия правил рендера текста редакции: registry-render@1.
  render_version  TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX registry_records_revision_uidx ON registry_records (revision_id);
CREATE INDEX registry_records_item_idx ON registry_records (source_id, item_key, fetched_at DESC);
CREATE INDEX registry_records_project_idx ON registry_records (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX registry_records_company_idx ON registry_records (company_id) WHERE company_id IS NOT NULL;

-- Снимок неизменяем, кроме привязки к канону: она появляется позже резолвом.
CREATE FUNCTION registry_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'registry_records: удаление запрещено, снимок — доказательство' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.item_key IS DISTINCT FROM OLD.item_key
     OR NEW.record_type IS DISTINCT FROM OLD.record_type
     OR NEW.external_ref IS DISTINCT FROM OLD.external_ref
     OR NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.as_of IS DISTINCT FROM OLD.as_of
     OR NEW.fetched_at IS DISTINCT FROM OLD.fetched_at
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.render_version IS DISTINCT FROM OLD.render_version THEN
    RAISE EXCEPTION 'registry_records: изменяются только project_id и company_id' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER registry_records_content_immutable
  BEFORE UPDATE OR DELETE ON registry_records
  FOR EACH ROW EXECUTE FUNCTION registry_records_immutable();
