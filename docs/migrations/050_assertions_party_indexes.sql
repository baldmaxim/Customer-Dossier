-- Индексы assertions под карточку компании, каталог, сигналы и схему связей (07.10.2026).
--
-- После 047 условие по компании и объекту доходит до таблицы assertions, но индекс был только у
-- subject_company_id и object_project_id (012). Условия `object_company_id = $1`, `counterparty_company_id = $1`,
-- `subject_project_id = $1` и их OR с subject_company_id (контрагенты, публикации компании и объекта, досье,
-- сигналы, схема, поиск) читали всю таблицу (~45 тыс. строк на 06.10.2026) на каждый запрос, а карточка
-- компании делает таких запросов десятки. BitmapOr по OR возможен, только если индекс есть у каждой ветки.
--
-- События объекта (project_current_state_v, project_state_history_v, card_events_v) отбираются по
-- coalesce(object_project_id, subject_project_id) среди predicate = 'event' — индекс по тому же выражению.
--
-- Обычный CREATE INDEX, не CONCURRENTLY: раннер применяет миграцию в транзакции; запись в assertions
-- ждёт секунды построения. ANALYZE — чтобы статистика по выражению была сразу, а не после автоочистки.

CREATE INDEX IF NOT EXISTS assertions_object_company_idx
  ON assertions (object_company_id) WHERE object_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assertions_counterparty_company_idx
  ON assertions (counterparty_company_id) WHERE counterparty_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assertions_subject_project_idx
  ON assertions (subject_project_id) WHERE subject_project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assertions_event_project_idx
  ON assertions ((coalesce(object_project_id, subject_project_id))) WHERE predicate = 'event';

ANALYZE assertions;
