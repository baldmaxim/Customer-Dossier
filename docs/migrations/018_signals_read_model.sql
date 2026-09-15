-- 018: объяснимые сигналы компании (этап 07, ADR-009).
--
-- Read-model — таблицы снимков, а не формула поверх канона: пересчёт на явный срез (cutoff) с версией
-- правил, запись нового снимка и переключение одной транзакцией. Ошибка пересчёта оставляет последний
-- успешный снимок и помечается в журнале — пустых данных вместо сигналов не бывает.
--
-- 007 (company_metrics / company_risk) не переписывается и новой карточкой и сортировкой не читается;
-- доступен только устаревшему эндпоинту с пометкой deprecated.

CREATE TABLE signal_refreshes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rules_version  TEXT NOT NULL,
  cutoff_at      TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  companies      INT,
  error          TEXT,
  requested_by   TEXT NOT NULL DEFAULT 'system',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE INDEX signal_refreshes_status_idx ON signal_refreshes (status, finished_at DESC);

CREATE TABLE company_signal_snapshots (
  refresh_id        BIGINT NOT NULL REFERENCES signal_refreshes(id),
  company_id        BIGINT NOT NULL REFERENCES companies(id),
  payload           JSONB NOT NULL,
  -- Столбцы для списка подрядчиков: те же числа, что в payload, без вычислений поверх.
  identity_status   TEXT NOT NULL,
  projects          INT,
  events_dated_12m  INT NOT NULL,
  events_undated    INT NOT NULL,
  publications      INT,
  families          INT,
  roles             TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (refresh_id, company_id)
);

CREATE INDEX company_signal_snapshots_company_idx ON company_signal_snapshots (company_id, refresh_id DESC);

-- Активный снимок — последний успешный пересчёт.
CREATE VIEW signal_active_refresh_v AS
SELECT * FROM signal_refreshes
WHERE status = 'succeeded'
ORDER BY finished_at DESC, id DESC
LIMIT 1;
