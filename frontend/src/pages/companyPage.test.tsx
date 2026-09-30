// Карточка компании: три вкладки — «Обзор · Публикации · Подробно» (решение владельца, TG_Info
// CLAUDE.md), вкладка и открытый пост — в адресе.
//
// Проверяется то, ради чего карточку пересобрали: обзор отвечает «как дела» (сводка, последние
// события по дате, объекты ссылками, контрагенты с цитатой по раскрытию), публикации —
// читалкой, «Подробно» — опознание, реестр, все события, показатели, резюме и схема;
// ошибка загрузки не выдаётся за «не найдена».

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders, renderWithRouter } from '../test/render';
import { companyRoutes, event } from './companyPage.fixtures';
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
  it('три вкладки; обзор — сводка, объекты и контрагенты, без ленты публикаций', async () => {
    fakeApi(companyRoutes());
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'ООО «Мостострой»' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Разделы компании' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Обзор', 'Публикации', 'Подробно']);
    expect(within(tabs).getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('ООО «Дорсервис»')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Коротко о компании' })).toBeTruthy();
    expect(screen.queryByText('Подряд на развязку передан другой фирме')).toBeNull();
    // Путь к схеме — кнопка в шапке, а не колонка каталога.
    expect(screen.getByRole('link', { name: 'Схема связей' }).getAttribute('href')).toBe('/links?company=7');
  });

  it('реквизиты в шапке подписаны: ИНН — с номером, город и вид лица', async () => {
    fakeApi(companyRoutes());
    renderCard();

    const meta = await screen.findByRole('list', { name: 'Реквизиты и город' });
    expect(within(meta).getByText('ИНН').parentElement?.textContent).toBe('ИНН 1655000000');
    expect(within(meta).getByText('Казань')).toBeTruthy();
    expect(within(meta).getByText('юрлицо')).toBeTruthy();
  });

  it('объекты — строки-ссылки на страницу объекта, роли ярлыками, объект один раз', async () => {
    fakeApi(companyRoutes());
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Объекты' })).closest('section')!;
    const links = await within(section).findAllByRole('link', { name: 'Развязка на М-7' });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/projects/55');
    expect(links[0]!.closest('li')?.className).toContain('row-link');
    expect(within(section).getByText('генподрядчик')).toBeTruthy();
    expect(within(section).getByText('заказчик')).toBeTruthy();
    expect(within(section).getByText(/строится/)).toBeTruthy();
  });

  it('объект из события виден без выдуманной роли участия', async () => {
    fakeApi(
      replace('GET /api/companies/7/projects', () => ({
        status: 200,
        body: { items: [{ id: 56, name: 'ЖК Бадаевский', kind: 'residential', stage: 'construction', city: 'Москва', plannedCompletion: null, actualCompletion: null, role: null, confidence: null, isCurrent: null, basis: 'event', counterparties: null }] },
      })),
    );
    renderCard();

    const row = (await screen.findByRole('link', { name: 'ЖК Бадаевский' })).closest('li')!;
    expect(within(row).getByText('упомянут в событиях, роль не названа')).toBeTruthy();
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
    expect(within(brief).getByText('публикаций').nextElementSibling?.textContent).toBe('—');
    expect(within(brief).getByText('последняя публикация').nextElementSibling?.textContent).toBe('—');
    expect(within(brief).getByText('объектов').nextElementSibling?.textContent).toBe('1');
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
    const all = within(section).getByRole('link', { name: 'Все события' });
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
