-- 002: слой источников. Один список для Telegram-каналов, сайтов и ручного ввода.

CREATE TYPE source_kind   AS ENUM ('telegram', 'website', 'manual');
CREATE TYPE source_status AS ENUM ('active', 'paused', 'broken');
CREATE TYPE run_status    AS ENUM ('running', 'ok', 'failed');

CREATE TABLE sources (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind              source_kind   NOT NULL,
  -- tg: 'kzconstruction' (username канала без @); web: 'kn.kz'; manual: 'bot' | 'form'
  key               TEXT          NOT NULL,
  title             TEXT          NOT NULL,
  base_url          TEXT,
  -- позиция чтения: {"last_post_id": 12345} для tg, {"last_url": "..."} для сайтов
  cursor            JSONB         NOT NULL DEFAULT '{}'::jsonb,
  -- настройки парсера: селекторы, rss_url, лимиты
  config            JSONB         NOT NULL DEFAULT '{}'::jsonb,
  status            source_status NOT NULL DEFAULT 'active',
  poll_interval_sec INT           NOT NULL DEFAULT 900,
  next_run_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_ok_at        TIMESTAMPTZ,
  fail_streak       INT           NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);

-- Шедулер выбирает только активные и только просроченные — частичный индекс.
CREATE INDEX sources_due_idx ON sources (next_run_at) WHERE status = 'active';

CREATE TABLE source_runs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id    BIGINT      NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       run_status  NOT NULL DEFAULT 'running',
  items_seen   INT         NOT NULL DEFAULT 0,
  items_new    INT         NOT NULL DEFAULT 0,
  http_status  INT,
  error        TEXT,
  -- Сколько узлов нашёл каждый селектор. Единственный способ поймать смену
  -- вёрстки t.me/s/ до того, как она молча обнулит поток.
  layout_stats JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX source_runs_source_started_idx ON source_runs (source_id, started_at DESC);
