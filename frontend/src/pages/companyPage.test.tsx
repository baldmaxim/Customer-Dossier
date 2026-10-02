// Карточка компании: вкладки «Обзор · Объекты · Публикации · Подробно» (TG_Info CLAUDE.md), вкладка,
// открытый пост и фильтры объектов — в адресе.
//
// Проверяется то, ради чего карточку пересобрали: обзор отвечает «как дела» (сводка, последние
// события по дате, первые объекты карточками и переход на вкладку, контрагенты с цитатой по
// раскрытию), «Объекты» — карточки со сведениями ДОМ.РФ и объектами застройщиков группы, публикации —
// читалкой, «Подробно» — опознание, реестр, все события, показатели, резюме и схема;
// ошибка загрузки не выдаётся за «не найдена».

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders, renderWithRouter } from '../test/render';
import { companyRoutes, computedSignals, event, manyPartners, objectRegistry, objectRow, objectsBody } from './companyPage.fixtures';
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
  it('четыре вкладки, у «Объектов» — число; обзор — сводка, объекты и контрагенты, без ленты публикаций', async () => {
    fakeApi(companyRoutes());
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'ООО «Мостострой»' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Разделы компании' });
    await waitFor(() =>
      expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Обзор', 'Объекты1', 'Публикации', 'Подробно']),
    );
    expect(within(tabs).getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('ООО «Дорсервис»')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Коротко о компании' })).toBeTruthy();
    expect(screen.queryByText('Подряд на развязку передан другой фирме')).toBeNull();
    // Путь к схеме — кнопка в шапке, а не колонка каталога.
    expect(screen.getByRole('link', { name: 'Схема связей' }).getAttribute('href')).toBe('/links?company=7');
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

  it('объекты на обзоре — карточки-ссылки на страницу объекта, роли ярлыками; «Все объекты» ведёт на вкладку', async () => {
    fakeApi(companyRoutes());
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Объекты', level: 2 })).closest('section')!;
    const links = await within(section).findAllByRole('link', { name: 'Развязка на М-7' });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/projects/55');
    expect(links[0]!.closest('article')?.className).toContain('row-link');
    expect(within(section).getByText('генподрядчик')).toBeTruthy();
    expect(within(section).getByText('заказчик')).toBeTruthy();
    expect(within(section).getByText('Строится')).toBeTruthy();
    expect(within(section).getByText('только из публикаций')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Все объекты — 1' }).getAttribute('href')).toBe('/company/7?tab=objects');
  });

  it('объект из события виден без выдуманной роли участия', async () => {
    fakeApi(
      replace('GET /api/companies/7/objects', () => ({
        status: 200,
        body: objectsBody([objectRow({ projectId: 56, name: 'ЖК Бадаевский', basis: 'event', roles: [], state: null })]),
      })),
    );
    renderCard();

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
              registry: objectRegistry(),
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
    expect(within(reka).getByText('ДОМ.РФ · на 20.09.2026')).toBeTruthy();
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

  it('сводка не выдумывает числа, когда показатели не посчитаны', async () => {
    fakeApi(companyRoutes());
    renderCard();

    expect(await screen.findByText(/Показатели ещё не посчитаны/)).toBeTruthy();
    const brief = screen.getByRole('heading', { name: 'Коротко о компании' }).closest('section')!;
    expect(within(brief).getByText('Публикации').nextElementSibling?.textContent).toBe('—');
    await waitFor(() => expect(within(brief).getByText('Объекты').nextElementSibling?.textContent).toBe('1'));
    await waitFor(() => expect(within(brief).getByText('События').nextElementSibling?.textContent).toBe('0'));
    // Числа правил signals@2 без расчёта не появляются: плиток «Связи» и «Суды» нет, а не «0».
    expect(within(brief).queryByText('Связи')).toBeNull();
    expect(within(brief).queryByText('Суды')).toBeNull();
  });

  it('плитки сводки: число, разбивка и ссылка туда, где число расписано', async () => {
    fakeApi(replace('GET /api/companies/7/signals', () => ({ status: 200, body: computedSignals })));
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    expect(await within(brief).findByText('показатели на 01.10.2026')).toBeTruthy();
    const tile = (label: string): HTMLElement => within(brief).getByText(label).closest('div')!;

    expect(within(tile('Публикации')).getByText('14')).toBeTruthy();
    expect(within(tile('Публикации')).getByText('за 90 дней — 4 · последняя 30.09.2026')).toBeTruthy();
    expect(within(tile('Связи')).getByText('договоров — 2 · корпоративных — 1')).toBeTruthy();
    expect(within(tile('Суды')).getByText('истец — 1 · ответчик — 2')).toBeTruthy();
    expect(within(tile('События')).getByText('с датой за 12 мес. — 2')).toBeTruthy();
    // Плитка — строка-ссылка: нажимается целиком.
    expect(tile('Связи').className).toContain('row-link');

    const href = (name: string): string | null => within(brief).getByRole('link', { name }).getAttribute('href');
    expect(href('Все объекты')).toBe('/company/7?tab=objects');
    expect(href('Все события')).toBe('/company/7?tab=details#company-events');
    expect(href('Все публикации')).toBe('/company/7?tab=publications');
    expect(href('Все связи')).toBe('/links?company=7');
    expect(href('Дела подробно')).toBe('/company/7?tab=details#company-signals');
    // Оценки надёжности в сводке нет (ADR-009).
    expect(within(brief).queryByText(/надёжн.*(высок|низк)|риск/i)).toBeNull();
  });

  it('плитка реестра — только у карточки с реестром и ведёт к его разделу', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    const tile = (await within(brief).findByText('Реестр')).closest('div')!;
    expect(within(tile).getByText('объектов в реестре · на 20.09.2026')).toBeTruthy();
    expect(within(tile).getByRole('link', { name: 'Сведения реестра' }).getAttribute('href')).toBe('/company/7?tab=details#company-registry');
  });

  it('контрагенты: первые шесть, «Показать ещё»; полный ответ сервера — ссылка «Все связи»', async () => {
    fakeApi(replace('GET /api/companies/7/partners', () => ({ status: 200, body: { items: manyPartners(12) } })));
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'С кем связана' })).closest('section')!;
    await within(section).findByRole('link', { name: 'ООО «Партнёр 1»' });
    expect(within(section).queryByRole('link', { name: 'ООО «Партнёр 7»' })).toBeNull();
    expect(within(section).getByRole('link', { name: 'Все связи' }).getAttribute('href')).toBe('/links?company=7');

    fireEvent.click(within(section).getByRole('button', { name: 'Показать ещё 6' }));
    expect(within(section).getByRole('link', { name: 'ООО «Партнёр 12»' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Показать ещё/ })).toBeNull();
    expect(within(section).getByText(/остальные в «Связях»/)).toBeTruthy();
  });

  it('последние события — три по дате события, а не по «тяжести»; «Все события» ведёт в «Подробно»', async () => {
    fakeApi(
      replace('GET /api/companies/7/events', () => ({
        status: 200,
        body: {
          items: [
            event({ id: 1, type: 'court_case', occurredOn: '2025-01-10', severity: 3 }),
            event({ id: 2, type: 'delay', occurredOn: null, severity: 2 }),
            event({ id: 3, type: 'commissioning', occurredOn: '2026-09-01', severity: 1 }),
            event({ id: 4, type: 'tender_award', occurredOn: '2026-05-01', severity: 1 }),
            event({ id: 5, type: 'milestone', occurredOn: '2026-07-15', severity: 0 }),
          ],
        },
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Последние события' })).closest('section')!;
    await within(section).findByText('Ввод в эксплуатацию');
    const types = within(section).getAllByRole('listitem').map(li => li.querySelector('span')?.textContent);
    expect(types).toEqual(['Ввод в эксплуатацию', 'Этап работ', 'Победа в тендере']);
    const all = within(section).getByRole('link', { name: 'Все события — 5' });
    // Ссылка — концовкой блока, под списком, а не в шапке раздела.
    expect(all.closest('ol')).toBeNull();
    expect(section.lastElementChild?.contains(all)).toBe(true);
    expect(all.getAttribute('href')).toBe('/company/7?tab=details#company-events');
  });

  it('событие показывает имя источника, объект — ссылкой', async () => {
    fakeApi(
      replace('GET /api/companies/7/events', () => ({
        status: 200,
        body: { items: [event({ id: 501, url: 'https://t.me/stroi_news/501', sourceTitle: 'Стройки — и точка', sourceKey: 'stroi_news', sourceKind: 'telegram' })] },
      })),
    );
    renderCard();

    const source = await screen.findByRole('link', { name: 'Стройки — и точка — открыть публикацию' });
    expect(within(source).getByText('Стройки — и точка')).toBeTruthy();
    expect(source.getAttribute('href')).toBe('https://t.me/stroi_news/501');
    expect(source.getAttribute('rel')).toBe('noopener noreferrer');
    const section = screen.getByRole('heading', { name: 'Последние события' }).closest('section')!;
    expect(within(section).getByRole('link', { name: 'Развязка на М-7' }).getAttribute('href')).toBe('/projects/55');
  });

  it('похожие компании — одной строкой на обзоре и не занимают место читалки', async () => {
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
    expect(await screen.findByRole('heading', { name: 'Опознание' })).toBeTruthy();

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

  it('«Подробно»: опознание, реестр, все события, показатели, резюме и схема связей', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderCard('/company/7?tab=details');

    for (const name of ['Опознание', 'Реестр', 'События', 'Показатели', 'Резюме и противоречия', 'Схема связей']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeTruthy();
    }
    // Схема — свёрнутый раздел: граф грузится только после раскрытия.
    expect(screen.queryByRole('link', { name: 'Открыть в «Связях»' })).toBeNull();
    fireEvent.click(screen.getByRole('heading', { name: 'Схема связей', level: 2 }).closest('summary')!);
    expect((await screen.findByRole('link', { name: 'Открыть в «Связях»' })).getAttribute('href')).toBe('/links?company=7');
    expect(await screen.findByText('Нужна проверка')).toBeTruthy();
    expect(screen.getByText(/противоречий — 1/)).toBeTruthy();
    const registry = screen.getByRole('heading', { name: 'Сведения реестра о застройщике' }).closest('section')!;
    expect(within(registry).getByText('1655000000')).toBeTruthy();
    // В «Проверку» ведёт только тем, кому доступна админка.
    expect(screen.getByRole('link', { name: 'Открыть «Проверку»' }).getAttribute('href')).toBe('/admin/review');
  });

  it('«Подробно»: меню разделов; на телефоне пункт меню раскрывает свёрнутый раздел и ставит якорь в адрес', async () => {
    phone();
    const api = fakeApi(companyRoutes({ withRegistry: true }));
    const { router } = renderWithRouter(cardRoutes, ['/company/7?tab=details']);

    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual([
      'Опознание',
      'Реестр',
      'События',
      'Показатели',
      'Резюме',
      'Схема связей',
    ]);
    const graph = screen.getByRole('heading', { name: 'Схема связей', level: 2 }).closest('details')!;
    expect(graph.open).toBe(false);
    expect(api.calls.some(c => c.url.startsWith('/api/graph'))).toBe(false);

    fireEvent.click(within(nav).getByRole('link', { name: 'Схема связей' }));
    await waitFor(() => expect(router.state.location.hash).toBe('#company-graph'));
    expect(router.state.location.search).toBe('?tab=details');
    // Якорь не плодит записей истории: «Назад» уводит с вкладки, а не по пунктам меню.
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(graph.open).toBe(true));
    expect(await screen.findByRole('link', { name: 'Открыть в «Связях»' })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'Схема связей' }).getAttribute('aria-current')).toBe('location');
  });

  it('читателю «Подробно» не предлагает ссылок в админку', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderWithProviders(
      <AuthContext.Provider value={{ ...LOCAL_AUTH, can: permission => permission === 'portal.read' }}>
        <Routes>
          <Route path="/company/:id" element={<CompanyPage />} />
        </Routes>
      </AuthContext.Provider>,
      '/company/7?tab=details',
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

  it('404 — «Компания не найдена» и путь к поиску', async () => {
    fakeApi(replace('GET /api/companies/7', () => ({ status: 404, body: { error: 'not found' } })));
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'Компания не найдена' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К поиску' }).getAttribute('href')).toBe('/');
  });
});
