-- 020: снимки досье (DossierSnapshot) — зафиксированное содержание обращения (этап 08B, ADR-011).
--
-- Снимок хранит готовые формулировки, цитаты с точными редакциями, решения аналитика, подписи сущностей и
-- схему связей на момент создания; ссылок на изменяемые имена и активные решения недостаточно. Новая
-- публикация, слияние, переименование или пересчёт не меняют payload: он неизменяем, целостность — hash
-- канонической сериализации (не подпись и не истинность фактов).
--
-- Доступность — отдельно от содержания: при выдаче проверяется текущий допуск источников (цитаты отозванного
-- источника скрываются), и учитывается журнал вымарываний. Обязательное удаление фрагмента — только процедурой
-- вымарывания: текст заменяется tombstone, старый и новый hash записываются в журнал.

CREATE TABLE dossier_snapshots (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id            BIGINT NOT NULL REFERENCES dossier_cases(id),
  case_version       INT NOT NULL,
  schema_version     TEXT NOT NULL,
  rules_version      TEXT NOT NULL,
  template_version   TEXT NOT NULL,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Что система знала: данные, записанные до этого момента. Исторический срез прошлого не создаётся.
  knowledge_cutoff   TIMESTAMPTZ NOT NULL,
  -- К каким событиям и ролям относится досье (фильтр по датам события), не дата существования документа.
  effective_from     DATE,
  effective_to       DATE,
  payload            JSONB NOT NULL,
  payload_hash       TEXT NOT NULL,
  hash_algorithm     TEXT NOT NULL DEFAULT 'sha256-canonical-json@1',
  created_by         TEXT NOT NULL,
  idempotency_key    TEXT UNIQUE,
  CONSTRAINT dossier_snapshots_effective CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CONSTRAINT dossier_snapshots_cutoff CHECK (knowledge_cutoff <= generated_at + interval '1 second')
);

CREATE INDEX dossier_snapshots_case_idx ON dossier_snapshots (case_id, id DESC);

CREATE TABLE dossier_snapshot_redactions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id   BIGINT NOT NULL REFERENCES dossier_snapshots(id),
  evidence_id   BIGINT NOT NULL,
  reason        TEXT NOT NULL CHECK (length(reason) >= 3),
  actor         TEXT NOT NULL,
  hash_before   TEXT NOT NULL,
  hash_after    TEXT NOT NULL,
  redacted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, evidence_id)
);

CREATE TRIGGER dossier_snapshot_redactions_append_only
  BEFORE UPDATE OR DELETE ON dossier_snapshot_redactions
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Снимок не удаляется и не меняется. Единственное исключение — payload и hash внутри процедуры вымарывания,
-- которая выставляет локальный флаг транзакции и пишет строку журнала.
CREATE FUNCTION dossier_snapshots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dossier_snapshots: удаление снимка запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.case_id, NEW.case_version, NEW.schema_version, NEW.rules_version, NEW.template_version, NEW.generated_at,
      NEW.knowledge_cutoff, NEW.effective_from, NEW.effective_to, NEW.hash_algorithm, NEW.created_by, NEW.idempotency_key)
     IS DISTINCT FROM
     (OLD.case_id, OLD.case_version, OLD.schema_version, OLD.rules_version, OLD.template_version, OLD.generated_at,
      OLD.knowledge_cutoff, OLD.effective_from, OLD.effective_to, OLD.hash_algorithm, OLD.created_by, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'dossier_snapshots: метаданные снимка неизменяемы' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.payload, NEW.payload_hash) IS DISTINCT FROM (OLD.payload, OLD.payload_hash)
     AND coalesce(current_setting('tg_info.snapshot_redaction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'dossier_snapshots: содержание снимка неизменяемо (изменение — только процедурой вымарывания)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dossier_snapshots_guard_trigger
  BEFORE UPDATE OR DELETE ON dossier_snapshots
  FOR EACH ROW EXECUTE FUNCTION dossier_snapshots_guard();
