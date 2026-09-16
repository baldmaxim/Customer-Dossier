// Окружение интеграционных тестов в каждом воркере. DATABASE_URL подменяется
// тестовой целью только после повторной проверки guard'ом.

import { assertTestDatabaseUrl } from '../../db/testTarget.js';

// Исходный DATABASE_URL (если был) запоминаем один раз: с ним сравнивается цель.
process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);

process.env.DOTENV_CONFIG_PATH = 'integration-tests-do-not-load-dotenv.env';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
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
// Флаги записи из сессии разработчика не должны менять поведение интеграционных тестов.
process.env.REPROCESS_AUTO_PUBLISH = 'false';
process.env.MERGE_APPLY_ENABLED = 'false';
process.env.GRAPH_EXPORT_ENABLED = 'true';
process.env.REVISION_WRITE_ENABLED = 'true';
process.env.HOST = '127.0.0.1';
process.env.TZ = 'UTC';
