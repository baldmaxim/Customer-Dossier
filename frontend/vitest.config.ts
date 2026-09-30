// Компонентные тесты (этап 18): jsdom, синтетические ответы API через подменённый fetch. Сеть и сервер не нужны.
// Отдельно от vite.config.ts: PWA-плагин и прокси в тестах не участвуют.
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Виртуальный модуль PWA-плагина: в тестах плагина нет — заглушка, поведение задаёт vi.mock.
      'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/pwaRegisterStub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // Глобальные стили отдаются тестам как есть (?raw): themeColor.test.ts сверяет theme-color
    // с токеном --chrome. Модули компонентов по-прежнему не обрабатываются.
    css: { include: [/src\/index\.css/] },
  },
});
