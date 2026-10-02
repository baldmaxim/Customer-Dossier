-- Разбор разногласий моделью (02.10.2026, решение владельца; ADR-005, ADR-012 п. 33).
--
-- Пара «возможный дубль» получает вердикт модели: same — одна сущность, different — разные, unsure — не
-- уверена. Вердикт и причина хранятся рядом с парой и видны в «Проверка → Дубли»; применение (слияние
-- или отклонение) — отдельным флагом MODEL_REVIEW_APPLY, и тогда decided_by = 'model:<модель>', а
-- decision_note — причина. Модель и версия промпта — на строке: смена модели или промпта даёт новый вердикт.
-- Ответ не по схеме — model_error, при той же конфигурации не повторяется.

ALTER TABLE merge_queue
  ADD COLUMN model_verdict        TEXT,
  ADD COLUMN model_reason         TEXT,
  ADD COLUMN model_error          TEXT,
  ADD COLUMN model_name           TEXT,
  ADD COLUMN model_prompt_version TEXT,
  ADD COLUMN judged_at            TIMESTAMPTZ,
  ADD COLUMN decision_note        TEXT,
  ADD CONSTRAINT merge_queue_model_verdict CHECK (model_verdict IS NULL OR model_verdict IN ('same', 'different', 'unsure'));
