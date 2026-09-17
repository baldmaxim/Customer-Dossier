// Компонентные тесты (этап 18): jsdom, синтетические ответы API через подменённый fetch. Сеть и сервер не нужны.
// Отдельно от vite.config.ts: PWA-плагин и прокси в тестах не участвуют.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
  },
});
