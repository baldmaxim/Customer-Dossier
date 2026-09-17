// Браузерная регрессия (этап 18). Запускает только пользователь: API и фронтенд подняты на ТЕСТОВОЙ базе
// (tg_info_test после seed), фоновые задания выключены. Агент этот файл не исполняет.
//
//   $env:E2E_TEST_TARGET_CONFIRMED='tg_info_test'; $env:E2E_OPERATOR_TOKEN='<токен тестового стенда>'; npm run e2e
//
// Токен читается из окружения и в отчёты не пишется. Браузер: `npx playwright install chromium` (один раз, сеть).
import { defineConfig, devices } from '@playwright/test';

if (process.env.E2E_TEST_TARGET_CONFIRMED !== 'tg_info_test') {
  throw new Error('E2E только против тестового стенда: задайте E2E_TEST_TARGET_CONFIRMED=tg_info_test после проверки, что API смотрит в tg_info_test');
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
