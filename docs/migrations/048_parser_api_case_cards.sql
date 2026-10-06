-- Карточки арбитражных дел из parser-api.com: сумма иска (06.10.2026, ADR-017 дополнение).
--
-- В поиске картотеки сумм исков нет — они только в карточке дела (arbitr_api/details_by_id,
-- InstanceEvents[].ClaimSum). Каждая карточка — платный запрос, поэтому спрашиваем только экономические
-- споры (CaseType Г), где компания — ответчик, и только один раз: строка на дело, повторно не запрашивается.
-- Сумма — на дату получения карточки: уточнение иска позже портал не увидит, экран так и подписывает.
-- Дело общее для сторон: карточку, полученную для одной компании, видит и другая. Ссылок на компании нет —
-- слияние таблицу не трогает. В канон не идёт: сумма иска — требование истца, а не долг.

CREATE TABLE parser_api_case_cards (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- CaseId картотеки, строчными буквами.
  case_id       TEXT NOT NULL,
  -- Ответ details_by_id как есть (без ключа); сумма из него — картой на чтении (parserApi/map/caseCard.ts).
  payload       JSONB NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by  TEXT NOT NULL,
  CONSTRAINT parser_api_case_cards_case_id CHECK (case_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT parser_api_case_cards_unique UNIQUE (case_id)
);

ALTER TABLE parser_api_requests DROP CONSTRAINT parser_api_requests_method;
ALTER TABLE parser_api_requests ADD CONSTRAINT parser_api_requests_method CHECK (method IN (
  'bo_search', 'bo_details', 'pb_org', 'kad_search', 'kad_details', 'fssp_ur', 'fedresurs_ur', 'fedresurs_org', 'key_check'));
