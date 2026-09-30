// Главная: переключатель «Компании / Публикации» и один поиск, который меняет смысл вместе с ним.
//
// Накладка строки каталога — псевдоэлемент, в jsdom её клик не проверить: здесь проверяется
// разметка (ссылка-накладка в строке), а сам переход по пустой ячейке — в e2e (dailyRoute.spec.ts).
// Состояние экрана живёт в адресе: проверки с «Назад» и адресом идут через data-роутер в памяти.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IDENTITY_STATUS_LABELS } from '../lib/labels';
import { fakeApi, renderWithProviders, renderWithRouter, type IFakeRoute } from '../test/render';
import { SearchPage } from './SearchPage';

const refresh = {
  active: { id: 1, rulesVersion: 'signals@2', cutoffAt: '2026-09-21T00:00:00Z', finishedAt: '2026-09-21T00:01:00Z' },
  lastFailure: null,
  running: false,
  stale: false,
  staleReasons: [],
};

const row = {
  companyId: 42,
  name: 'ООО «Пример»',
  city: 'Москва',
  identityStatus: 'name_only',
  projects: 2,
  roles: ['contractor'],
  eventsDated12m: 0,
  eventsUndated: 0,
  publications: 24817,
  families: 1,
  courtRoles: null,
};

const feedItem = (over: Record<string, unknown> = {}) => ({
  id: 5,
  revisionId: 9,
  sourceTitle: 'Недвижимость изнутри',
  sourceKind: 'telegram',
  sourceKey: 'propertyinsider',
  publishedAt: '2026-09-20T09:00:00Z',
  firstObservedAt: '2026-09-20T09:05:00Z',
  url: 'https://t.me/propertyinsider/5',
  title: null,
  topic: 'Конкурс на корпус 3',
  snippet: 'Объявлен конкурс на генподряд корпуса 3.',
  ...over,
});

const revision = (id: number, body: string, over: Record<string, unknown> = {}) => ({
  revision: {
    id, sourceItemId: 5, revisionNo: 1, title: null, body, representation: 'telegram_web_text@1', bodyHash: 'x',
    completeness: 'full', completenessReason: null, attachments: [], publishedAt: '2026-09-20T09:00:00Z', sourceModifiedAt: null,
    firstObservedAt: '2026-09-20T09:05:00Z', chronology: 'observed_order', sameContentAsRevisionId: null, legacyDocumentId: 19, origin: 'ingest',
    ...over,
  },
});

const routes = (catalogItems: unknown[] = [row]): IFakeRoute[] => [
  { match: 'GET /api/contractors/summary', respond: () => ({ status: 200, body: { byIdentity: [], refresh, totals: { companies: 12334, projects: 3, documents: 21, pendingMerges: 0, lonelyCompanies: 4 } } }) },
  { match: 'GET /api/contractors', respond: () => ({ status: 200, body: { status: 'ok', refresh, items: catalogItems } }) },
  { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: [{ id: 42, name: 'ООО «Пример»', city: 'Москва', legalForm: 'ООО', score: 1, projects: 2 }] } }) },
  { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: [{ id: 2875, name: 'СОБЫТИЕ 68275', city: 'Москва', kind: 'residential', level: 'complex', levelLabel: null, parentId: null, parentName: null, children: 0 }] } }) },
  { match: 'GET /api/feed', respond: () => ({ status: 200, body: { items: [feedItem(), feedItem({ id: 6, revisionId: 10, topic: 'Сдан мост', snippet: 'Второй пост' })], nextCursor: null } }) },
  { match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: revision(9, 'Полный текст поста о корпусе 3.') }) },
  { match: 'GET /api/revisions/10', respond: () => ({ status: 200, body: revision(10, 'Полный текст второго поста.') }) },
];

const searchRoutes = [{ path: '/', element: <SearchPage /> }];

/** Узкий экран: все медиазапросы с min-width не совпадают (jsdom без matchMedia считает экран широким). */
const phone = (): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  // Возврат к месту в списке прокручивает окно; в jsdom прокрутки нет.
  vi.stubGlobal('scrollTo', () => undefined);
};

