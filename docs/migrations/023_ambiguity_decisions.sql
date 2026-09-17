-- 023: решения аналитика по неоднозначным упоминаниям (этап 15A).
--
-- Additive. Решение относится к одному упоминанию: (вид, ключ имени, редакция). Это не слияние сущностей и не
-- подтверждение утверждения: оно лишь говорит резолверу, какой из кандидатов имеется в виду в этой редакции.
-- Журнал неизменяем; действующее решение — последнее по id. Старые строки resolution_ambiguities получают version = 1.

ALTER TABLE resolution_ambiguities ADD COLUMN version INT NOT NULL DEFAULT 1;

CREATE TABLE ambiguity_decisions (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiguity_id      BIGINT NOT NULL REFERENCES resolution_ambiguities(id),
  decision          TEXT NOT NULL CHECK (decision IN ('resolved_to', 'kept_unknown', 'dismissed')),
  entity_id         BIGINT,
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  actor             TEXT NOT NULL,
  ambiguity_version INT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  request_hash      TEXT NOT NULL,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((decision = 'resolved_to') = (entity_id IS NOT NULL))
);

CREATE INDEX ambiguity_decisions_ambiguity_idx ON ambiguity_decisions (ambiguity_id, id DESC);
CREATE INDEX ambiguity_decisions_entity_idx ON ambiguity_decisions (entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX resolution_ambiguities_status_idx ON resolution_ambiguities (status, entity_kind, updated_at DESC, id DESC);

CREATE TRIGGER ambiguity_decisions_append_only BEFORE UPDATE OR DELETE ON ambiguity_decisions
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

COMMENT ON TABLE ambiguity_decisions IS
  'Решение по одному неоднозначному упоминанию (этап 15A). Не слияние и не проверка утверждения; append-only.';
