-- 010: допуск источников к сбору и к ИИ-обработке.
--
-- Только расширение схемы: существующие строки и статусы не меняются.
-- Колонка status (active/paused/broken) остаётся операционной — «опрашивать ли
-- по расписанию». Разрешение — отдельные поля: доступность URL и старый
-- `active` не являются основанием. Все существующие источники получают
-- 'unknown', то есть сбор и обработка по ним выключены до решения оператора.

CREATE TYPE source_permission AS ENUM ('unknown', 'approved', 'blocked', 'revoked', 'expired');

ALTER TABLE sources
  ADD COLUMN access_status        source_permission NOT NULL DEFAULT 'unknown',
  ADD COLUMN ai_processing_status source_permission NOT NULL DEFAULT 'unknown',
  -- Что именно разрешено: объём, ограничения хранения и показа.
  ADD COLUMN policy_scope         TEXT,
  -- Основание: договор, письмо владельца, условия площадки и т. п.
  ADD COLUMN policy_basis         TEXT,
  -- Ссылка на документ решения.
  ADD COLUMN policy_reference     TEXT,
  -- Кто отвечает за решение.
  ADD COLUMN policy_owner         TEXT,
  ADD COLUMN policy_decided_at    TIMESTAMPTZ,
  ADD COLUMN policy_expires_at    TIMESTAMPTZ,
  -- Синтетический источник тестов. Его разрешения не переносятся на реальные.
  ADD COLUMN is_synthetic         BOOLEAN NOT NULL DEFAULT false;

-- Разрешение без основания и ответственного недопустимо на уровне схемы,
-- а не только в API.
ALTER TABLE sources
  ADD CONSTRAINT sources_policy_basis_required CHECK (
    (access_status <> 'approved' AND ai_processing_status <> 'approved')
    OR (coalesce(btrim(policy_basis), '') <> '' AND coalesce(btrim(policy_owner), '') <> ''
        AND policy_decided_at IS NOT NULL)
  );

-- Журнал решений. Строка не удаляется вместе с источником: история допуска
-- нужна и после удаления.
CREATE TABLE source_policy_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id   BIGINT      REFERENCES sources(id) ON DELETE SET NULL,
  source_kind source_kind NOT NULL,
  source_key  TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by  TEXT        NOT NULL,
  previous    JSONB       NOT NULL,
  next        JSONB       NOT NULL,
  note        TEXT
);

CREATE INDEX source_policy_log_source_idx ON source_policy_log (source_id, changed_at DESC);
