// Ежедневный маршрут аналитика на тестовом стенде (этап 18): Origin-гард, очередь проверки, запуски,
// обращение → краткое досье → снимок → HTML → печать, отсутствие переполнения по ширине, кэш service worker без /api.
// Вход по токену снят — портал открывается сразу.
// Данные — синтетические (seed:test-release, seed:test-brief). Печать в PDF оценивает человек: здесь только файл-артефакт.
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

const firstCaseId = async (page: Page): Promise<number> => {
  const res = await page.request.get('/api/cases?limit=20');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: Array<{ id: number; title: string }> };
  const brief = body.items.find(c => c.title.includes('корпуса 3')) ?? body.items[0];
  if (!brief) throw new Error('обращений нет: выполните seed:test-brief');
  return brief.id;
};

// Щит ACC-07: ответы /api не должны попадать в Cache Storage ни при какой навигации.
test('T18-02 кэш service worker: ответы /api не сохраняются', async ({ page }) => {
  await open(page, '/');
  await open(page, '/runs');
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
  await open(page, '/review');
  await page.getByLabel('Вид').selectOption('identity');
  await expect(page.getByText(/Всего: \d+; страница 1/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test('T18-01 запуски: список отличает пустой результат от ошибки; карточка открывается', async ({ page }) => {
  await open(page, '/runs');
  await expect(page.getByText(/Всего по фильтру: \d+/)).toBeVisible();
  const link = page.locator('table a[href^="/runs/"]').first();
  if ((await link.count()) > 0) {
    await link.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Запуск #');
    await expect(page.getByText(/Чанки: \d+ из \d+ приняты/)).toBeVisible();
  }
  await noHorizontalOverflow(page);
});

test('T18-04 снимок: краткое досье, HTML-выгрузка без скриптов, печатная раскладка', async ({ page }, info) => {
  await open(page, '/');
  const id = await firstCaseId(page);
  const created = await page.request.post(`/api/cases/${id}/snapshots`, { data: { idempotencyKey: `e2e-${info.project.name}-${Date.now()}` } });
  expect([200, 201]).toContain(created.status());
  const snapshotId = ((await created.json()) as { id: number }).id;

  await page.goto(`/snapshots/${snapshotId}`);
  await expect(page.getByRole('heading', { name: 'Кратко для переговоров' })).toBeVisible();
  await expect(page.getByText('Целостность подтверждена')).toBeVisible();
  await noHorizontalOverflow(page);

  const html = await page.request.get(`/api/snapshots/${snapshotId}/export.html`);
  expect(html.status()).toBe(200);
  const text = await html.text();
  expect(text).toContain('Кратко для переговоров');
  expect(text).not.toMatch(/<script/i);

  await page.setContent(text);
  await page.emulateMedia({ media: 'print' });
  const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('table, blockquote, p, li')).filter(el => el.scrollWidth > el.clientWidth + 1).length);
  expect(overflow).toBe(0);
  if (info.project.name === 'desktop') {
    // Файл для ручной проверки человеком (обрезка, переносы, основания); PASS печати этим тестом не выставляется.
    await page.pdf({ path: info.outputPath('snapshot-print.pdf'), format: 'A4', printBackground: true });
  }
});

test('T18-05 узкое окно: основные экраны без горизонтальной прокрутки', async ({ page }) => {
  for (const path of ['/', '/cases', '/review', '/runs', '/admin', '/contractors']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }
});
