-- 015: адаптеры сайтов — здоровье источника, счётчики и покрытие запусков,
-- условные запросы, точность дат публикации, версия парсера у наблюдения.
--
-- Только расширение: существующие строки не меняются.

-- Состояние источника с причиной. unknown — ещё не запускался новым адаптером.
ALTER TABLE sources ADD COLUMN health TEXT NOT NULL DEFAULT 'unknown'
  CHECK (health IN ('unknown', 'ok', 'parser_degraded', 'rate_limited', 'blocked', 'error', 'config_invalid'));
ALTER TABLE sources ADD COLUMN health_reason TEXT;
ALTER TABLE sources ADD COLUMN last_attempt_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN parser_version TEXT;

-- Итог запуска словами и числами: найдено/сохранено/изменено/пропущено/ошибок, страницы,
-- покрытие (почему остановились), когда можно повторить после 429.
ALTER TABLE source_runs ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR outcome IN ('ok', 'not_modified', 'partial', 'parser_degraded', 'rate_limited',
                                         'blocked', 'http_error', 'network', 'oversize', 'config_invalid', 'error'));
ALTER TABLE source_runs ADD COLUMN items_found INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN items_saved INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN items_changed INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN items_skipped INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN items_failed INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN pages_fetched INT NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN coverage JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE source_runs ADD COLUMN parser_version TEXT;
ALTER TABLE source_runs ADD COLUMN retry_after_at TIMESTAMPTZ;
ALTER TABLE source_runs ADD COLUMN duration_ms INT;

-- Условные запросы: ETag/Last-Modified последнего успешного ответа по адресу источника.
-- 304 — наблюдение без новой редакции.
CREATE TABLE http_cache (
  source_id      BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  etag           TEXT,
  last_modified  TEXT,
  last_status    INT NOT NULL,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, url)
);

-- Точность даты публикации: exact (со временем и зоной), local_tz (зона из профиля источника),
-- date_only, no_year/relative/unparsed (дата не выставлена, сырой текст сохранён).
ALTER TABLE document_revisions ADD COLUMN published_at_precision TEXT
  CHECK (published_at_precision IS NULL OR published_at_precision IN
         ('exact', 'local_tz', 'date_only', 'no_year', 'relative', 'unparsed'));
ALTER TABLE document_revisions ADD COLUMN published_at_raw TEXT;

-- Смена вёрстки при том же тексте — не новая редакция, а наблюдение с другой версией парсера.
ALTER TABLE source_observations ADD COLUMN parser_version TEXT;
