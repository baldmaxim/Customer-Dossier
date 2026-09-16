-- 021: неизменная конфигурация запуска (этап 11).
--
-- Additive. Запуск, поставленный одной конфигурацией модели, не выполняется другой: новая конфигурация — новый
-- запуск со ссылкой на прежний. Прежние запуски не переписываются: их fingerprint_json остаётся как был
-- (execution-identity до этапа 11 читается как historical — без modelIdentityHash и без сведений о сервере).

ALTER TABLE extraction_runs
  ADD COLUMN previous_run_id BIGINT REFERENCES extraction_runs(id);

COMMENT ON COLUMN extraction_runs.previous_run_id IS
  'Запуск, вместо которого поставлен этот (повтор failed/partial/cancelled или смена конфигурации). Прежний не меняется.';

CREATE INDEX extraction_runs_previous_idx ON extraction_runs (previous_run_id) WHERE previous_run_id IS NOT NULL;

-- Отбор очереди по конфигурации исполнителя: worker захватывает только запуски своей модели.
CREATE INDEX extraction_runs_model_identity_idx
  ON extraction_runs ((fingerprint_json->>'modelIdentityHash'), status, created_at)
  WHERE status IN ('queued', 'running');
