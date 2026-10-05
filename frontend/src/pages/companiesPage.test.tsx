// Главная «Компании» (ADR-016): поиск по названию и ИНН и каталог от юрлица — «Юрлица · Группы · Без ИНН».
// Общей ленты публикаций на главной нет.
//
// Накладка строки каталога — псевдоэлемент, в jsdom её клик не проверить: здесь проверяется разметка
// (ссылка-накладка в строке), сам переход по пустой ячейке — в e2e. Состояние экрана живёт в адресе:
// проверки с «Назад» и адресом идут через data-роутер в памяти.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ICatalogRow } from '../api/types';
import { fakeApi, renderWithProviders, renderWithRouter, type IFakeRoute } from '../test/render';
import { CompaniesPage } from './CompaniesPage';

const row = (over: Partial<ICatalogRow> = {}): ICatalogRow => ({
  kind: 'company',
  companyId: 42,
  groupRef: null,
  name: 'Пример',
  egrulName: 'ООО "ПРИМЕР"',
  egrulStatus: 'Действующее',
  inn: '7707083893',
  ogrn: null,
  city: 'Москва',
  entityType: 'legal_entity',
  roles: ['contractor'],
  objects: 2,
  publications: 24817,
  lastPublishedAt: '2026-09-20T09:00:00Z',
  watched: false,
  namePending: false,
  hints: 0,
  members: [],
  parents: [],
  ...over,
});

const counts = { legal: 76, groups: 12, unidentified: 2725, watched: 3, dismissed: 4 };

const routes = (items: ICatalogRow[] = [row()], total = items.length): IFakeRoute[] => [
  {
    match: 'GET /api/catalog/companies',
    respond: url => {
      const view = new URL(url, 'http://x').searchParams.get('view') ?? 'legal';
      return { status: 200, body: { view, items, total, counts } };
    },
  },
  { match: 'GET /api/companies', respond: () => ({ status: 200, body: { items: [{ id: 42, name: 'Пример', city: 'Москва', legalForm: 'ООО', score: 1, projects: 2 }] } }) },
  { match: 'GET /api/projects/search', respond: () => ({ status: 200, body: { items: [{ id: 2875, name: 'СОБЫТИЕ 68275', city: 'Москва', kind: 'residential', level: 'complex', levelLabel: null, parentId: null, parentName: null, children: 0 }] } }) },
];

const homeRoutes = [{ path: '/', element: <CompaniesPage /> }];

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
  vi.stubGlobal('scrollTo', () => undefined);
};

