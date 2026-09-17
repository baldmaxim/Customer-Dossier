-- 022: идентичность запроса снимка (этап 13).
--
-- Additive. Ключ идемпотентности снимка связан с нормализованным намерением запроса (обращение, период, срез):
-- повтор того же намерения возвращает тот же снимок, другое намерение с тем же ключом отвергается.
-- Старые снимки получают NULL: их намерение сверяется по сохранённым case_id/effective_from/effective_to,
-- payload и payload_hash не меняются.

ALTER TABLE dossier_snapshots ADD COLUMN request_hash TEXT;

COMMENT ON COLUMN dossier_snapshots.request_hash IS
  'sha256 канонического описания запроса (snapshot-request@1). NULL — снимок до этапа 13.';

-- Неизменяемость метаданных распространяется и на request_hash.
CREATE OR REPLACE FUNCTION dossier_snapshots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'dossier_snapshots: удаление снимка запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.case_id, NEW.case_version, NEW.schema_version, NEW.rules_version, NEW.template_version, NEW.generated_at,
      NEW.knowledge_cutoff, NEW.effective_from, NEW.effective_to, NEW.hash_algorithm, NEW.created_by, NEW.idempotency_key,
      NEW.request_hash)
     IS DISTINCT FROM
     (OLD.case_id, OLD.case_version, OLD.schema_version, OLD.rules_version, OLD.template_version, OLD.generated_at,
      OLD.knowledge_cutoff, OLD.effective_from, OLD.effective_to, OLD.hash_algorithm, OLD.created_by, OLD.idempotency_key,
      OLD.request_hash) THEN
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
