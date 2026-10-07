// Карточка компании: вкладки «Сведения · Объекты · Публикации · Подробно» (ADR-016: сначала юрлицо,
// потом объекты, потом публикации), вкладка, открытый пост и фильтры объектов — в адресе.
//
// «Сведения» — ЕГРЮЛ, реестр застройщика, сводка-плитки и контрагенты с цитатой по раскрытию;
// «Объекты» — карточки со сведениями ДОМ.РФ и объектами застройщиков группы, публикации — читалкой,
// «Подробно» — вкладки «События · Участие и связи · Показатели», глубже — окнами; схема связей — окном из
// шапки; ошибка загрузки не выдаётся за «не найдена».

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders, renderWithRouter } from '../test/render';
import { buildersBody, checksBody, companyRoutes, datasetState, deliveryBody, efrsbView, deliveryHouse, eventStats, financeBody, financeYear, event, manyPartners, monthSeries, objectRegistry, objectRow, objectsBody, publicationStats } from './companyPage.fixtures';
import { CompanyPage } from './CompanyPage';

/** Карточка читает id из адреса: без Route параметр не появится. */
const renderCard = (url = '/company/7'): void => {
  renderWithProviders(
    <Routes>
      <Route path="/company/:id" element={<CompanyPage />} />
    </Routes>,
    url,
  );
};

const cardRoutes = [{ path: '/company/:id', element: <CompanyPage /> }];

const replace = (match: string, respond: () => { status: number; body: unknown }) =>
  companyRoutes().map(route => (route.match === match ? { ...route, respond } : route));

/** Узкий экран: медиазапросы с min-width не совпадают (jsdom без matchMedia считает экран широким). */
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

