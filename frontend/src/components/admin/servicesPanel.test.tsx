// Вкладка «Сервисы» (06.10.2026): Контур.Фокус, parser-api.com и «Сайты компаний» — строками с коротким
// состоянием; нажатие раскрывает настройку на месте (в адресе ?open=), содержимое закрытых не монтируется;
// прежние адреса страниц ведут на вкладку с раскрытым сервисом.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders, renderWithRouter } from '../../test/render';
import { adminRoutes } from '../../pages/admin/routes';
import { ServicesPanel } from './ServicesPanel';

const FOCUS = {
  key: { source: 'none', hint: null, updatedAt: null, updatedBy: null, envKeySet: false, problem: null, canStore: true },
  enabled: false,
  dailyLimit: 100,
  refreshDays: 14,
  usedLastDay: 0,
  coverage: { companies: 40, identifiers: 38, found: 0, notFound: 0, due: 38, failing: 0 },
  recent: [],
};

const SUMMARY = { mode: 'on', dailyLimit: 300, totals: { withPending: 88, confirmed: 2, usedLastDay: 251, searched: 300 } };

const routes = [
  { match: 'GET /api/admin/focus', respond: () => ({ status: 200, body: FOCUS }) },
  { match: 'GET /api/admin/parser-api', respond: () => ({ status: 500, body: { error: 'нет' } }) },
  { match: 'GET /api/admin/company-sites/summary', respond: () => ({ status: 200, body: SUMMARY }) },
];

describe('вкладка «Сервисы»', () => {
  it('свёрнуто — названия и состояние; нажатие раскрывает настройку на месте', async () => {
    fakeApi(routes);
    renderWithProviders(<ServicesPanel />, '/admin/sources?tab=services');
    expect(await screen.findByText('ключ не задан')).toBeTruthy();
    expect(screen.getByText(/ждут решения: 88/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Ключ Контур.Фокуса' })).toBeNull();

    fireEvent.click(screen.getByRole('heading', { level: 2, name: 'Контур.Фокус — сведения ЕГРЮЛ' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Ключ Контур.Фокуса' })).toBeTruthy();
  });

  it('раскрытый сервис — из адреса', async () => {
    fakeApi(routes);
    renderWithProviders(<ServicesPanel />, '/admin/sources?tab=services&open=focus');
    expect(await screen.findByRole('heading', { level: 3, name: 'Ключ Контур.Фокуса' })).toBeTruthy();
  });

  it.each([
    ['/admin/sources/focus', 'focus'],
    ['/admin/sources/parser-api', 'parser-api'],
    ['/admin/sources/company-sites', 'company-sites'],
  ])('прежний адрес %s ведёт на вкладку с раскрытым сервисом', async (path, open) => {
    fakeApi([]);
    const { router } = renderWithRouter(adminRoutes, [path]);
    // Роутер меняет адрес, когда загружен ленивый чанк админки: в первый раз — дольше секунды.
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/sources'), { timeout: 10_000 });
    expect(router.state.location.search).toBe(`?tab=services&open=${open}`);
  });
});
