-- 026: реестр как происхождение утверждения и роль застройщика (этап 20B).
--
-- Только расширение допустимых значений. Существующие строки не меняются.
--
-- Почему отдельное происхождение. До сих пор утверждение приходило от модели
-- (extraction), из старых данных (legacy_import) или от человека (manual).
-- Запись реестра — ни то, ни другое, ни третье: её не выбирала модель и не
-- вводил оператор. Назвать её manual значило бы приписать человеку решение,
-- которого он не принимал; назвать extraction — приписать модели работу,
-- которой она не делала. Атрибуция на экране строится по этому полю.
--
-- Почему отдельная роль. В реестре застройщик по 214-ФЗ — не «заказчик»
-- в смысле строительного подряда. В цитате стоит «Застройщик»; роль обязана
-- совпадать с тем, что написано в источнике, иначе карточка утверждает больше,
-- чем доказательство. Схема извлечения extract@3 не меняется: модель
-- по-прежнему выбирает из восьми подрядных ролей.
--
-- Имена ограничений — автоматические имена PostgreSQL для проверок уровня
-- колонки. Если имя другое, DROP упадёт и миграция не применится молча.

ALTER TABLE assertions DROP CONSTRAINT assertions_origin_check;
ALTER TABLE assertions ADD CONSTRAINT assertions_origin_check
  CHECK (origin IN ('extraction', 'legacy_import', 'manual', 'registry'));

ALTER TABLE evidence DROP CONSTRAINT evidence_origin_check;
ALTER TABLE evidence ADD CONSTRAINT evidence_origin_check
  CHECK (origin IN ('extraction', 'legacy_import', 'manual', 'registry'));

ALTER TABLE entity_identifiers DROP CONSTRAINT entity_identifiers_origin_check;
ALTER TABLE entity_identifiers ADD CONSTRAINT entity_identifiers_origin_check
  CHECK (origin IN ('extraction', 'legacy_import', 'manual', 'registry'));

ALTER TABLE assertions DROP CONSTRAINT assertions_role_check;
ALTER TABLE assertions ADD CONSTRAINT assertions_role_check CHECK (role IS NULL OR role IN (
  'customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier', 'designer', 'investor', 'operator',
  'developer',
  'general_contract', 'subcontract', 'supply', 'design_contract', 'contract',
  'owns_share', 'controls', 'member_of_group', 'brand_of'));

-- Форма предиката пересоздаётся целиком: это одно CASE-выражение.
ALTER TABLE assertions DROP CONSTRAINT assertions_predicate_shape;
ALTER TABLE assertions ADD CONSTRAINT assertions_predicate_shape CHECK (
  CASE predicate
    WHEN 'participates_in_project' THEN role IN ('customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier',
                                                  'designer', 'investor', 'operator', 'developer')
         AND subject_project_id IS NULL
         AND (object_project_id IS NOT NULL OR (object_text IS NOT NULL AND status IN ('candidate', 'rejected')))
    WHEN 'contract' THEN role IN ('general_contract', 'subcontract', 'supply', 'design_contract', 'contract')
         AND subject_company_id IS NOT NULL AND object_company_id IS NOT NULL AND subject_company_id <> object_company_id
    WHEN 'corporate_relation' THEN role IN ('owns_share', 'controls', 'member_of_group', 'brand_of')
         AND subject_company_id IS NOT NULL AND object_company_id IS NOT NULL AND subject_company_id <> object_company_id
    WHEN 'event' THEN event_type IS NOT NULL
    WHEN 'company_mentioned' THEN subject_project_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
    WHEN 'project_mentioned' THEN subject_company_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
  END
);
