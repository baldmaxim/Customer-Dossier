-- Повтор упавших запусков (reprocess/worker.ts, retryFailedRuns) — каждые 30 с (07.10.2026, замер pg_stat_statements
-- на сервере: 69–358 мс за вызов). Без индекса по упавшим план перебирал все редакции (13 тыс.) и по каждой искал
-- запуск; упавших — полторы тысячи, с индексом обход начинается с них.

CREATE INDEX IF NOT EXISTS extraction_runs_failed_idx
  ON extraction_runs (finished_at) WHERE status IN ('failed', 'partial');