describe('Главная «Компании»', () => {
  it('одна строка находит компанию и объект и ведёт в соответствующие карточки', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<CompaniesPage />, '/?q=событие');

    expect((await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).getAttribute('href')).toBe('/projects/2875');
    expect(screen.getByRole('link', { name: 'Пример' }).getAttribute('href')).toBe('/company/42');
    expect(screen.getByRole('searchbox', { name: 'Поиск компании или объекта' })).toBeTruthy();
    expect(api.calls.some(c => c.url.startsWith('/api/companies?q='))).toBe(true);
  });

  it('переключателя «Публикации» и ленты нет', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<CompaniesPage />, '/?view=publications');
    await screen.findByRole('link', { name: 'ООО "ПРИМЕР"' });
    expect(screen.queryByRole('button', { name: 'Публикации' })).toBeNull();
    expect(api.calls.some(c => c.url.startsWith('/api/feed'))).toBe(false);
  });

  it('юрлица: наименование ЕГРЮЛ, ИНН, статус словами; имя из публикаций — пояснением; ссылка накрывает строку', async () => {
    fakeApi(routes([row({ watched: true })]));
    const { container } = renderWithProviders(<CompaniesPage />);

    const link = await screen.findByRole('link', { name: 'ООО "ПРИМЕР"' });
    expect(link.getAttribute('href')).toBe('/company/42');
    expect(link.className).toContain('row-link-target');
    expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Компания', 'ИНН / ОГРН', 'Статус в ЕГРЮЛ', 'Роль', 'Объектов', 'Публикаций', 'Последняя']);
    expect(link.closest('td')?.textContent).toContain('Москва · в публикациях — «Пример» · на контроле');
    expect(screen.getByRole('cell', { name: 'подрядчик' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '20.09.2026' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'ИНН 7707083893' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Действующее' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '24 817' })).toBeTruthy();
    expect(container.querySelectorAll('tr.row-link').length).toBe(1);
  });

  it('статус ЕГРЮЛ — ярлыком, «с даты» мелко; ролей больше двух — «+N», названия остальных — диктору', async () => {
    fakeApi(routes([row({ egrulStatus: 'Действующее (с 01.02.2020)', roles: ['developer', 'customer', 'contractor', 'designer'] })]));
    renderWithProviders(<CompaniesPage />);
    await screen.findByRole('link', { name: 'ООО "ПРИМЕР"' });
    expect(screen.getByRole('cell', { name: 'Действующее с 01.02.2020' })).toBeTruthy();
    const roles = screen.getByRole('cell', { name: /застройщик/ });
    expect(roles.textContent).toBe('застройщикзаказчик+2ещё: подрядчик, проектировщик');
  });

  it('СЗ — внутри главной компании: «N юрлиц внутри» раскрывает их ссылками; группа только по ДОМ.РФ — без карточки', async () => {
    fakeApi(routes([
      row({ companyId: 50, name: 'Донстрой', egrulName: null, members: [{ companyId: 51, name: 'СЗ ДОНСТРОЙ', inn: '6319194231' }, { companyId: 52, name: 'СЗ ОСЕННИЙ КВАРТАЛ', inn: null }] }),
      row({ kind: 'registry_group', companyId: null, groupRef: '77', name: 'Гранель', egrulName: null, egrulStatus: null, inn: null, members: [{ companyId: 60, name: 'СЗ ГРАНЕЛЬ', inn: null }] }),
    ]));
    renderWithProviders(<CompaniesPage />);
    const toggle = await screen.findByRole('button', { name: '2\u00a0юрлица внутри' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Своей строкой под названием, а не вплотную к нему.
    expect(toggle.parentElement?.contains(screen.getByRole('link', { name: 'Донстрой' }))).toBe(false);
    expect(screen.queryByRole('link', { name: 'СЗ ДОНСТРОЙ' })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('link', { name: 'СЗ ДОНСТРОЙ' }).getAttribute('href')).toBe('/company/51');
    expect(screen.getByRole('cell', { name: 'ИНН 6319194231' })).toBeTruthy();
    // Группа только по реестру: названия-ссылки нет, есть пояснение и раскрытие.
    expect(screen.queryByRole('link', { name: 'Гранель' })).toBeNull();
    expect(screen.getByText(/группа по реестру ДОМ\.РФ — в портале не подтверждена/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1\u00a0юрлицо внутри' }));
    expect(screen.getByRole('link', { name: 'СЗ ГРАНЕЛЬ' }).getAttribute('href')).toBe('/company/60');
  });

  it('вкладки с числами; «Без ИНН» — пояснение и свои колонки, без фильтра «на контроле»', async () => {
    const api = fakeApi(routes([row({ companyId: 7, name: 'Картасервис', egrulName: null, egrulStatus: null, inn: null })]));
    const { router } = renderWithRouter(homeRoutes, ['/']);

    fireEvent.click(await screen.findByRole('button', { name: 'Без ИНН · 2\u00a0725' }));
    await waitFor(() => expect(router.state.location.search).toContain('view=unidentified'));
    expect(await screen.findByText(/имена из публикаций, у которых нет ИНН/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('columnheader').map(th => th.textContent)).toEqual(['Название в публикациях', 'Роль', 'Объектов', 'Публикаций', 'Последняя']));
    expect(screen.queryByLabelText('Только на контроле')).toBeNull();
    expect(api.calls.some(c => c.url.includes('view=unidentified'))).toBe(true);
  });

  it('под каталогом честно: показаны первые 200 из общего числа', async () => {
    const many = Array.from({ length: 200 }, (_, i) => row({ companyId: 1000 + i, name: `Компания ${i}`, egrulName: null }));
    fakeApi(routes(many, 412));
    renderWithProviders(<CompaniesPage />);
    expect(await screen.findByText('Показаны первые 200 из 412 — уточните поиск по названию или ИНН.')).toBeTruthy();
  });

  it('на телефоне каталог — карточки, фильтры свёрнуты в строку-сводку', async () => {
    phone();
    fakeApi(routes());
    renderWithProviders(<CompaniesPage />, '/?role=customer&watch=1');

    const list = await screen.findByRole('list', { name: 'Компании' });
    const link = within(list).getByRole('link', { name: 'ООО "ПРИМЕР"' });
    expect(link.getAttribute('href')).toBe('/company/42');
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(list).getByText('Москва · ИНН 7707083893 · Действующее · подрядчик')).toBeTruthy();
    const summary = screen.getByText('На контроле · заказчики · по числу объектов');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('фильтры каталога в адресе и переживают поиск по названию', async () => {
    const api = fakeApi(routes());
    const { router } = renderWithRouter(homeRoutes, ['/']);
    await screen.findByRole('link', { name: 'ООО "ПРИМЕР"' });

    fireEvent.change(screen.getByLabelText('Выступала в роли'), { target: { value: 'customer' } });
    await waitFor(() => expect(router.state.location.search).toContain('role=customer'));
    await waitFor(() => expect(api.calls.some(c => c.url.includes('role=customer'))).toBe(true));
    fireEvent.click(screen.getByLabelText('Только на контроле'));
    await waitFor(() => expect(router.state.location.search).toContain('watch=1'));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск компании или объекта' }), { target: { value: 'мост' } });
    expect(await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).toBeTruthy();
    expect(router.state.location.search).toContain('role=customer');

    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    await waitFor(() => expect((screen.getByLabelText('Выступала в роли') as HTMLSelectElement).value).toBe('customer'));
    expect(router.state.location.search).not.toContain('q=');
  });

  it('«Назад» возвращает прежний запрос — и в адрес, и в строку поиска', async () => {
    fakeApi(routes());
    const { router } = renderWithRouter(homeRoutes, ['/?q=мост']);
    expect(await screen.findByRole('link', { name: 'СОБЫТИЕ 68275' })).toBeTruthy();
    await router.navigate('/?q=событие');
    await router.navigate(-1);
    const box = await screen.findByRole('searchbox', { name: 'Поиск компании или объекта' });
    await waitFor(() => expect((box as HTMLInputElement).value).toBe('мост'));
  });

  it('ошибка каталога — сообщением с «Повторить», а не пустым списком', async () => {
    fakeApi(routes().map(r => (r.match === 'GET /api/catalog/companies' ? { ...r, respond: () => ({ status: 500, body: { error: 'база недоступна' } }) } : r)));
    renderWithProviders(<CompaniesPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить компании');
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('пустой вид с фильтром — «Сбросить фильтр»', async () => {
    fakeApi(routes([]));
    renderWithProviders(<CompaniesPage />, '/?role=designer');
    expect(await screen.findByText(/Компаний с ИНН по этому фильтру нет/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сбросить фильтр' })).toBeTruthy();
  });
});
