-- 027: тема публикации, составленная локальной моделью (headline@1).
--
-- Зачем отдельная таблица, а не document_revisions.title: title — заголовок
-- источника (у telegram-постов его нет вовсе), а редакция неизменяема триггером
-- document_revisions_immutable. Машинная тема — не заголовок источника и не
-- доказательство: в цитаты она не идёт и основанием утверждения быть не может.
--
-- Одна строка на (редакция, версия правил, модель, версия промпта): смена промпта
-- или модели даёт новую строку, прежняя остаётся — как со строками extractions.
-- Показывается последняя по created_at.
--
-- Строки append-only: тема, которую видел оператор, не переписывается задним числом.

CREATE TABLE revision_headlines (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision_id      BIGINT      NOT NULL REFERENCES document_revisions(id),
  -- Одна строка 5–9 слов: о чём текст. Не пересказ и не вывод.
  topic            TEXT        NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  -- Версия правил темы (headline@1): что именно просили у модели.
  headline_version TEXT        NOT NULL,
  model            TEXT        NOT NULL,
  prompt_version   TEXT        NOT NULL,
  schema_version   TEXT        NOT NULL,
  -- Сколько символов редакции видела модель и был ли текст обрезан: тема описывает
  -- только показанную часть, и это видно, а не подразумевается.
  input_chars      INT         NOT NULL CHECK (input_chars >= 0),
  truncated        BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (revision_id, headline_version, model, prompt_version)
);

CREATE INDEX revision_headlines_revision_idx ON revision_headlines (revision_id, created_at DESC);

CREATE TRIGGER revision_headlines_append_only
  BEFORE UPDATE OR DELETE ON revision_headlines
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
