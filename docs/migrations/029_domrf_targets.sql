-- Адреса карточек ДОМ.РФ, добавленные оператором для чтения в браузере.
-- Очередь не вызывает сетевой сбор: завершает её импорт видимого снимка.
CREATE TABLE domrf_targets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  project_id BIGINT REFERENCES projects(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at TIMESTAMPTZ,
  last_revision_id BIGINT REFERENCES document_revisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX domrf_targets_pending_idx ON domrf_targets (requested_at, id)
  WHERE captured_at IS NULL OR captured_at < requested_at;

-- Ранее полученные браузерные снимки видны в новом списке сразу.
INSERT INTO domrf_targets (external_ref, url, project_id, requested_at, captured_at, last_revision_id)
SELECT DISTINCT ON (r.external_ref)
  r.external_ref, 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/' || r.external_ref,
  r.project_id, r.fetched_at, r.fetched_at, r.revision_id
FROM registry_records r
WHERE r.payload->>'captureMethod' = 'browser_page'
ORDER BY r.external_ref, r.fetched_at DESC, r.id DESC
ON CONFLICT (external_ref) DO NOTHING;
