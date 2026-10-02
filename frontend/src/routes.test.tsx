// Карта маршрутов: все прежние адреса и постоянные редиректы живы после перехода на
// data-роутер (createBrowserRouter). Страницы здесь не проверяются — только куда ведёт адрес.

import { waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { appRoutes } from './routes';
import { fakeApi, renderWithRouter } from './test/render';

// Страницам нужен API; ответ «пусто» на всё — адресу этого достаточно.
const quietApi = () =>
  fakeApi([
    { match: 'GET /api', respond: () => ({ status: 200, body: { items: [], nextCursor: null, total: 0 } }) },
  ]);

const at = async (path: string): Promise<string> => {
  quietApi();
  const { router, unmount } = renderWithRouter([{ element: <Outlet />, children: appRoutes }], [path]);
  // Первый адрес админки грузит её ленивый чанк: на занятой машине это дольше секунды по умолчанию.
  await waitFor(() => expect(router.state.navigation.state).toBe('idle'), { timeout: 5000 });
  const where = `${router.state.location.pathname}${router.state.location.search}`;
  unmount();
  return where;
};

describe('маршруты', () => {
  it.each([
    ['/account', '/admin/account'],
    ['/contractors', '/'],
    ['/runs', '/admin/process'],
    ['/runs/42', '/admin/process/42'],
    ['/review', '/admin/review'],
    // Админка: «Конвейер», «Сбор» и «Результат» разошлись по разделам — старые адреса ведут туда.
    ['/admin', '/admin/sources'],
    ['/admin/collect', '/admin/sources'],
    ['/admin/collect?tab=website', '/admin/sources?tab=website'],
    ['/admin/result', '/admin/review?tab=duplicates'],
    ['/cases/7', '/'],
    ['/snapshots/abc/def', '/'],
    ['/no-such-page', '/'],
  ])('%s → %s', async (from, to) => {
    await waitFor(async () => expect(await at(from)).toBe(to), { timeout: 8000 });
  });

  it.each([
    '/',
    '/company/7',
    '/links',
    '/documents/31',
    '/projects/55',
    '/admin/sources',
    '/admin/sources?tab=manual',
    '/admin/process',
    '/admin/process?source=3&status=failed',
    '/admin/process/501',
    '/admin/review',
    '/admin/review?tab=mentions',
    '/admin/model',
    '/admin/users',
    '/admin/account',
  ])(
    '%s открывается без редиректа',
    async path => {
      expect(await at(path)).toBe(path);
    },
  );
});
