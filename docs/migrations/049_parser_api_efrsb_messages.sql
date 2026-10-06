-- Сообщения должника в ЕФРСБ из parser-api.com (06.10.2026, ADR-017 дополнение).
--
-- Набор bankruptcy раньше спрашивал карточку должника (fedresurs_api/get_org): в ней имя, адрес и форма, а о
-- банкротстве ничего. Теперь — список его сообщений (get_org_messages) и карточки «Сообщение о судебном акте»
-- (get_message): там словами ЕФРСБ, какая процедура введена, прекращена или завершена. Ответы — в том же снимке
-- набора (parser_api_records.payload), новых таблиц нет; меняется только список методов журнала.
-- kad_details — из миграции 048 (карточки арбитражных дел).

ALTER TABLE parser_api_requests DROP CONSTRAINT parser_api_requests_method;
ALTER TABLE parser_api_requests ADD CONSTRAINT parser_api_requests_method CHECK (method IN (
  'bo_search', 'bo_details', 'pb_org', 'kad_search', 'kad_details', 'fssp_ur',
  'fedresurs_ur', 'fedresurs_org', 'fedresurs_messages', 'fedresurs_message', 'key_check'));
