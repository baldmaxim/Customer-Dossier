-- Чтение подтверждённого сайта компании (этап 25B, ADR-018).
--
-- «Это сайт компании» делает сайт источником (sources.kind = 'website', ключ 'site:<хост>', профиль
-- mode = 'company_site'): портал читает главную и страницы проектов, модель site-projects@1 выписывает ЖК с
-- дословной цитатой. Это сведения самой компании на дату — в канон не идут, как снимки ДОМ.РФ (ADR-012).
--
--  company_site_candidates.source_id — источник, которым читается подтверждённый сайт;
--  company_site_pages       — текст страницы на дату: новая строка только при смене текста, строки не правятся;
--  company_site_extractions — ответ модели по странице: проекты, прошедшие проверку цитаты; одна строка на
--                             (страница, модель, промпт), строки не правятся.
--
-- Тексты страниц — не document_revisions: разбор публикаций extract@3 их не берёт.

ALTER TABLE company_site_candidates
  ADD COLUMN source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL;

CREATE INDEX company_site_candidates_source ON company_site_candidates (source_id) WHERE source_id IS NOT NULL;

CREATE TABLE company_site_pages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id       BIGINT NOT NULL REFERENCES sources(id),
  url             TEXT NOT NULL,
  title           TEXT,
  text            TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  parser_version  TEXT NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_site_pages_url CHECK (url ~ '^https?://'),
  CONSTRAINT company_site_pages_text_len CHECK (char_length(text) <= 60000)
);

CREATE INDEX company_site_pages_latest ON company_site_pages (source_id, url, fetched_at DESC, id DESC);

CREATE TRIGGER company_site_pages_append_only
  BEFORE UPDATE OR DELETE ON company_site_pages
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

CREATE TABLE company_site_extractions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  page_id         BIGINT NOT NULL REFERENCES company_site_pages(id),
  model           TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  schema_version  TEXT NOT NULL,
  -- ok — ответ принят (проекты могут быть пустыми: на странице их нет); invalid_answer — ответ не по схеме,
  -- страница этой моделью и промптом больше не разбирается. Сбой связи строки не оставляет — повтор следующим проходом.
  outcome         TEXT NOT NULL,
  projects        JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejected_count  INTEGER NOT NULL DEFAULT 0,
  input_chars     INTEGER NOT NULL,
  truncated       BOOLEAN NOT NULL DEFAULT false,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_site_extractions_outcome CHECK (outcome IN ('ok', 'invalid_answer')),
  CONSTRAINT company_site_extractions_projects CHECK (jsonb_typeof(projects) = 'array'),
  CONSTRAINT company_site_extractions_unique UNIQUE (page_id, model, prompt_version)
);

CREATE TRIGGER company_site_extractions_append_only
  BEFORE UPDATE OR DELETE ON company_site_extractions
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
