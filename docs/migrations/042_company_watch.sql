-- Портал от компании (ADR-016, этап 23A): компанию заводят по ИНН/ОГРН и ставят «на контроль».
--
-- company_watch — компании, которые оператор завёл сам или отметил: портал спрашивает о них первым
-- (Контур.Фокус, реестр застройщиков ДОМ.РФ). Снятие с контроля — отметкой removed_*, строка не
-- удаляется: видно, кто и когда снял. Активная отметка у компании одна. Таблица ссылается на компанию —
-- переносится слиянием (resolve/entityMerge.ts) и входит в dependencyState.
--
-- companies.name_pending — карточка заведена по реквизиту, а наименование ещё не пришло из ЕГРЮЛ:
-- имя временное («ИНН …»). Первый ответ Контур.Фокуса заменяет его наименованием ЕГРЮЛ и снимает признак.
-- У карточек из публикаций признак всегда false: их имя из текста ответ Фокуса не перетирает.
--
-- entity_aliases.source = 'focus' — наименование ЕГРЮЛ (краткое и полное) как написание компании:
-- по нему находит поиск и резолвер (по прежним правилам: упоминание без формы и реквизитов к юрлицу
-- не прикрепляется).

CREATE TABLE company_watch (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  BIGINT NOT NULL REFERENCES companies(id),
  added_by    TEXT NOT NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by  TEXT,
  removed_at  TIMESTAMPTZ,
  CONSTRAINT company_watch_removed CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE UNIQUE INDEX company_watch_active_uidx ON company_watch (company_id) WHERE removed_at IS NULL;

ALTER TABLE companies ADD COLUMN name_pending BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE entity_aliases DROP CONSTRAINT entity_aliases_source_check;
ALTER TABLE entity_aliases ADD CONSTRAINT entity_aliases_source_check CHECK (source IN ('llm', 'manual', 'seed', 'focus'));
