// Ежедневный маршрут на тестовом стенде: Origin- и Host-гарды, «Проверка», «Обработка» и разбор,
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

test('T18-01 проверка: неясные упоминания постранично, «всего» по фильтру', async ({ page }) => {
  await open(page, '/admin/review');
  // Неясные упоминания — своя вкладка «Проверки»; вкладка живёт в адресе.
  await page.getByRole('tab', { name: /Неясные упоминания/ }).click();
  await expect(page).toHaveURL(/\/admin\/review\?tab=mentions$/);
  await expect(page.getByText(/^всего [\d\s]+$/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test('T18-01 обработка: список отличает пустой результат от ошибки; разбор открывается', async ({ page }) => {
  await open(page, '/admin/process');
  await expect(page.getByText(/всего по фильтру: [\d\s]+/)).toBeVisible();
  // Строка списка (таблица или карточка на телефоне) — ссылка на разбор целиком.
  const link = page.locator('main a[href^="/admin/process/"]').first();
  if ((await link.count()) > 0) {
    await link.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Разбор от');
    await expect(page.getByText('Технические подробности')).toBeVisible();
  }
  await noHorizontalOverflow(page);
});

test('каталог: строка открывается целиком, а не только имя', async ({ page }) => {
  await open(page, '/');
  // Строка каталога — строка таблицы на широком экране и карточка на телефоне. Щелчок у правого
  // края — там числа, а не ссылка: переход даёт накладка строки (.row-link в index.css).
  const row = page.locator('.row-link').first();
  if ((await row.count()) === 0) return;
  const href = await row.locator('a[href^="/company/"]').first().getAttribute('href');
  const box = await row.boundingBox();
  if (!box) return;
  await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
});

test('связи: схема строится вокруг одного центра и честно называет границы', async ({ page }) => {
  await open(page, '/');
  // Путь к схеме — из карточки компании, кнопкой «Схема связей» (колонку «схема» в каталоге сняли).
  const company = page.locator('main a[href^="/company/"]').first();
  if ((await company.count()) === 0) return;
  await company.click();
  const toGraph = page.getByRole('link', { name: 'Схема связей' }).first();
  if ((await toGraph.count()) === 0) return;
  await toGraph.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Связи');
  await expect(page.getByLabel('Легенда схемы')).toBeVisible();
  await expect(page.getByText(/промежуточные звенья не достраиваются/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test('T18-05 узкое окно: основные экраны без горизонтальной прокрутки', async ({ page }) => {
  for (const path of [
    '/',
    '/?view=unidentified',
    '/links',
    '/contractors',
    '/admin',
    '/admin/sources',
    '/admin/sources?tab=website',
    '/admin/process',
    '/admin/review',
    '/admin/review?tab=duplicates',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }
});