describe('Главная', () => {
  it('одна строка находит компанию и объект и ведёт в соответствующие карточки', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SearchPage />, '/?q=событие');

    expect((await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).getAttribute('href')).toBe('/projects/2875');
    expect(screen.getByRole('link', { name: 'ООО «Пример»' }).getAttribute('href')).toBe('/company/42');
    expect(screen.getByRole('searchbox', { name: 'Поиск компании или объекта' })).toBeTruthy();
    expect(api.calls.some(c => c.url.startsWith('/api/projects/search?q='))).toBe(true);
    expect(api.calls.some(c => c.url.startsWith('/api/companies?q='))).toBe(true);
  });

  it('каталог — пять колонок без «№» и «схемы»; ссылка накрывает строку; числа с разделителем тысяч', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(<SearchPage />);

    const link = await screen.findByRole('link', { name: 'ООО «Пример»' });
    expect(link.getAttribute('href')).toBe('/company/42');
    expect(link.className).toContain('row-link-target');
    expect(link.closest('tr')?.className).toContain('row-link');
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Компания', 'Город', 'Роль', 'Объектов', 'Публикаций']);
    expect(screen.queryByRole('link', { name: 'схема' })).toBeNull();
    // 24 817 — с неразрывным пробелом: число не рвётся на две строки.
    expect(screen.getByRole('cell', { name: '24\u00a0817' })).toBeTruthy();
    expect(container.querySelectorAll('tr.row-link').length).toBe(1);
  });

  it('под названием компании ничего нет: город — своей колонкой, ярлыка опознания нет', async () => {
    fakeApi(routes());
    renderWithProviders(<SearchPage />);

    const cell = (await screen.findByRole('link', { name: 'ООО «Пример»' })).closest('td')!;
    expect(cell.textContent).toBe('ООО «Пример»');
    expect(screen.getByRole('cell', { name: 'Москва' })).toBeTruthy();
    // Подпись берётся из словаря: смена формулировки не должна молча обессмыслить проверку.
    expect(screen.queryByText(IDENTITY_STATUS_LABELS.name_only!)).toBeNull();
  });

  it('под каталогом честно: показаны первые 200 из числа компаний в базе', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...row, companyId: 1000 + i, name: `Компания ${i}` }));
    fakeApi(routes(many));
    renderWithProviders(<SearchPage />);

    expect(await screen.findByText('Показаны первые 200 из 12 334 компаний в базе — уточните поиск по названию.')).toBeTruthy();
  });

  it('на телефоне каталог — карточки, фильтры свёрнуты в строку-сводку', async () => {
    phone();
    fakeApi(routes());
    renderWithProviders(<SearchPage />, '/?role=customer');

    const list = await screen.findByRole('list', { name: 'Компании' });
    const link = within(list).getByRole('link', { name: 'ООО «Пример»' });
    expect(link.getAttribute('href')).toBe('/company/42');
    expect(link.closest('li')?.className).toContain('row-link');
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(list).getByText('Москва · подрядчик')).toBeTruthy();
    // Сводка фильтров — заголовок свёрнутого блока; сами фильтры внутри.
    const summary = screen.getByText('Заказчики · по числу объектов');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('фильтры каталога в адресе и переживают поиск по названию', async () => {
    const api = fakeApi(routes());
    const { router } = renderWithRouter(searchRoutes, ['/']);
    await screen.findByRole('link', { name: 'ООО «Пример»' });

    fireEvent.change(screen.getByLabelText('Выступала в роли'), { target: { value: 'customer' } });
    await waitFor(() => expect(router.state.location.search).toContain('role=customer'));
    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/contractors?role=customer'))).toBe(true));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск компании или объекта' }), { target: { value: 'мост' } });
    expect(await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).toBeTruthy();
    expect(router.state.location.search).toContain('role=customer');

    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    await waitFor(() => expect((screen.getByLabelText('Выступала в роли') as HTMLSelectElement).value).toBe('customer'));
    expect(router.state.location.search).not.toContain('q=');
  });

  it('«Назад» возвращает прежний режим и запрос — и в адрес, и в строку поиска', async () => {
    fakeApi(routes());
    const { router } = renderWithRouter(searchRoutes, ['/?q=мост']);
    expect(await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Публикации' }));
    await waitFor(() => expect(router.state.location.search).toContain('view=publications'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по публикациям' }), { target: { value: 'бетон' } });
    await waitFor(() => expect(router.state.location.search).toContain('q=%D0%B1%D0%B5%D1%82%D0%BE%D0%BD'));

    await router.navigate(-1);
    const box = await screen.findByRole('searchbox', { name: 'Поиск компании или объекта' });
    await waitFor(() => expect((box as HTMLInputElement).value).toBe('мост'));
    expect(router.state.location.search).not.toContain('view=');
  });

  it('ошибка каталога — сообщением с «Повторить», а не пустым списком', async () => {
    fakeApi(routes().map(r => (r.match === 'GET /api/contractors' ? { ...r, respond: () => ({ status: 500, body: { error: 'база недоступна' } }) } : r)));
    renderWithProviders(<SearchPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить компании');
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('переключатель «Публикации» показывает ленту: канал по имени и пост рядом', async () => {
    fakeApi(routes());
    renderWithProviders(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Публикации' }));

    expect(await screen.findByText('Конкурс на корпус 3')).toBeTruthy();
    expect(screen.getAllByText('Недвижимость изнутри').length).toBeGreaterThan(0);
    expect(await screen.findByText('Полный текст поста о корпусе 3.')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Поиск по публикациям' })).toBeTruthy();
  });

  it('открытый пост — в адресе: ссылка на пост открывает его, выбор другого меняет адрес', async () => {
    fakeApi(routes());
    const { router } = renderWithRouter(searchRoutes, ['/?view=publications&post=6']);

    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
    fireEvent.click(screen.getByText('Объявлен конкурс на генподряд корпуса 3.'));
    await waitFor(() => expect(router.state.location.search).toContain('post=5'));
    expect(await screen.findByText('Полный текст поста о корпусе 3.')).toBeTruthy();
  });

  it('на телефоне пост открывается вместо списка, «Назад» закрывает его и возвращает фокус на карточку', async () => {
    phone();
    fakeApi(routes());
    const { router } = renderWithRouter(searchRoutes, ['/?view=publications']);

    const card = await screen.findByRole('button', { name: /Конкурс на корпус 3/ });
    fireEvent.click(card);
    await waitFor(() => expect(router.state.location.search).toContain('post=5'));
    expect(await screen.findByText('Полный текст поста о корпусе 3.')).toBeTruthy();
    const heading = screen.getByRole('heading', { name: /^Публикация: Недвижимость изнутри/ });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('button', { name: 'К списку' })).toBeTruthy();
    // Пока пост открыт вместо списка, возврат оболочки спрятан: кнопка возврата одна.
    expect(document.querySelector('[data-hide-backbar]')).not.toBeNull();

    await router.navigate(-1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'К списку' })).toBeNull());
    expect(router.state.location.search).not.toContain('post=');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Конкурс на корпус 3/ })));
  });

  it('в публикации ДОМ.РФ характеристики и генподрядчик показаны отдельно от исходного текста', async () => {
    fakeApi(routes().map(route => route.match === 'GET /api/revisions/9'
      ? { ...route, respond: () => ({ status: 200, body: revision(9,
        'Объект: «СОБЫТИЕ» (ID 68275 в реестре)\nСдача дома: I кв. 2029\nКоличество квартир: 507\nГенподрядчики: ООО СУ-10 (ИНН: 7736255508)',
        { title: 'СОБЫТИЕ', representation: 'registry_object_browser@1', completeness: 'excerpt', publishedAt: null }) }) }
      : route));
    renderWithProviders(<SearchPage />, '/?view=publications');

    const heading = await screen.findByRole('heading', { name: 'Характеристики объекта' });
    const panel = heading.parentElement!;
    expect(panel.textContent).toContain('ГенподрядчикиООО СУ-10 (ИНН: 7736255508)');
    expect(panel.textContent).toContain('Сдача домаI кв. 2029');
    expect(screen.getByText(/^Исходный текст/).closest('details')?.open).toBe(false);
  });

  it('в режиме публикаций поиск уходит в ленту, а не в поиск компаний', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SearchPage />, '/?view=publications');
    await screen.findByText('Конкурс на корпус 3');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по публикациям' }), { target: { value: 'корпус' } });

    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/feed') && c.url.includes('q=%D0%BA%D0%BE%D1%80%D0%BF%D1%83%D1%81'))).toBe(true));
    expect(api.calls.some(c => c.url.startsWith('/api/companies?q='))).toBe(false);
  });
});
