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
  },
});
