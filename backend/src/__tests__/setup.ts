// Дефолты окружения для тестов. config/env.ts падает на импорте, если не задан
// DATABASE_URL — это правильно для рантайма, но тесты чистой логики (парсеры,
// нормализация) не должны требовать живой БД.
//
// Строка подключения заведомо нерабочая: если тест случайно полезет в БД,
// он упадёт с ошибкой соединения, а не молча запишет что-то в реальную базу.

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/tg_info_test';
process.env.DATABASE_SSL ??= 'false';
process.env.LMSTUDIO_BASE_URL ??= 'http://127.0.0.1:1/v1';
process.env.LMSTUDIO_MODEL ??= 'test-model';
process.env.PROMPT_VERSION ??= 'test';
process.env.SCHEMA_VERSION ??= 'extract@1';
process.env.TZ ??= 'Asia/Almaty';
