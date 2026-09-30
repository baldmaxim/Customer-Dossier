-- Повторные попытки браузерного сбора и видимая оператору причина сбоя.
ALTER TABLE domrf_targets
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at TIMESTAMPTZ,
  ADD COLUMN next_attempt_at TIMESTAMPTZ,
  ADD COLUMN last_error TEXT;

CREATE INDEX domrf_targets_worker_idx ON domrf_targets (next_attempt_at, requested_at, id)
  WHERE captured_at IS NULL OR captured_at < requested_at;