describe('Карточка компании', () => {
  it('четыре вкладки, первая — «Сведения»: ЕГРЮЛ, сводка и контрагенты, без ленты публикаций', async () => {
    fakeApi(companyRoutes());
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'ООО «Мостострой»' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Разделы компании' });
    await waitFor(() =>
      expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Сведения', 'Объекты1', 'Публикации', 'Подробно']),
    );
    expect(within(tabs).getByRole('tab', { name: 'Сведения' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус', level: 2 })).toBeTruthy();
    expect(await screen.findByText('ООО «Дорсервис»')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Коротко о компании' })).toBeTruthy();
    expect(screen.queryByText('Подряд на развязку передан другой фирме')).toBeNull();
    // Путь к схеме — кнопка в шапке, схема — окном.
    expect(screen.getByRole('button', { name: 'Схема связей' }).getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('группа компаний: над названием «Группа компаний» с подсказкой, а не блок на «Сведениях»', async () => {
    fakeApi(companyRoutes({ companyOver: { company: { id: 7, name: 'Основа', city: null, legalForm: 'АО', taxId: null, entityType: 'group' }, identifiers: [] } }));
    renderCard();
    expect(await screen.findByRole('heading', { level: 1, name: 'Основа' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Пояснение: группа компаний' })).toBeTruthy();
    expect(screen.queryByText(/У группы нет своего ИНН/)).toBeNull();
    expect(screen.queryByText('Назначить компании')).toBeNull();
  });

  it('реквизиты в шапке — подпись над значением; ИНН копируется нажатием', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      fakeApi(companyRoutes());
      renderCard();

      const requisites = await screen.findByLabelText('Реквизиты');
      const inn = within(requisites).getByText('ИНН');
      expect(inn.tagName).toBe('DT');
      expect(inn.nextElementSibling?.textContent).toBe('1655000000');
      expect(within(requisites).getByText('Казань')).toBeTruthy();
      expect(within(requisites).getByText('юрлицо · ООО')).toBeTruthy();

      fireEvent.click(within(requisites).getByRole('button', { name: 'Скопировать ИНН 1655000000' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('1655000000'));
      expect(await screen.findByText('ИНН скопирован')).toBeTruthy();
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('без доступа к буферу обмена реквизит — просто текст, без кнопки', async () => {
    fakeApi(companyRoutes());
    renderCard();

    const requisites = await screen.findByLabelText('Реквизиты');
    expect(within(requisites).getByText('1655000000')).toBeTruthy();
    expect(within(requisites).queryByRole('button')).toBeNull();
  });

  it('адрес из реестра — в реквизитах и подписан как реестровый', async () => {
    fakeApi(companyRoutes({ withRegistry: true, registryOver: { address: 'Казань, ул. Баумана, 1' } }));
    renderCard();

    const requisites = await screen.findByLabelText('Реквизиты');
    expect(within(requisites).getByText('Адрес в реестре').nextElementSibling?.textContent).toBe('Казань, ул. Баумана, 1');
  });

  it('объект из события виден без выдуманной роли участия', async () => {
    fakeApi(
      replace('GET /api/companies/7/objects', () => ({
        status: 200,
        body: objectsBody([objectRow({ projectId: 56, name: 'ЖК Бадаевский', basis: 'event', roles: [], state: null })]),
      })),
    );
    renderCard('/company/7?tab=objects');

    const card = (await screen.findByRole('link', { name: 'ЖК Бадаевский' })).closest('article')!;
    expect(within(card).getByText('упомянут в событиях, роль не названа')).toBeTruthy();
  });

  it('вкладка «Объекты»: сведения ДОМ.РФ на карточке, объекты застройщика группы «через», фильтры в адресе', async () => {
    fakeApi(
      replace('GET /api/companies/7/objects', () => ({
        status: 200,
        body: objectsBody(
          [
            objectRow({
              projectId: 60,
              name: 'Река',
              roles: [{ role: 'developer', isCurrent: true, origin: 'registry' }],
              via: { companyId: 70, name: 'ООО «СЗ Развитие»' },
              registry: objectRegistry({ hasPhoto: true, photoRef: '71431' }),
              state: null,
            }),
            objectRow(),
          ],
          [{ companyId: 70, name: 'ООО «СЗ Развитие»' }],
        ),
      })),
    );
    const { router } = renderWithRouter(cardRoutes, ['/company/7?tab=objects']);

    const reka = (await screen.findByRole('link', { name: 'Река' })).closest('article')!;
    expect(within(reka).getByText('Строится')).toBeTruthy();
    expect(within(reka).getByText('сдача: IV кв. 2027')).toBeTruthy();
    expect(within(reka).getByText('Москва город, Мосфильмовская ул., д. 70')).toBeTruthy();
    expect(within(reka).getByText('Квартир').nextElementSibling?.textContent).toBe('472');
    expect(within(reka).getByText('ДОМ.РФ · фото и сведения · на 20.09.2026')).toBeTruthy();
    // Фото — с портала, а не с сайта ДОМ.РФ: браузер читателя к третьим сайтам не ходит.
    expect(within(reka).getByRole('img', { name: 'Фото: Река' }).getAttribute('src')).toBe('/api/projects/60/photo?w=640');
    expect(within(reka).getByRole('link', { name: 'ООО «СЗ Развитие»' }).getAttribute('href')).toBe('/company/70');
    expect(screen.getByText(/Вместе с объектами застройщиков группы: ООО «СЗ Развитие»/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Только публикации' }));
    await waitFor(() => expect(router.state.location.search).toContain('osrc=publications'));
    expect(screen.queryByRole('link', { name: 'Река' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Развязка на М-7' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Все' }));
    fireEvent.click(screen.getByRole('button', { name: 'застройщик' }));
    await waitFor(() => expect(router.state.location.search).toContain('orole=developer'));
    expect(screen.getByRole('link', { name: 'Река' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Развязка на М-7' })).toBeNull();

    // Смена вкладки сбрасывает фильтры объектов.
    fireEvent.click(screen.getByRole('tab', { name: 'Подробно' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=details'));
  });

  it('контрагент: вид связи ярлыком, объект словом; цитата грузится только по «Откуда известно»', async () => {
    const api = fakeApi(companyRoutes());
    renderCard();

    const row = (await screen.findByText('ООО «Дорсервис»')).closest('li')!;
    expect(within(row).getByText('договор')).toBeTruthy();
    // Что значит «договор» — одно пояснение под списком, а не кнопка «?» у каждой связи.
    expect(within(screen.getByRole('list', { name: 'Виды связей' })).getByText(/обе стороны названы в одном предложении/)).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'договор' })).toBeNull();
    const objectLink = within(row).getByRole('link', { name: '«Развязка на М-7»' });
    expect(objectLink.parentElement!.textContent).toBe('объект «Развязка на М-7»');
    expect(api.calls.some(c => c.url.startsWith('/api/assertions/'))).toBe(false);

    fireEvent.click(within(row).getByText('Откуда известно'));
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/assertions/101')).toBe(true));
  });

  it('старый сервер без итогов — «—», а не ноль; плитки «Связи» без числа контрагентов нет', async () => {
    fakeApi([
      { match: 'GET /api/companies/7/publication-stats', respond: () => ({ status: 404, body: { error: 'нет маршрута' } }) },
      { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: [] } }) },
      ...companyRoutes(),
    ]);
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    await waitFor(() => expect(within(brief).getByText('Объекты').nextElementSibling?.textContent).toBe('1'));
    await waitFor(() => expect(within(brief).getByText('События').nextElementSibling?.textContent).toBe('0'));
    expect(within(brief).getByText('Публикации').nextElementSibling?.textContent).toBe('—');
    expect(within(brief).queryByText('Связи')).toBeNull();
    // Плитки «Суды» по публикациям нет вовсе: суды — «Арбитраж» (КАД).
    expect(within(brief).queryByText('Суды')).toBeNull();
  });

  it('плитки сводки: число — то же, что у списка, куда ведёт плитка; разбивка и ссылка', async () => {
    fakeApi([
      { match: 'GET /api/companies/7/publication-stats', respond: () => ({ status: 200, body: publicationStats({ total: 14, last90: 4 }) }) },
      { match: 'GET /api/companies/7/partners', respond: () => ({ status: 200, body: { items: manyPartners(3), counts: { companies: 3, contracts: 2, corporate: 1 } } }) },
      {
        match: 'GET /api/companies/7/events',
        respond: () => ({ status: 200, body: { items: [event(), event({ id: 502 })], total: 2, stats: eventStats({ total: 2, dated12m: 2 }) } }),
      },
      ...companyRoutes(),
    ]);
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    const tile = (label: string): HTMLElement => within(brief).getByText(label).closest('div')!;
    await waitFor(() => expect(within(tile('Публикации')).getByText('14')).toBeTruthy());
    expect(within(tile('Публикации')).getByText('за 90 дней — 4 · последняя 30.09.2026')).toBeTruthy();
    await waitFor(() => expect(within(tile('Связи')).getByText('договоров — 2 · корпоративных — 1')).toBeTruthy());
    expect(within(tile('Связи')).getByText('3')).toBeTruthy();
    await waitFor(() => expect(within(tile('События')).getByText('с датой за 12 мес. — 2')).toBeTruthy());
    expect(within(brief).queryByText('Суды')).toBeNull();
    // Строки «показатели на …» нет: числа — на сегодня, теми же наборами, что списки.
    expect(within(brief).queryByText(/показатели на/)).toBeNull();
    // Плитка — строка-ссылка: нажимается целиком.
    expect(tile('Связи').className).toContain('row-link');

    const href = (name: string): string | null => within(brief).getByRole('link', { name }).getAttribute('href');
    expect(href('Все объекты')).toBe('/company/7?tab=objects');
    expect(href('Все события')).toBe('/company/7?tab=details');
    expect(href('Все публикации')).toBe('/company/7?tab=publications');
    expect(href('Все связи')).toBe('/company/7?tab=details&dtab=links');
    // Оценки надёжности в сводке нет (ADR-009).
    expect(within(brief).queryByText(/надёжн.*(высок|низк)|риск/i)).toBeNull();
  });

  it('«Роли, события и тексты»: роли — по объектам вкладки, виды — по списку событий, тексты — по ленте', async () => {
    fakeApi([
      {
        match: 'GET /api/companies/7/events',
        respond: () => ({ status: 200, body: { items: [], total: 3, stats: eventStats({ total: 3, byType: [{ type: 'court_case', count: 3 }] }) } }),
      },
      {
        match: 'GET /api/companies/7/publication-stats',
        respond: () => ({ status: 200, body: publicationStats({ completeness: {}, families: { total: 0, established: 0, named: 0, unknown: 0 } }) }),
      },
      ...companyRoutes(),
    ]);
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Роли, события и тексты' })).closest('section')!;
    const roles = await within(section).findByRole('list', { name: 'Роли на объектах' });
    // Порядок — как у сервера: по числу объектов, при равенстве — по роли.
    expect(within(roles).getAllByRole('listitem').map(li => li.textContent)).toEqual(['заказчик1', 'генподрядчик1']);
    expect(within(section).getByText(/из 1 объекта компании/)).toBeTruthy();
    const events = await within(section).findByRole('list', { name: 'События по видам' });
    expect(within(events).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Судебное дело3']);
    // Судебных разбивок по публикациям нет: суды — «Суды, ФССП и банкротство» (КАД).
    expect(within(section).queryByRole('list', { name: 'Роль в судебных делах' })).toBeNull();
    expect(within(section).getByText('Нет данных: полнота текстов, происхождение текстов.')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Все события' }).getAttribute('href')).toBe('/company/7?tab=details');
  });

  it('публикации и события по месяцам: ряды ленты и списка событий, что не вошло — словами', async () => {
    fakeApi([
      {
        match: 'GET /api/companies/7/publication-stats',
        respond: () => ({ status: 200, body: publicationStats({ total: 13, byMonth: monthSeries([3, 0, 5, 2], { undated: 2, beforeWindow: 1 }) as never }) }),
      },
      {
        match: 'GET /api/companies/7/events',
        respond: () => ({ status: 200, body: { items: [], total: 3, stats: eventStats({ total: 3, byMonth: monthSeries([1, 0, 1], { coarse: 1 }) as never }) } }),
      },
      ...companyRoutes(),
    ]);
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Публикации и события по месяцам' })).closest('section')!;
    const charts = await within(section).findAllByRole('img');
    expect(charts).toHaveLength(2);
    expect(charts[0]!.getAttribute('aria-label')).toMatch(/^Публикации, ноябрь 2024 — октябрь 2026: всего 10\sпубликаций, больше всего — сентябрь 2026 \(5\)/);
    expect(within(section).getByText('учтено 10 из 13 публикаций; не вошли: 1 раньше начала ряда, 2 без даты')).toBeTruthy();
    expect(within(section).getByText('учтено 2 из 3 событий; не вошли: 1 с датой до квартала или года')).toBeTruthy();
    expect(within(section).queryByRole('table')).toBeNull();
    // Мини-график в плитке «Публикации» — только форма, диктору не читается.
    const brief = screen.getByRole('heading', { name: 'Коротко о компании' }).closest('section')!;
    const tile = within(brief).getByText('Публикации').closest('div')!;
    expect(tile.querySelector('[aria-hidden="true"] > span')).toBeTruthy();
  });

  it('старый сервер без рядов — блока по месяцам нет, ничего не досчитывается', async () => {
    fakeApi([
      { match: 'GET /api/companies/7/publication-stats', respond: () => ({ status: 404, body: { error: 'нет маршрута' } }) },
      { match: 'GET /api/companies/7/events', respond: () => ({ status: 200, body: { items: [] } }) },
      ...companyRoutes(),
    ]);
    renderCard();
    await screen.findByRole('heading', { name: 'Коротко о компании' });
    await waitFor(() => expect(screen.getByText('События').nextElementSibling?.textContent).toBe('0'));
    expect(screen.queryByRole('heading', { name: 'Публикации и события по месяцам' })).toBeNull();
  });

  it('запись застройщика в реестре — разделом «Сведений»; плитки «Реестр» нет (она обрезала число объектов на 50)', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    expect(within(brief).queryByText('Реестр')).toBeNull();
    const registry = screen.getByRole('heading', { name: 'Застройщик в реестре ДОМ.РФ' }).closest('section')!;
    expect(registry.id).toBe('company-registry');
    expect(within(registry).getByText(/Запись застройщика: Единый реестр, № 123/)).toBeTruthy();
    // Застройщик — сама компания: её ИНН уже в реквизитах шапки, карточка реестра его не повторяет.
    const card = within(registry).getByText('Сведения реестра о застройщике').closest('details')!;
    expect(card.open).toBe(false);
    expect(within(registry).queryByText('1655000000')).toBeNull();
    expect(within(screen.getByLabelText('Реквизиты')).getByText('1655000000')).toBeTruthy();
    // Атрибуция реестра — одна, в «Источниках и датах» внизу вкладки, а не плашкой в разделе.
    expect(within(registry).queryByText('По сведениям проектной декларации')).toBeNull();
    const sources = screen.getByRole('heading', { name: 'Источники и даты' }).closest('section')!;
    expect(within(sources).getByText(/По сведениям проектной декларации: Единый реестр, запись 123/)).toBeTruthy();
  });

  it('итоги ДОМ.РФ — один блок «Сроки и продажи»: статусы домов и сдача по годам полосами, портфеля по объектам нет', async () => {
    fakeApi(
      replace('GET /api/companies/7/delivery', () => ({
        status: 200,
        body: deliveryBody({
          houses: 3,
          inProgress: { count: 2, apartments: 800 },
          unparsed: { completion: 1, apartments: 0 },
          statuses: [
            { label: 'Строится', count: 2 },
            { label: 'Сдан', count: 1 },
          ],
          completionByYear: [{ year: 2027, count: 1 }],
          list: [deliveryHouse('1'), deliveryHouse('2'), deliveryHouse('3', { status: 'Сдан', delivered: true })],
        }),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Сроки и продажи — ДОМ.РФ' })).closest('section')!;
    const statuses = within(section).getByRole('list', { name: 'Статус домов' });
    expect(within(statuses).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Строится2', 'Сдан1']);
    expect(within(section).getByRole('list', { name: 'Сдача строящихся по годам' })).toBeTruthy();
    expect(within(section).getByText(/срок не распознан — 1/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Объекты по данным ДОМ.РФ' })).toBeNull();
  });

  it('кто строит для компании: строка — имя, роль, число объектов; подробности окном; без карточки — «Добавить компанию», не уход на поиск; плитка сводки', async () => {
    fakeApi(
      replace('GET /api/companies/7/builders', () => ({
        status: 200,
        body: buildersBody({
          objects: { customerSide: 2, withRegistry: 1, withRegistryContractor: 1, truncated: false },
          items: [
            {
              key: 'company:10',
              name: 'СУ-10',
              inn: '7736255508',
              company: { id: 10, name: 'СУ-10' },
              match: 'identifier',
              registryNames: ['ООО СУ-10'],
              inGroup: false,
              roles: ['general_contractor'],
              sources: ['registry', 'publications'],
              objects: [
                { projectId: 60, name: 'Река', role: 'general_contractor', sources: ['registry'], isCurrent: true, registryAsOf: '2026-09-30', registryFetchedAt: '2026-10-02T08:00:00Z', lastPublication: null, mentions: null },
                { projectId: 61, name: 'Парк', role: 'general_contractor', sources: ['publications'], isCurrent: true, registryAsOf: null, lastPublication: '2026-10-01T10:00:00Z', mentions: 3 },
              ],
              lastSeen: '2026-10-01T10:00:00Z',
            },
            {
              key: 'inn:7704412966',
              name: 'ООО Новый',
              inn: '7704412966',
              company: null,
              match: null,
              registryNames: ['ООО Новый'],
              inGroup: false,
              roles: ['general_contractor'],
              sources: ['registry'],
              objects: [{ projectId: 60, name: 'Река', role: 'general_contractor', sources: ['registry'], isCurrent: true, registryAsOf: null, lastPublication: null, mentions: null }],
              lastSeen: null,
            },
          ],
        }),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Кто строит для компании' })).closest('section')!;
    expect(within(section).getByRole('link', { name: 'СУ-10' }).getAttribute('href')).toBe('/company/10');
    expect(within(section).getByText('на 2 объектах')).toBeTruthy();
    expect(within(section).getByText('на 1 объекте · карточки в портале нет')).toBeTruthy();
    // В строке — ни ИНН, ни объектов, ни источников: всё это окном.
    expect(within(section).queryByText(/7736255508/)).toBeNull();
    expect(within(section).queryByRole('link', { name: '«Река»' })).toBeNull();
    expect(within(section).queryByRole('link', { name: 'Найти по ИНН' })).toBeNull();

    fireEvent.click(within(section).getByRole('button', { name: 'Подробнее: СУ-10' }));
    let dialog = screen.getByRole('dialog', { name: 'СУ-10' });
    expect(within(dialog).getByText('найдена по ИНН из ДОМ.РФ')).toBeTruthy();
    expect(within(dialog).getByText('ООО СУ-10')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Объекты — 2' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: '«Река»' }).getAttribute('href')).toBe('/projects/60');
    expect(within(dialog).getByText('ДОМ.РФ — сведения на 30.09.2026, прочитано 02.10.2026')).toBeTruthy();
    expect(within(dialog).getByText('Публикации: 3, последняя 01.10.2026')).toBeTruthy();
    expect(within(dialog).getByText(/не проверенный договор/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Карточка компании' }).getAttribute('href')).toBe('/company/10');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(within(section).getByRole('button', { name: 'Подробнее: ООО Новый' }));
    dialog = await screen.findByRole('dialog', { name: 'ООО Новый' });
    expect(within(dialog).getByText('В портале нет компании с ИНН 7704412966')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Добавить компанию' })).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: 'Карточка компании' })).toBeNull();

    const tile = screen.getByText('Генподрядчики').closest('div')!;
    expect(within(tile).getByText('2')).toBeTruthy();
    expect(within(tile).getByText('СУ-10, ООО Новый')).toBeTruthy();
  });

  it('финансы: последний год сеткой с прошлым годом, все годы — таблицей по раскрытию, налоги ФНС; плитка «Выручка»', async () => {
    fakeApi(
      replace('GET /api/companies/7/finance', () => ({
        status: 200,
        body: financeBody({
          inn: '7702336269',
          problem: null,
          finance: {
            state: datasetState('finance'),
            view: { format: 'finance-map@1', recognized: true, problems: [], unit: 'RUB', years: [financeYear(2025, 11_053_475_000, 3_886_099_000), financeYear(2024, 17_920_625_000, -4_698_650_000)] },
          },
          tax: {
            state: datasetState('tax'),
            view: {
              format: 'tax-map@2',
              recognized: true,
              problems: [],
              unit: 'RUB',
              headcount: [{ year: 2025, count: 65 }, { year: 2024, count: 31 }],
              incomeExpenses: [],
              taxesPaid: [{ year: 2025, total: 585_814_996, lines: 12 }],
              arrears: { year: 2026, period: 5, total: 119_207_438, arrear: 99_118_924, penalty: 20_088_514, fine: 0, items: [{ name: 'Налог на прибыль', total: 72_223_124 }] },
              arrearsHistory: [],
              flags: { bailiffDebt: false, noReporting: false, asOf: '2026-09-01' },
              taxModes: [],
              msp: null,
              status: 'Действующая организация',
              offenses: [{ year: 2024, fine: 15_000 }],
              people: { directors: [{ name: 'ИВАНОВ ИВАН ИВАНОВИЧ', position: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР', companies: 7 }], owners: [] },
            },
          },
        }),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Финансы и налоги' })).closest('section')!;
    expect(within(section).getByText('отчётность за 2024–2025 · проверено 06.10.2026')).toBeTruthy();
    // Подпись в сетке — dt; та же подпись есть и в таблице под раскрытием.
    const fact = (label: string) => within(section).getAllByText(label).find(n => n.tagName === 'DT')!.closest('div')!;
    const revenue = fact('Выручка');
    expect(revenue.textContent?.replace(/\s+/g, ' ')).toBe('Выручка11,1 млрд ₽в 2024 — 17,9 млрд ₽');
    // Убыток — со знаком минус, без цвета и слов «падение».
    expect(fact('Чистая прибыль (убыток)').textContent).toMatch(/в 2024 — [−-]4,7\sмлрд\s₽/);
    expect(within(section).getByText('65 чел. в 2025; в 2024 — 31')).toBeTruthy();
    expect(within(section).getByText(/недоимка 99,1 млн ₽ · пени 20,1 млн ₽ · штрафы 0 ₽/)).toBeTruthy();
    // Долг перед приставами — в блоке ФССП, а не признаком ФНС: остаётся одно «нет» (отчётность сдаётся).
    expect(within(section).getAllByText('нет')).toHaveLength(1);
    expect(within(section).queryByText(/приставами/)).toBeNull();
    // tax-map@2: правонарушения и число юрлиц руководителя — словами ФНС. Кто руководитель и статус — в ЕГРЮЛ,
    // ФНС их не повторяет.
    expect(within(section).getByText(/^2024 — штрафы 15\s?000\s₽$/)).toBeTruthy();
    expect(within(section).getByText('руководитель — в 7 юрлицах, считая эту')).toBeTruthy();
    expect(within(section).queryByText(/ИВАНОВ ИВАН/)).toBeNull();
    expect(within(section).queryByText('Статус по ФНС')).toBeNull();
    // Таблица по годам — под раскрытием, со ссылкой на PDF отчёта.
    fireEvent.click(within(section).getByText('Все годы — 2'));
    const pdf = within(section).getAllByRole('link', { name: 'PDF' });
    expect(pdf[0]!.getAttribute('href')).toBe('https://bo.nalog.gov.ru/download/bfo/pdf/2025');
    expect(within(section).getByText(/· с аудитом/)).toBeTruthy();
    // Плитка сводки и строка источника.
    const tile = screen.getAllByText('Выручка').map(n => n.closest('div')!).find(d => d.className.includes('tile'))!;
    expect(tile.textContent).toContain('за 2025');
    expect(screen.getByText(/Бухгалтерская отчётность — ГИР БО ФНС/)).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Обновить' })).toBeTruthy();
  });

  it('финансы: не запрашивалось — словами, «Запросить» — только оператору; без ИНН блока нет', async () => {
    const notChecked = financeBody({
      inn: '7702336269',
      problem: null,
      finance: { state: datasetState('finance', { outcome: null, checkedAt: null, record: null }), view: null },
      tax: { state: datasetState('tax', { outcome: null, checkedAt: null, record: null }), view: null },
    });
    fakeApi(replace('GET /api/companies/7/finance', () => ({ status: 200, body: notChecked })));
    const { unmount } = renderWithProviders(
      <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => p === 'portal.read' }}>
        <Routes>
          <Route path="/company/:id" element={<CompanyPage />} />
        </Routes>
      </AuthContext.Provider>,
      '/company/7',
    );
    const section = (await screen.findByRole('heading', { name: 'Финансы и налоги' })).closest('section')!;
    expect(within(section).getByText('Отчётность ГИР БО: не запрашивалось.')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Запросить' })).toBeNull();
    unmount();

    fakeApi(companyRoutes());
    renderCard();
    await screen.findByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус', level: 2 });
    expect(screen.queryByRole('heading', { name: 'Финансы и налоги' })).toBeNull();
  });

  it('суды, ФССП, банкротство: роли и виды дел, ссылка на карточку дела; ФССП словами ФССП; ЕФРСБ — записей нет; плитки', async () => {
    const caseRow = (n: number, date: string, type: 'economic' | 'bankruptcy', role: 'respondent' | 'plaintiff') => ({
      id: `${n}1111111-2222-3333-4444-555555555555`,
      number: `А40-${n}/2026`,
      startDate: date,
      court: 'АС города Москвы',
      type,
      roles: [role],
      counterparties: ['ДГИ Москвы'],
      counterpartiesTotal: 1,
      url: `https://kad.arbitr.ru/Card/${n}1111111-2222-3333-4444-555555555555`,
      claim: n === 2 ? { fetchedAt: '2026-10-06T09:00:00Z', recognized: true, amount: 1_250_000, latest: 2_000_000 } : n === 4 ? { fetchedAt: '2026-10-06T09:00:00Z', recognized: true, amount: null, latest: null } : null,
    });
    fakeApi(
      replace('GET /api/companies/7/registry-checks', () => ({
        status: 200,
        body: checksBody({
          inn: '7702336269',
          problem: null,
          courts: {
            state: datasetState('courts'),
            view: {
              format: 'courts-map@1',
              recognized: true,
              problems: [],
              window: { from: '2024-10-01' },
              complete: true,
              total: 6,
              byRole: { respondent: 4, plaintiff: 2, third: 0, other: 0, unknown: 0 },
              byType: { economic: 5, administrative: 0, bankruptcy: 1, unknown: 0 },
              last12m: { from: '2025-10-06', total: 3, respondent: 2, plaintiff: 1 },
              cases: [1, 2, 3, 4, 5, 6].map(n => caseRow(n, `2026-0${n}-01`, n === 1 ? 'bankruptcy' : 'economic', n % 3 === 0 ? 'plaintiff' : 'respondent')),
              claims: { wanted: 3, fetched: 2, withAmount: 1 },
            },
          },
          claimsFetching: true,
          fssp: {
            state: datasetState('fssp'),
            view: {
              format: 'fssp-map@1',
              recognized: true,
              problems: [],
              totalRows: 678,
              loaded: 678,
              complete: true,
              open: { count: 677, debt: 431_164_180, remaining: 423_787_007, remainingCovered: 652, fee: 7_377_174 },
              ended: {
                count: 3,
                byReason: [
                  { reason: 'ст. 47 ч. 1 п. 7', meaning: 'bankruptcy', count: 2, debt: 500, debtCovered: 2 },
                  { reason: 'ст. 46 ч. 1 п. 3', meaning: 'not_found', count: 1, debt: 1_200_000, debtCovered: 1 },
                ],
                byMeaning: [
                  { meaning: 'bankruptcy', count: 2, debt: 500, debtCovered: 2 },
                  { meaning: 'not_found', count: 1, debt: 1_200_000, debtCovered: 1 },
                ],
                uncollected: { count: 1, debt: 1_200_000, debtCovered: 1 },
              },
              unknownStatus: 0,
              openedByYear: [{ year: 2026, count: 191 }, { year: 2025, count: 419 }],
              last12m: { from: '2025-10-06', count: 248 },
              bySubject: [{ subject: 'Иные взыскания в пользу физлиц', count: 620 }],
              recent: [],
            },
          },
          bankruptcy: { state: datasetState('bankruptcy', { outcome: 'not_found' }), view: efrsbView({ found: false, record: null }) },
        }),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Суды, ФССП и банкротство' })).closest('section')!;
    expect(within(section).getByText('6 — ответчик 4, истец 2')).toBeTruthy();
    expect(within(section).getByText('3 — ответчик 2, истец 1')).toBeTruthy();
    expect(within(section).getByText('экономический спор — 5, о банкротстве — 1')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'А40-1/2026' }).getAttribute('href')).toBe('https://kad.arbitr.ru/Card/11111111-2222-3333-4444-555555555555');
    // Пять дел сразу, шестое — под раскрытием.
    expect(within(section).getByText('Остальные дела — 1')).toBeTruthy();
    expect(within(section).getByText(/Роль в деле о банкротстве не говорит, чьё это банкротство/)).toBeTruthy();
    // Сумма иска — из карточки дела, подписана как иск; нет суммы — словами, а не 0 ₽; покрытие — «у K из N».
    expect(within(section).getByText(/иск 1,3 млн ₽, позже в карточке 2 млн ₽/)).toBeTruthy();
    expect(within(section).getByText(/сумма иска в карточке не указана/)).toBeTruthy();
    expect(
      within(section).getByText('получены у 2 из 3 дел, где компания — ответчик в экономическом споре; в 1 сумма не указана; запрашиваются сейчас'),
    ).toBeTruthy();
    expect(within(section).getByText('677 — сумма долга по документам 431,2 млн ₽')).toBeTruthy();
    expect(within(section).getByText('423,8 млн ₽ — указан у 652 из 677')).toBeTruthy();
    expect(
      within(section).getByText(
        '3 — должник признан банкротом — документ передан арбитражному управляющему: 2; возвращено без взыскания: не найдены должник, имущество или счета: 1',
      ),
    ).toBeTruthy();
    expect(within(section).getByText('1 — сумма долга 1,2 млн ₽, указана у 1 из 1')).toBeTruthy();
    expect(within(section).getByText(/Записей о компании в ЕФРСБ нет · проверено 06\.10\.2026/)).toBeTruthy();
    // «Записей нет» — не «рисков нет»: намерения кредиторов на fedresurs.ru портал не проверяет.
    expect(within(section).getByText(/Намерения кредиторов обратиться в суд .* портал их не проверяет/)).toBeTruthy();
    // Плитки сводки.
    const tile = (label: string) => screen.getAllByText(label).map(n => n.closest('div')!).find(d => d.className.includes('tile'))!;
    expect(tile('Арбитраж').textContent).toContain('ответчик');
    expect(tile('ФССП').textContent).toContain('остаток 423,8');
    expect(screen.getByText(/Картотека арбитражных дел \(kad\.arbitr\.ru\)/)).toBeTruthy();
  });

  it('ЕФРСБ: процедура по последнему акту словами реестра, продление — строкой «позже»; старый снимок — «не запрашивались»', async () => {
    const act = (id: string, date: string, text: string, effect: 'competition' | 'procedural' | 'observation') =>
      ({ messageId: id, date, act: text, effect, caseNumber: 'А40-1/2025', annulled: false });
    const competition = act('M2', '2026-02-01', 'о признании должника банкротом и открытии конкурсного производства', 'competition');
    const prolonged = act('M4', '2026-04-01', 'о продлении срока процедуры', 'procedural');
    fakeApi(
      replace('GET /api/companies/7/registry-checks', () => ({
        status: 200,
        body: checksBody({
          inn: '7702336269',
          problem: null,
          courts: { state: datasetState('courts', { outcome: null, checkedAt: null, record: null }), view: null },
          fssp: { state: datasetState('fssp', { outcome: null, checkedAt: null, record: null }), view: null },
          bankruptcy: {
            state: datasetState('bankruptcy'),
            view: efrsbView({
              messages: {
                total: 12,
                loaded: 12,
                complete: true,
                first: '2025-12-15',
                last: '2026-05-01',
                annulled: 1,
                byKind: [{ kind: 'meeting', count: 7 }, { kind: 'court_act', count: 4 }],
                otherTypes: [],
                recent: [{ id: 'M5', date: '2026-05-01', type: 'Сообщение о собрании кредиторов', kind: 'meeting', annulled: false }],
              },
              courtActs: [prolonged, competition, act('M1', '2026-01-01', 'о введении наблюдения', 'observation')],
              courtActsCoverage: { listed: 4, fetched: 3 },
              procedureAct: competition,
              laterAct: prolonged,
              caseNumbers: ['А40-1/2025'],
            }),
          },
        }),
      })),
    );
    renderCard();
    const section = (await screen.findByRole('heading', { name: 'Суды, ФССП и банкротство' })).closest('section')!;
    // Строка сводки (dd) и та же строка в списке актов под раскрытием.
    const procedure = within(section).getAllByText(/«о признании должника банкротом и открытии конкурсного производства» — 01\.02\.2026 — дело А40-1\/2025/);
    expect(procedure[0]!.closest('dd')).toBeTruthy();
    expect(within(section).getByText('позже: «о продлении срока процедуры» — 01.04.2026 — дело А40-1/2025')).toBeTruthy();
    expect(within(section).getByText('получены у 3 из 4 — остальные следующей проверкой')).toBeTruthy();
    expect(within(section).getByText('12 — с 15.12.2025 по 01.05.2026; аннулировано 1')).toBeTruthy();
    expect(within(section).getByText('о собраниях — 7; о судебных актах — 4')).toBeTruthy();
    expect(within(section).getByText('Судебные акты — 3')).toBeTruthy();
    // Оценки нет: слова реестра, без «риска».
    expect(section.textContent).not.toMatch(/риск/i);
  });

  it('ЕФРСБ: снимок без сообщений (до bankruptcy-map@2) — сказано, что они не запрашивались', async () => {
    fakeApi(
      replace('GET /api/companies/7/registry-checks', () => ({
        status: 200,
        body: checksBody({
          inn: '7702336269',
          problem: null,
          courts: { state: datasetState('courts', { outcome: null, checkedAt: null, record: null }), view: null },
          fssp: { state: datasetState('fssp', { outcome: null, checkedAt: null, record: null }), view: null },
          bankruptcy: { state: datasetState('bankruptcy'), view: efrsbView() },
        }),
      })),
    );
    renderCard();
    const section = (await screen.findByRole('heading', { name: 'Суды, ФССП и банкротство' })).closest('section')!;
    expect(within(section).getByText(/Компания есть в ЕФРСБ: Обычная организация, г\. Москва\. Сообщения должника в этом снимке не запрашивались/)).toBeTruthy();
  });

  it('суды, ФССП, банкротство: сбой ФССП — причина и повтор словами; без ИНН блока нет', async () => {
    fakeApi(
      replace('GET /api/companies/7/registry-checks', () => ({
        status: 200,
        body: checksBody({
          inn: '7702336269',
          problem: null,
          courts: { state: datasetState('courts', { outcome: null, checkedAt: null, record: null }), view: null },
          fssp: { state: datasetState('fssp', { outcome: null, checkedAt: null, record: null, attemptCount: 1, lastError: 'fssp_ur: network — timeout' }), view: null },
          bankruptcy: { state: datasetState('bankruptcy', { outcome: null, checkedAt: null, record: null }), view: null },
        }),
      })),
    );
    renderCard();
    const section = (await screen.findByRole('heading', { name: 'Суды, ФССП и банкротство' })).closest('section')!;
    expect(within(section).getByText('Картотека дел: не запрашивалось.')).toBeTruthy();
    expect(within(section).getByText('Сведения ФССП: запрос не удался')).toBeTruthy();
    expect(within(section).getByText(/fssp_ur: network — timeout/)).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Обновить' })).toBeTruthy();
  });

  it('сроки и продажи ДОМ.РФ: по домам — строится, сдано за 24 месяца, срок по декларации прошёл, переносы, продажи; плитка', async () => {
    const late = deliveryHouse('101', { completion: 'II кв. 2026', pastDue: true });
    fakeApi(
      replace('GET /api/companies/7/delivery', () => ({
        status: 200,
        body: deliveryBody({
          observedSince: '2026-09-21',
          houses: 4,
          inProgress: { count: 2, apartments: 800 },
          delivered: { recent: 1, recentApartments: 300, older: 1, windowFrom: '2024-10-06' },
          pastDue: [late],
          shifts: [{ externalRef: '102', name: 'Дом 102', from: 'III кв. 2027', to: 'I кв. 2028', at: '2026-10-01', direction: 'later' }],
          sales: { apartments: 800, share: 0.55, counted: 2, price: { min: 400_000, max: 600_000, counted: 2 } },
          list: [late, deliveryHouse('102')],
        }),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Сроки и продажи — ДОМ.РФ' })).closest('section')!;
    expect(within(section).getByText('2 дома — 800 квартир')).toBeTruthy();
    expect(within(section).getByText('1 дом — 300 квартир; раньше — 1')).toBeTruthy();
    expect(within(section).getByText('1 дом — список ниже')).toBeTruthy();
    expect(within(section).getByText(/Дом 102: III кв\. 2027 → I кв\. 2028 \(позже\), снимок 01\.10\.2026/)).toBeTruthy();
    expect(within(section).getByText(/55\s?% — по 2 домам, 800 квартир/)).toBeTruthy();
    expect(within(section).getByText('появятся, когда между снимками дома пройдёт 30 дней')).toBeTruthy();
    expect(within(section).getAllByRole('link', { name: 'Дом 101' })[0]!.getAttribute('href')).toContain('/объект/101');
    // Слов «просрочка» и «риск» нет — только факт реестра.
    expect(section.textContent).not.toMatch(/просроч|риск/i);
    const tile = screen.getAllByText('Стройка').map(n => n.closest('div')!).find(d => d.className.includes('tile'))!;
    expect(tile.textContent).toMatch(/срок прошёл\s—\s1/);
  });

  it('кто строит для компании: компания нигде не заказчик — ни блока, ни плитки', async () => {
    fakeApi(companyRoutes());
    renderCard();

    await screen.findByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус', level: 2 });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Кто строит для компании' })).toBeNull());
    expect(screen.queryByText('Генподрядчики')).toBeNull();
  });

  it('шапка: роли на своих объектах — ярлыками; оговорка «не оценка» — одна на вкладку', async () => {
    fakeApi(companyRoutes());
    renderCard();

    const badges = await screen.findByRole('list', { name: 'Статус и роли на своих объектах' });
    expect(within(badges).getByText('генподрядчик · 1')).toBeTruthy();
    expect(within(badges).getByText('заказчик · 1')).toBeTruthy();
    expect(await screen.findAllByText(/не оценка надёжности/)).toHaveLength(1);
  });

  it('контрагенты: первые шесть, «Показать ещё»; полный ответ сервера — «Все связи» схемой в окне', async () => {
    fakeApi(replace('GET /api/companies/7/partners', () => ({ status: 200, body: { items: manyPartners(12) } })));
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'С кем связана' })).closest('section')!;
    await within(section).findByRole('link', { name: 'ООО «Партнёр 1»' });
    expect(within(section).queryByRole('link', { name: 'ООО «Партнёр 7»' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Все связи' }).getAttribute('aria-haspopup')).toBe('dialog');

    fireEvent.click(within(section).getByRole('button', { name: 'Показать ещё 6' }));
    expect(within(section).getByRole('link', { name: 'ООО «Партнёр 12»' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Показать ещё/ })).toBeNull();
    expect(within(section).getByText(/остальные на схеме связей/)).toBeTruthy();
  });

  it('событие — строкой «что, когда, где»; нажатие открывает окно: объект ссылкой, цитата и источник', async () => {
    fakeApi(
      replace('GET /api/companies/7/events', () => ({
        status: 200,
        body: { items: [event({ id: 501, quote: 'Подряд на развязку передан другой фирме', url: 'https://t.me/stroi_news/501', sourceTitle: 'Стройки — и точка', sourceKey: 'stroi_news', sourceKind: 'telegram' })] },
      })),
    );
    renderCard('/company/7?tab=details');

    const list = await screen.findByRole('list', { name: 'События компании' });
    const row = within(list).getByRole('button', { name: /Развязка на М-7 · Стройки — и точка/ });
    // В строке — ни ссылок, ни цитаты: подробности — окном.
    expect(within(list).queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Подряд на развязку передан/)).toBeNull();

    fireEvent.click(row);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Развязка на М-7' }).getAttribute('href')).toBe('/projects/55');
    expect(within(dialog).getByText('«Подряд на развязку передан другой фирме»')).toBeTruthy();
    const source = within(dialog).getByRole('link', { name: /Стройки — и точка/ });
    expect(source.getAttribute('href')).toBe('https://t.me/stroi_news/501');
    expect(source.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('похожие компании — одной строкой на «Сведениях» и не занимают место читалки', async () => {
    fakeApi(replace('GET /api/companies/7/similar', () => ({ status: 200, body: { items: [{ id: 8, name: 'Мостострой-2', city: null }] } })));
    renderCard();

    expect(await screen.findByText(/Похожие компании — возможно, это она же/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Мостострой-2' }).getAttribute('href')).toBe('/company/8');
    fireEvent.click(screen.getByRole('tab', { name: 'Публикации' }));
    expect(await screen.findByText('Полный текст первого поста.')).toBeTruthy();
    expect(screen.queryByText(/Похожие компании/)).toBeNull();
  });

  it('вкладка «Публикации»: список и пост рядом; сведения о компании — строкой в списке и ссылками под постом', async () => {
    fakeApi(companyRoutes());
    renderCard();
    fireEvent.click(await screen.findByRole('tab', { name: 'Публикации' }));

    expect(await screen.findByText('Подряд на развязку передан другой фирме')).toBeTruthy();
    expect(await screen.findByText('Полный текст первого поста.')).toBeTruthy();
    expect(screen.getByText('генподрядчик · Развязка на М-7')).toBeTruthy();
    expect(screen.queryByText(/упоминание/)).toBeNull();
    const facts = screen.getByRole('heading', { name: 'Что сказано о компании' }).closest('section')!;
    expect(within(facts).getByRole('link', { name: 'Развязка на М-7' }).getAttribute('href')).toBe('/projects/55');
  });

  it('нажатие в любое место карточки публикации открывает её пост', async () => {
    fakeApi(companyRoutes());
    renderCard('/company/7?tab=publications');
    await screen.findByText('Полный текст первого поста.');

    // Нажимаем не на заголовок, а на выдержку второй карточки.
    fireEvent.click(screen.getByText('Второй пост'));
    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
  });

  it('вкладка и пост — в адресе: ссылка открывает их, «Назад» возвращает прежнюю вкладку', async () => {
    fakeApi(companyRoutes());
    const { router } = renderWithRouter(cardRoutes, ['/company/7?tab=publications&post=12']);

    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Публикации' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Подробно' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=details'));
    expect(await screen.findByRole('tablist', { name: 'Подробно о компании' })).toBeTruthy();

    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.search).toBe('?tab=publications&post=12'));
    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
  });

  it('на телефоне пост вместо списка: «К списку» закрывает его шагом назад и возвращает фокус на карточку', async () => {
    phone();
    fakeApi(companyRoutes());
    const { router } = renderWithRouter(cardRoutes, ['/company/7?tab=publications']);

    fireEvent.click(await screen.findByText('Второй пост'));
    await waitFor(() => expect(router.state.location.search).toContain('post=12'));
    expect(await screen.findByText('Полный текст второго поста.')).toBeTruthy();
    expect(document.querySelector('[data-hide-backbar]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'К списку' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=publications'));
    // Шаг назад по истории, а не новая запись: «Назад» после этого не откроет пост снова.
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Второй пост'));
  });

  it('«Подробно»: вкладки «События · Участие и связи» в адресе; опознания, резюме, схемы и «Показателей» нет', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    const { router } = renderWithRouter(cardRoutes, ['/company/7?tab=details']);

    const tabs = await screen.findByRole('tablist', { name: 'Подробно о компании' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['События', 'Участие и связи']);
    expect(await screen.findByText('В собранных публикациях событий компании не найдено.')).toBeTruthy();
    for (const name of ['Опознание', 'Резюме и противоречия', 'Схема связей', 'ЕГРЮЛ — Контур.Фокус']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Участие и связи' }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=details&dtab=links'));
    expect(router.state.historyAction).toBe('PUSH');
    expect(await screen.findByText('Нужна проверка')).toBeTruthy();
    expect(screen.getByText(/противоречие источников — 1/)).toBeTruthy();
    // В «Проверку» ведёт только тем, кому доступна админка.
    expect(screen.getByRole('link', { name: 'Открыть «Проверку»' }).getAttribute('href')).toBe('/admin/review');
    // Объекты — те же, что вкладка «Объекты»; договор — тот же контрагент, что «С кем связана».
    const objects = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    expect(within(objects).getByRole('link', { name: 'Развязка на М-7' })).toBeTruthy();
    const contracts = screen.getByRole('heading', { name: 'Договоры' }).closest('section')!;
    expect(within(contracts).getByRole('link', { name: 'ООО «Дорсервис»' }).closest('li')!.textContent).toContain('субподрядчик, Развязка на М-7');

    // Смена вкладки карточки сбрасывает вкладку «Подробно».
    fireEvent.click(screen.getByRole('tab', { name: 'Сведения' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('«Участие и связи»: объект и роль строкой; «Откуда известно» и «Контекст объекта» — окнами, грузятся по нажатию', async () => {
    const api = fakeApi([
      {
        match: 'GET /api/companies/7/context',
        respond: () => ({
          status: 200,
          body: { cutoff: '2026-10-01T12:00:00Z', participations: [], projectEvents: [], currentState: [], note: 'Событие объекта — контекст участия.' },
        }),
      },
      ...replace('GET /api/companies/7/objects', () => ({
        status: 200,
        body: objectsBody([objectRow({ roles: [{ role: 'general_contractor', isCurrent: true, origin: 'published', assertionIds: [301] }] })]),
      })),
    ]);
    renderCard('/company/7?tab=details&dtab=links');

    const objects = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    const row = (await within(objects).findByRole('link', { name: 'Развязка на М-7' })).closest('li')!;
    expect(row.textContent).toContain('генподрядчик');
    expect(api.calls.some(c => c.url.startsWith('/api/assertions/') || c.url.includes('/context'))).toBe(false);

    fireEvent.click(within(row).getByRole('button', { name: 'Откуда известно' }));
    expect(screen.getByRole('dialog', { name: 'Откуда известно' })).toBeTruthy();
    await waitFor(() => expect(api.calls.some(c => c.url === '/api/assertions/301')).toBe(true));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Откуда известно' })).getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(within(row).getByRole('button', { name: 'Контекст объекта' }));
    const context = screen.getByRole('dialog', { name: 'Объект «Развязка на М-7»' });
    expect(await within(context).findByText('Событий объекта в собранных публикациях не найдено.')).toBeTruthy();
    expect(within(context).getByRole('link', { name: 'Карточка объекта' }).getAttribute('href')).toBe('/projects/55');
  });

  it('старый адрес «Показателей» (?dtab=numbers) открывает «События»: вкладки снимка больше нет', async () => {
    fakeApi(companyRoutes());
    renderCard('/company/7?tab=details&dtab=numbers');
    const tabs = await screen.findByRole('tablist', { name: 'Подробно о компании' });
    expect(within(tabs).getByRole('tab', { name: 'События' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('heading', { name: 'Объекты и роли' })).toBeNull();
  });

  it('читателю «Подробно» не предлагает ссылок в админку', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderWithProviders(
      <AuthContext.Provider value={{ ...LOCAL_AUTH, can: permission => permission === 'portal.read' }}>
        <Routes>
          <Route path="/company/:id" element={<CompanyPage />} />
        </Routes>
      </AuthContext.Provider>,
      '/company/7?tab=details&dtab=links',
    );

    expect(await screen.findByText('Нужна проверка')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Открыть «Проверку»' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Проверк/ })).toBeNull();
  });

  it('ошибка сервера — не «Компания не найдена»: причина и «Повторить»', async () => {
    fakeApi(replace('GET /api/companies/7', () => ({ status: 500, body: { error: 'база недоступна' } })));
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'Не удалось загрузить компанию' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Сбой сервера (500)');
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByText('Компания не найдена')).toBeNull();
  });

  it('404 — «Компания не найдена» и путь к компаниям', async () => {
    fakeApi(replace('GET /api/companies/7', () => ({ status: 404, body: { error: 'not found' } })));
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'Компания не найдена' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К компаниям' }).getAttribute('href')).toBe('/');
  });
});
