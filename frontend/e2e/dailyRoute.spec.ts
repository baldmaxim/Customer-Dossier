// Ежедневный маршрут аналитика на тестовом стенде (этап 18): вход/выход, CSRF и Origin, очередь проверки, запуски,
// обращение → краткое досье → снимок → HTML → печать, отсутствие переполнения по ширине, кэш service worker без /api.
// Данные — синтетические (seed:test-release, seed:test-brief). Печать в PDF оценивает человек: здесь только файл-артефакт.
import { expect, test, type Page } from '@playwright/test';

const token = (): string => {
  const value = process.env.E2E_OPERATOR_TOKEN;
  if (!value) throw new Error('E2E_OPERATOR_TOKEN не задан');
  return value;
};

const login = async (page: Page): Promise<void> => {
  await page.goto('/');
  const field = page.locator('#operator-token');
  if (await field.isVisible()) {
    await field.fill(token());
    await page.getByRole('button', { name: 'Войти' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Основная навигация' }).or(page.getByRole('navigation', { name: 'Навигация' })).first()).toBeVisible();
};

const csrf = async (page: Page): Promise<string> => {
  const res = await page.request.get('/api/auth/session');
  const body = (await res.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error('сессия без CSRF-токена');
  return body.csrfToken;
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

test('T18-02 вход, досье, выход: после выхода прошлое досье не показывается и не лежит в кэше', async ({ page }) => {
  await login(page);
  const id = await firstCaseId(page);
  await page.goto(`/cases/${id}`);
  await expect(page.getByRole('heading', { name: 'Кратко для переговоров' })).toBeVisible();
  await noHorizontalOverflow(page);

  await page.getByRole('button', { name: 'Выйти' }).first().click();
  await expect(page.locator('#operator-token')).toBeVisible();
  await page.goto(`/cases/${id}`);
  await expect(page.locator('#operator-token')).toBeVisible();
  await expect(page.getByText('Кратко для переговоров')).toHaveCount(0);

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

test('T18-03 CSRF и Origin: изменение без токена и с чужим Origin отклоняется', async ({ page }) => {
  await login(page);
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/entities/ambiguities/1/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
    return res.status;
  });
  expect(status).toBe(403);
  const foreign = await page.request.post('/api/reprocess/runs/1/cancel', { headers: { Origin: 'http://evil.example', 'X-CSRF-Token': await csrf(page) }, data: {} });
  expect(foreign.status()).toBe(403);
});

test('T18-01 очередь проверки: неоднозначности постранично, «всего» по фильтру', async ({ page }) => {
  await login(page);
  await page.goto('/review');
  await page.getByLabel('Вид').selectOption('identity');
  await expect(page.getByText(/Всего: \d+; страница 1/)).toBeVisible();
  await noHorizontalOverflow(page);
});

test('T18-01 запуски: список отличает пустой результат от ошибки; карточка открывается', async ({ page }) => {
  await login(page);
  await page.goto('/runs');
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
  await login(page);
  const id = await firstCaseId(page);
  const created = await page.request.post(`/api/cases/${id}/snapshots`, { headers: { 'X-CSRF-Token': await csrf(page) }, data: { idempotencyKey: `e2e-${info.project.name}-${Date.now()}` } });
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
  await login(page);
  for (const path of ['/', '/cases', '/review', '/runs', '/admin', '/contractors']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await noHorizontalOverflow(page);
  }
});
