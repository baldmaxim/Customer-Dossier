-- Метка тестовой цели. Guard интеграционных тестов (backend/src/db/testTarget.ts)
-- проверяет её после подключения и без неё не выполняет ни одного запроса.
COMMENT ON DATABASE tg_info_test IS 'tg_info:test-target';
