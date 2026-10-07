import { defineConfig } from 'vitest/config';

// Unit-профиль: без сети и без базы. Интеграционные тесты (*.int.test.ts)
// идут отдельно — vitest.integration.config.ts, npm run test:integration.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.int.test.ts', 'node_modules/**', 'dist/**'],
    setupFiles: ['src/__tests__/setup.ts'],
    globals: false,
    // По умолчанию vitest берёт «ядра − 1» воркеров (7) и на машине разработчика падает по памяти; три — 25 с
    // вместо 68 у одного при пике ~1 ГБ (07.10.2026). Изоляцию файлов не выключаем: тесты меняют env и ключ модели.
    maxWorkers: 3,
  },
});
