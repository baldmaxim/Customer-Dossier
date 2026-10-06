// Карточка компании: вкладки «Сведения · Объекты · Публикации · Подробно» (ADR-016: сначала юрлицо,
// потом объекты, потом публикации), вкладка, открытый пост и фильтры объектов — в адресе.
//
// «Сведения» — ЕГРЮЛ, реестр застройщика, сводка-плитки и контрагенты с цитатой по раскрытию;
// «Объекты» — карточки со сведениями ДОМ.РФ и объектами застройщиков группы, публикации — читалкой,
// «Подробно» — опознание, все события, показатели, резюме и схема; ошибка загрузки не выдаётся за
// «не найдена».

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders, renderWithRouter } from '../test/render';
import { buildersBody, checksBody, companyRoutes, computedSignals, datasetState, financeBody, financeYear, event, manyPartners, objectRegistry, objectRow, objectsBody, seriesSignals } from './companyPage.fixtures';
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
    // Путь к схеме — кнопка в шапке, а не колонка каталога.
    expect(screen.getByRole('link', { name: 'Схема связей' }).getAttribute('href')).toBe('/links?company=7');
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
              registry: objectRegistry({ hasPhoto: true }),
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
    expect(within(reka).getByRole('img', { name: 'Фото: Река' }).getAttribute('src')).toBe('/api/projects/60/photo');
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

  it('«Роли, события и тексты»: разбивки посчитанных показателей полосами, пустые названы словами', async () => {
    fakeApi(replace('GET /api/companies/7/signals', () => ({ status: 200, body: computedSignals })));
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Роли, события и тексты' })).closest('section')!;
    const roles = within(section).getByRole('list', { name: 'Роли на объектах' });
    expect(within(roles).getAllByRole('listitem').map(li => li.textContent)).toEqual(['генподрядчик1', 'заказчик1']);
    const courts = within(section).getByRole('list', { name: 'Роль в судебных делах' });
    expect(within(courts).getAllByRole('listitem').map(li => li.textContent)).toEqual(['истец, заявитель или кредитор1', 'ответчик или должник2']);
    expect(within(section).getByText(/из 3 дел/)).toBeTruthy();
    expect(within(section).getByText('Нет данных: события по видам, полнота текстов, происхождение текстов.')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Как посчитано' }).getAttribute('href')).toBe('/company/7?tab=details#company-signals');
  });

  it('публикации и события по месяцам (signals@3): два графика, что не вошло — словами, числа — таблицей', async () => {
    fakeApi(replace('GET /api/companies/7/signals', () => ({ status: 200, body: seriesSignals })));
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Публикации и события по месяцам' })).closest('section')!;
    const charts = within(section).getAllByRole('img');
    expect(charts).toHaveLength(2);
    expect(charts[0]!.getAttribute('aria-label')).toMatch(/^Публикации, ноябрь 2024 — октябрь 2026: всего 10\sпубликаций, больше всего — сентябрь 2026 \(5\)/);
    expect(
      within(section).getByText('учтено 10 из 14 публикаций; не вошли: 1 раньше начала ряда, 2 без даты, 1 — снимки ДОМ.РФ (дата сбора, а не публикации)'),
    ).toBeTruthy();
    expect(within(section).getByText('учтено 2 из 3 событий; не вошли: 1 с датой до квартала или года')).toBeTruthy();
    expect(within(section).queryByRole('table')).toBeNull();
    // Мини-график в плитке «Публикации» — только форма, диктору не читается.
    const brief = screen.getByRole('heading', { name: 'Коротко о компании' }).closest('section')!;
    const tile = within(brief).getByText('Публикации').closest('div')!;
    expect(tile.querySelector('[aria-hidden="true"] > span')).toBeTruthy();
  });

  it('снимок прежних правил — рядов нет, сказано словами, ничего не досчитывается', async () => {
    fakeApi(replace('GET /api/companies/7/signals', () => ({ status: 200, body: computedSignals })));
    renderCard();
    const section = (await screen.findByRole('heading', { name: 'Публикации и события по месяцам' })).closest('section')!;
    expect(within(section).getByText('Помесячные числа появятся после следующего расчёта показателей.')).toBeTruthy();
    expect(within(section).queryByRole('img')).toBeNull();
  });

  it('показатели не посчитаны — блока разбивок нет, а не пустые полосы', async () => {
    fakeApi(companyRoutes());
    renderCard();
    expect(await screen.findByText(/Показатели ещё не посчитаны/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Роли, события и тексты' })).toBeNull();
  });

  it('плитка реестра — только у карточки с реестром и ведёт к его разделу', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderCard();

    const brief = (await screen.findByRole('heading', { name: 'Коротко о компании' })).closest('section')!;
    const tile = (await within(brief).findByText('Реестр')).closest('div')!;
    expect(within(tile).getByText('объектов в реестре · на 20.09.2026')).toBeTruthy();
    // Реестр застройщика — на той же вкладке «Сведения»: плитка ведёт якорем к разделу.
    expect(within(tile).getByRole('link', { name: 'Сведения реестра' }).getAttribute('href')).toBe('/company/7#company-registry');
    // Объектов со сведениями ДОМ.РФ нет — раздел о записи застройщика; якорь плитки — у него.
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

  it('объекты по данным ДОМ.РФ: числа со знаменателем, статусы и сроки полосами, неразобранное — словами', async () => {
    fakeApi(
      replace('GET /api/companies/7/objects', () => ({
        status: 200,
        body: objectsBody([
          objectRow({ projectId: 60, name: 'Река', registry: objectRegistry({ sold: '50 %' }) }),
          objectRow({ projectId: 61, name: 'Парк', registry: objectRegistry({ apartments: '128', sold: '25 %', pricePerSqm: '410 000 ₽', completion: 'Сдан', status: 'Сдан' }) }),
          objectRow(),
        ]),
      })),
    );
    renderCard();

    const section = (await screen.findByRole('heading', { name: 'Объекты по данным ДОМ.РФ' })).closest('section')!;
    expect(within(section).getByText('2 из 3 объектов · на 20.09.2026')).toBeTruthy();
    expect(within(section).getByText('Квартир').nextElementSibling?.textContent).toBe('600');
    expect(within(section).getAllByText('по 2 объектам из 2')).toHaveLength(2);
    expect(within(section).getByText('Цена за м²').nextElementSibling?.textContent?.replace(/\s+/g, ' ')).toBe('410 000 ₽ — 933 425 ₽');
    // (472 × 0,5 + 128 × 0,25) / 600 = 0,447 → 45 %.
    expect(within(section).getByText('Продано квартир').nextElementSibling?.textContent?.replace(/\s+/g, ' ')).toBe('45 %');
    const statuses = within(section).getByRole('list', { name: 'Статус строительства' });
    expect(within(statuses).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Сдан1', 'Строится1']);
    expect(within(section).getByText(/срок не распознан — 1/)).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Все объекты — 3' }).getAttribute('href')).toBe('/company/7?tab=objects');
  });

  it('кто строит для компании: ДОМ.РФ по ИНН и публикации, своя группа, без карточки — «Найти по ИНН»; плитка сводки', async () => {
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
                { projectId: 60, name: 'Река', role: 'general_contractor', sources: ['registry'], isCurrent: true, registryAsOf: '2026-09-30', lastPublication: null, mentions: null },
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
    expect(within(section).getByText('найдена по ИНН из ДОМ.РФ')).toBeTruthy();
    expect(within(section).getByText('в ДОМ.РФ: ООО СУ-10')).toBeTruthy();
    expect(within(section).getByText(/ДОМ\.РФ на 30\.09\.2026/)).toBeTruthy();
    expect(within(section).getByText(/публикации: 3, последняя 01\.10\.2026/)).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'Найти по ИНН' }).getAttribute('href')).toBe('/?q=7704412966');
    expect(within(section).getByText(/не проверенный договор/)).toBeTruthy();

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
              format: 'tax-map@1',
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
    expect(within(section).getAllByText('нет')).toHaveLength(2);
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
            },
          },
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
              ended: { count: 1, byReason: [{ reason: 'ст. 46 ч. 1 п. 3', count: 1 }] },
              unknownStatus: 0,
              openedByYear: [{ year: 2026, count: 191 }, { year: 2025, count: 419 }],
              last12m: { from: '2025-10-06', count: 248 },
              bySubject: [{ subject: 'Иные взыскания в пользу физлиц', count: 620 }],
              recent: [],
            },
          },
          bankruptcy: { state: datasetState('bankruptcy', { outcome: 'not_found' }), view: { format: 'bankruptcy-map@1', recognized: true, problems: [], found: false, record: null } },
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
    expect(within(section).getByText('677 — сумма долга по документам 431,2 млн ₽')).toBeTruthy();
    expect(within(section).getByText('423,8 млн ₽ — указан у 652 из 677')).toBeTruthy();
    expect(within(section).getByText('1 — ст. 46 ч. 1 п. 3: 1')).toBeTruthy();
    expect(within(section).getByText(/Записей о компании в ЕФРСБ нет · проверено 06\.10\.2026/)).toBeTruthy();
    // Плитки сводки.
    const tile = (label: string) => screen.getAllByText(label).map(n => n.closest('div')!).find(d => d.className.includes('tile'))!;
    expect(tile('Арбитраж').textContent).toContain('ответчик');
    expect(tile('ФССП').textContent).toContain('остаток 423,8');
    expect(screen.getByText(/Картотека арбитражных дел \(kad\.arbitr\.ru\)/)).toBeTruthy();
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

  it('событие показывает имя источника, объект — ссылкой', async () => {
    fakeApi(
      replace('GET /api/companies/7/events', () => ({
        status: 200,
        body: { items: [event({ id: 501, url: 'https://t.me/stroi_news/501', sourceTitle: 'Стройки — и точка', sourceKey: 'stroi_news', sourceKind: 'telegram' })] },
      })),
    );
    renderCard('/company/7?tab=details');

    const source = await screen.findByRole('link', { name: 'Стройки — и точка — открыть публикацию' });
    expect(within(source).getByText('Стройки — и точка')).toBeTruthy();
    expect(source.getAttribute('href')).toBe('https://t.me/stroi_news/501');
    expect(source.getAttribute('rel')).toBe('noopener noreferrer');
    const section = screen.getByRole('heading', { name: 'События', level: 2 }).closest('details')!;
    expect(within(section).getByRole('link', { name: 'Развязка на М-7' }).getAttribute('href')).toBe('/projects/55');
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

  it('«Подробно»: опознание, все события, показатели, резюме и схема связей (ЕГРЮЛ и реестр — в «Сведениях»)', async () => {
    fakeApi(companyRoutes({ withRegistry: true }));
    renderCard('/company/7?tab=details');

    for (const name of ['Опознание', 'События', 'Показатели', 'Резюме и противоречия', 'Схема связей']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeTruthy();
    }
    // Схема — свёрнутый раздел: граф грузится только после раскрытия.
    expect(screen.queryByRole('link', { name: 'Открыть в «Связях»' })).toBeNull();
    fireEvent.click(screen.getByRole('heading', { name: 'Схема связей', level: 2 }).closest('summary')!);
    expect((await screen.findByRole('link', { name: 'Открыть в «Связях»' })).getAttribute('href')).toBe('/links?company=7');
    expect(await screen.findByText('Нужна проверка')).toBeTruthy();
    expect(screen.getByText(/противоречий — 1/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус' })).toBeNull();
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

  it('404 — «Компания не найдена» и путь к компаниям', async () => {
    fakeApi(replace('GET /api/companies/7', () => ({ status: 404, body: { error: 'not found' } })));
    renderCard();

    expect(await screen.findByRole('heading', { level: 1, name: 'Компания не найдена' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'К компаниям' }).getAttribute('href')).toBe('/');
  });
});
