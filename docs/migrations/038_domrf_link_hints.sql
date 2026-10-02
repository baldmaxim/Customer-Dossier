-- Подсказка модели к совпадению компании с реестром застройщиков ДОМ.РФ (этап 20D, шаг 3).
--
-- Поиск по названию даёт несколько застройщиков и групп; инженер решает «это он / не он». Модель
-- подсказывает — «скорее он», «скорее не он» или «не уверена» с объяснением, — но не решает: состояние
-- совпадения меняет только оператор, в канон подсказка не попадает. Подсказка живёт на строке
-- совпадения и переезжает вместе с ней при слиянии компаний; новая версия промпта или другая модель —
-- подсказка составляется заново поверх прежней.
--
-- details — что ещё выдача поиска показала рядом с названием (реквизиты, регион): видно инженеру и модели.

ALTER TABLE domrf_company_links
  ADD COLUMN details             TEXT,
  ADD COLUMN hint_verdict        TEXT,
  ADD COLUMN hint_reason         TEXT,
  -- Ответ модели не разобран: подсказки нет, причина здесь; при той же модели и версии промпта не повторяется.
  ADD COLUMN hint_error          TEXT,
  ADD COLUMN hint_model          TEXT,
  ADD COLUMN hint_prompt_version TEXT,
  ADD COLUMN hinted_at           TIMESTAMPTZ,
  ADD CONSTRAINT domrf_company_links_hint_verdict CHECK (hint_verdict IS NULL OR hint_verdict IN ('match', 'no_match', 'unsure'));
