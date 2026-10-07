// Реквизит компании — одно правило для всего портала (07.10.2026, «одно сведение — один источник»).
//
// Только реквизиты с верной контрольной суммой из реестра entity_identifiers (ADR-005). ИНН главнее ОГРН/ОГРНИП; два
// разных ИНН (или ни одного ИНН и два ОГРН) — вопрос опознания, реквизита нет. Это правило Контур.Фокуса
// (focus/targets.ts::pickTarget); раньше сайты компаний и очередь ДОМ.РФ брали «первый ИНН по id», а каталог — min(ИНН),
// и у карточки с двумя ИНН каталог показывал наименование ЕГРЮЛ, которого карточка не спрашивала.

/** Реквизит компании `companyIdExpr` по правилу pickTarget — значением (ИНН, иначе ОГРН/ОГРНИП) или NULL. */
export const companyTaxIdSql = (companyIdExpr: string): string => `(
  SELECT CASE
           WHEN count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type = 'inn') = 1
             THEN min(ei.value) FILTER (WHERE ei.identifier_type = 'inn')
           WHEN count(*) FILTER (WHERE ei.identifier_type = 'inn') = 0
            AND count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) = 1
             THEN min(ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip'))
         END
  FROM entity_identifiers ei
  WHERE ei.company_id = ${companyIdExpr} AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
    AND ei.identifier_type IN ('inn', 'ogrn', 'ogrnip'))`;

/**
 * Реквизиты всех живых компаний для списков и очередей: ИНН — если он один, ОГРН — если он один; несколько разных — NULL;
 * target — по чему спрашивать ЕГРЮЛ (правило pickTarget: ИНН, а без ИНН вовсе — ОГРН). CTE
 * `ids (company_id, inn, ogrn, target_type, target_value)`.
 */
export const IDS_CTE = `
  ids AS MATERIALIZED (
    SELECT ei.company_id,
           CASE WHEN count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type = 'inn') = 1
                THEN min(ei.value) FILTER (WHERE ei.identifier_type = 'inn') END AS inn,
           CASE WHEN count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) = 1
                THEN min(ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) END AS ogrn,
           CASE WHEN count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type = 'inn') = 1 THEN 'inn'
                WHEN count(*) FILTER (WHERE ei.identifier_type = 'inn') = 0
                 AND count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) = 1 THEN 'ogrn' END AS target_type,
           CASE WHEN count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type = 'inn') = 1
                  THEN min(ei.value) FILTER (WHERE ei.identifier_type = 'inn')
                WHEN count(*) FILTER (WHERE ei.identifier_type = 'inn') = 0
                 AND count(DISTINCT ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) = 1
                  THEN min(ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) END AS target_value
    FROM entity_identifiers ei
    JOIN companies c ON c.id = ei.company_id AND c.merged_into_id IS NULL
    WHERE ei.status = 'active' AND ei.validation_status = 'checksum_valid' AND ei.identifier_type IN ('inn', 'ogrn', 'ogrnip')
    GROUP BY ei.company_id
  )`;
