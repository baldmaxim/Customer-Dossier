import { defineConfig } from 'vitest/config';

// Интеграционный профиль: настоящий PostgreSQL, только выделенная тестовая база.
// Цель задаётся TEST_DATABASE_URL и проверяется guard'ом (src/db/testTarget.ts)
// в globalSetup до первого запроса. Файлы идут последовательно: база общая.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['src/__tests__/integration/globalSetup.ts'],
    setupFiles: ['src/__tests__/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globals: false,
  },
});
