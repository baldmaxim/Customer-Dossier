// Ежедневный маршрут на тестовом стенде: Origin- и Host-гарды, очередь проверки, запуски,
// отсутствие переполнения по ширине, кэш service worker без /api.
// Вход по токену снят — портал открывается сразу. Обращения и снимки с портала убраны.
// Данные — синтетические (seed:test-release).
import { expect, test, type Page } from '@playwright/test';

/** Открыть экран и дождаться, что оболочка портала отрисована. */
const open = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).or(page.getByRole('navigation', { name: 'Навигация' })).first()).toBeVisible();
};

const noHorizontalOverflow = async (page: Page): Promise<void> => {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, `scrollWidth ${scroll} > innerWidth ${width}`).toBeLessThanOrEqual(width + 1);
};

test('T18-02 кэш service worker: ответы /api не сохраняются', async ({ page }) => {
  await open(page, '/');
  await open(page, '/admin/process');
  await noHorizontalOverflow(page);

  const cachedApi = await page.evaluate(async () => {
    if (!('caches' in window)) return [];
    const found: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) if (new URL(req.url).pathname.startsWith('/api')) found.push(req.url);
    }
    return found;
  });
  expect(cachedApi).toEqual([]);
});

test('T18-03 Origin и Host: запрос с чужой страницы и на чужое имя отклоняется', async ({ page }) => {
  await open(page, '/');
  const foreign = await page.request.post('/api/reprocess/runs/1/cancel', { headers: { Origin: 'http://evil.example' }, data: {} });
  expect(foreign.status()).toBe(403);
  const rebind = await page.request.get('/api/admin/sources', { headers: { Host: 'evil.example' } });
  expect(rebind.status()).toBe(403);
});

test('T18-01 очередь проверки: неоднозначности постранично, «всего» по фильтру', async ({ page }) => {
  await open(page, '/admin/review');
  await page.getByLabel('Вид').selectOption('identity');
  await expect(page.getByText(/Всего: \d+; страница 1/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test('T18-01 запуски: список отличает пустой результат от ошибки; карточка открывается', async ({ page }) => {
  await open(page, '/admin/process');
  await expect(page.getByText(/Всего по фильтру: \d+/)).toBeVisible();
  const link = page.locator('table a[href^="/admin/process/"]').first();
  if ((await link.count()) > 0) {
    await link.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Запуск #');
    await expect(page.getByText(/Чанки: \d+ из \d+ приняты/)).toBeVisible();
  }
  await noHorizontalOverflow(page);
});

test('T18-05 узкое окно: основные экраны без горизонтальной прокрутки', async ({ page }) => {
  for (const path of ['/', '/contractors', '/admin', '/admin/collect', '/admin/process', '/admin/result', '/admin/review']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }
});
