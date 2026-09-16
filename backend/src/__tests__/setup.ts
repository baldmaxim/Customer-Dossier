// Окружение unit-тестов. Присваивание, а не `??=`: уже экспортированный в
// оболочке DATABASE_URL (рабочая база!) не должен пережить запуск тестов.
//
// Строка подключения заведомо нерабочая: если unit-тест случайно полезет в БД,
// он упадёт с ошибкой соединения, а не запишет что-то в реальную базу.
// Интеграционные тесты идут отдельным профилем (vitest.integration.config.ts)
// со своим guard'ом тестовой цели.

export const DEAD_DATABASE_URL = 'postgresql://unit:unit@127.0.0.1:1/unit_tests_no_db';

// dotenv/config читает путь из этой переменной: несуществующий файл = backend/.env
// не подмешивается в тесты ни целиком, ни отдельными ключами.
process.env.DOTENV_CONFIG_PATH = 'unit-tests-do-not-load-dotenv.env';

process.env.DATABASE_URL = DEAD_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.LMSTUDIO_BASE_URL = 'http://127.0.0.1:1/v1';
process.env.LMSTUDIO_MODEL = 'test-model';
process.env.PROMPT_VERSION = 'test';
process.env.TG_BOT_TOKEN = '';
process.env.TG_BOT_ALLOWED_USER_IDS = '';
process.env.OPERATOR_TOKEN = '';
process.env.INGEST_ENABLED = 'false';
process.env.PIPELINE_ENABLED = 'false';
process.env.METRICS_AUTO_REFRESH = 'false';
process.env.BOT_ENABLED = 'false';
// Флаги записи из сессии разработчика (например, после проверки слияния) не должны
// менять поведение unit-тестов.
process.env.REPROCESS_AUTO_PUBLISH = 'false';
process.env.MERGE_APPLY_ENABLED = 'false';
process.env.GRAPH_EXPORT_ENABLED = 'true';
process.env.REVISION_WRITE_ENABLED = 'true';
process.env.HOST = '127.0.0.1';
// UTC, а не часовой пояс разработчика: даты не должны зависеть от машины.
process.env.TZ = 'UTC';
