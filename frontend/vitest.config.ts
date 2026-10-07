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
    // По умолчанию vitest берёт «ядра − 1» воркеров (7) и на машине разработчика падает по памяти; три — 31 с
    // вместо 78 у одного при пике ~1 ГБ (07.10.2026).
    maxWorkers: 3,
    // Глобальные стили отдаются тестам как есть (?raw): themeColor.test.ts сверяет theme-color
    // с токеном --chrome, useTheme.test.tsx — правило смены темы без переходов (styles/motion.css).
    // Модули компонентов по-прежнему не обрабатываются.
    css: { include: [/src\/index\.css/, /src\/styles\/[^/]+\.css/] },
  },
});
