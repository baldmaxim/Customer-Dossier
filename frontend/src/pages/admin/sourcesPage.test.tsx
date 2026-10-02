// «Источники» (бывший «Сбор»): вкладки по виду источника в адресе, переключатель вместо
// редактора допуска, срок сбора, ссылки на публикации и разборы источника, удаление пустого
// источника — только с подтверждением. Плотная таблица: подробности — окном, фильтр
// «Не собираются» — в адресе, форма добавления — строкой в шапке списка.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { channelKey } from '../../components/admin/channelKey';
import { fakeApi, renderWithProviders, renderWithRouter } from '../../test/render';
import { stubViewport } from '../../test/viewport';
import { SourcesPage } from './SourcesPage';

const source = (over: Record<string, unknown>) => ({
  id: 1,
  kind: 'telegram',
  key: 'propertyinsider',
  title: 'Недвижимость изнутри',
  status: 'active',
  accessStatus: 'approved',
  aiProcessingStatus: 'approved',
  policyScope: null,
  policyBasis: 'Включено оператором в админке портала',
  policyReference: null,
  policyOwner: 'оператор портала',
  policyDecidedAt: '2026-09-20T10:00:00Z',
  policyExpiresAt: null,
  isSynthetic: false,
  historyDays: null,
  collectBlockedReason: null,
  aiBlockedReason: null,
  pollIntervalSec: 900,
  nextRunAt: null,
  lastOkAt: '2026-09-23T09:00:00Z',
  failStreak: 0,
  lastRunAt: null,
  lastRunStatus: null,
  lastItemsSeen: null,
  lastItemsNew: null,
  lastError: null,
  layoutStats: null,
  lastAttemptAt: '2026-09-23T09:00:00Z',
  lastSaved: 3,
  items: 120,
  healthState: { state: 'healthy', reason: 'последний проход прошёл', aiAllowed: true, coverage: { gaps: [] } },
  ...over,
});

const sources = [
  source({}),
  source({
    id: 2,
    key: 'stroykanal',
    title: 'stroykanal',
    status: 'paused',
    accessStatus: 'revoked',
    aiProcessingStatus: 'revoked',
    collectBlockedReason: 'нет разрешения на сбор',
    aiBlockedReason: 'нет разрешения на ИИ-обработку',
    items: 0,
  }),
  source({ id: 3, kind: 'website', key: 'erzrf.ru', title: 'ЕРЗ.РФ', historyDays: 365 }),
];

/** Включённый канал, сбор которого сломан: «не собирается». */
const broken = source({
  id: 4,
  key: 'infra_russia',
  title: 'Инфраструктура России',
  status: 'broken',
  items: 2210,
  health: 'blocked',
  healthReason: 't.me/s/infra_russia отвечает 403',
  healthState: {
    state: 'degraded',
    reason: 'канал стал закрытым: страница t.me/s/ не открывается без входа',
    aiAllowed: true,
    coverage: { gaps: [] },
  },
});

const routes = (items: unknown[] = sources) => [
  { match: 'GET /api/admin/sources', respond: () => ({ status: 200, body: { items } }) },
  {
    match: 'GET /api/admin/domrf-targets',
    respond: () => ({
      status: 200,
      body: {
        items: [
          {
            id: 1,
            externalRef: '62087',
            url: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62087',
            projectId: 42,
            projectName: 'Большая Татарская 35',
            requestedAt: '2026-09-28T08:00:00Z',
            capturedAt: '2026-09-28T09:00:00Z',
            status: 'captured',
          },
        ],
      },
    }),
  },
  { match: 'POST /api/admin/domrf-targets', respond: () => ({ status: 200, body: { item: {} } }) },
  { match: 'POST /api/admin/sources/', respond: () => ({ status: 200, body: { source: {} } }) },
  { match: 'PUT /api/admin/sources/', respond: () => ({ status: 200, body: { ok: true } }) },
  { match: 'DELETE /api/admin/sources/', respond: () => ({ status: 200, body: { ok: true } }) },
];

const SUMMARY = {
  companies: { companies: 2867, searched: 33, withPending: 12, confirmed: 5, notFound: 9, several: 0 },
  objects: { pending: 315 },
  cards: { waiting: 0, total: 3 },
  hints: { running: true, sourceId: 14, allowed: false, reason: 'нет разрешения', provider: 'openrouter', model: 'qwen/qwen3-30b-a3b-instruct-2507', hinted: 0, waiting: 50 },
};

describe('Админка: источники', () => {
  it('вкладки разделяют каналы и сайты; канал назван именем, без имени — «@ключ»', async () => {
    fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    expect(await screen.findByText('Недвижимость изнутри')).toBeTruthy();
    expect(screen.getByText('@stroykanal')).toBeTruthy();
    expect(screen.queryByText('ЕРЗ.РФ')).toBeNull();
    // Сколько включено из скольких — над списком.
    expect(screen.getByText('включено 1 из 2')).toBeTruthy();

    const tabs = within(screen.getByRole('tablist', { name: 'Вид источника' }));
    fireEvent.click(tabs.getByRole('tab', { name: /^Сайты/ }));
    expect(await screen.findByText('ЕРЗ.РФ')).toBeTruthy();
    expect(screen.queryByText('Недвижимость изнутри')).toBeNull();
    expect(tabs.getByRole('tab', { name: /^Сайты/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('вкладка берётся из адреса: ?tab=website открывает сайты', async () => {
    fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources?tab=website');

    expect(await screen.findByText('ЕРЗ.РФ')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Сайты/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('допуск — один переключатель: выключенный канал включается одной командой, ответ — тостом', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    const off = await screen.findByRole('switch', { name: 'Сбор: @stroykanal' });
    expect(off.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Сбор: Недвижимость изнутри' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(off);
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/admin/sources/2/enabled', body: { enabled: true } }));
    expect(await screen.findByText(/включён: сбор начнётся в ближайший проход/)).toBeTruthy();
    // Прежнего редактора с основанием и ответственным на экране нет.
    expect(screen.queryByText('Сохранить решение')).toBeNull();
  });

  it('срок сбора: выбор «полгода» уходит числом дней, «своё» — введённым числом', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    const picker = await screen.findByRole('combobox', { name: 'Срок сбора: Недвижимость изнутри' });
    expect(within(picker).getByRole('option', { name: 'только новые' })).toBeTruthy();
    fireEvent.change(picker, { target: { value: '180' } });
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/admin/sources/1/history', body: { days: 180 } }));

    fireEvent.change(picker, { target: { value: 'custom' } });
    const days = screen.getByRole('spinbutton', { name: 'Срок сбора: Недвижимость изнутри: число дней' });
    fireEvent.change(days, { target: { value: '45' } });
    fireEvent.blur(days);
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'PUT', url: '/api/admin/sources/1/history', body: { days: 45 } }));
  });

  it('у сайта без срока — «весь архив», а заданный срок показан', async () => {
    fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources?tab=website');

    const picker = (await screen.findByRole('combobox', { name: 'Срок сбора: ЕРЗ.РФ' })) as HTMLSelectElement;
    expect(picker.value).toBe('365');
    expect(within(picker).getByRole('option', { name: 'весь архив' })).toBeTruthy();
  });

  it('строка ведёт к разборам источника; ссылки на общую ленту нет (ADR-016)', async () => {
    fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    const runs = await screen.findByRole('link', { name: 'Разборы «Недвижимость изнутри»' });
    expect(runs.getAttribute('href')).toBe('/admin/process?source=1');
    expect(screen.queryByRole('link', { name: 'Публикации «Недвижимость изнутри»' })).toBeNull();
  });

  it('удалить можно только источник без публикаций — и только после подтверждения', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    await screen.findByText('Недвижимость изнутри');
    // У канала со 120 публикациями кнопки нет вовсе: сервер всё равно отказал бы.
    expect(screen.queryByRole('button', { name: 'Удалить «Недвижимость изнутри»' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Удалить «@stroykanal»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить «@stroykanal»?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.some(c => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить «@stroykanal»' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'DELETE', url: '/api/admin/sources/2', body: null }));
  });

  it('на «Сайтах» — вход на страницу наш.дом.рф: сколько ждёт решения; имя источника ведёт туда же', async () => {
    fakeApi([
      ...routes([...sources, source({ id: 14, kind: 'website', key: 'xn--80az8a.xn--d1aqf.xn--p1ai', title: 'наш.дом.рф' })]),
      { match: 'GET /api/admin/domrf-summary', respond: () => ({ status: 200, body: SUMMARY }) },
    ]);
    renderWithProviders(<SourcesPage />, '/admin/sources?tab=website');
    expect(await screen.findByText('Ждут решения: компании — 12, объекты — 315. Проверено компаний 33 из 2 867.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Открыть наш.дом.рф' }).getAttribute('href')).toBe('/admin/sources/domrf');
    expect(screen.getAllByRole('link', { name: 'наш.дом.рф' })[0]!.getAttribute('href')).toBe('/admin/sources/domrf');
    // Списки ДОМ.РФ — на его странице, не под таблицей сайтов.
    expect(screen.queryByRole('textbox', { name: 'Ссылка на объект ДОМ.РФ' })).toBeNull();
  });

  it('«Проверить сайт» показывает отчёт в окне и ничего не сохраняет', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/admin/sources/3/probe',
        respond: () => ({
          status: 200,
          body: {
            report: {
              outcome: 'ok',
              health: 'ok',
              healthReason: null,
              httpStatus: 200,
              counts: { found: 3, saved: 0, changed: 0, skipped: 0, failed: 0 },
              pagesFetched: 1,
              coverage: {},
              layoutStats: { item: 3 },
              parserVersion: 'html-list@2',
              samples: [{ url: 'https://erzrf.ru/news/1', title: 'Новость один', completeness: 'full', reason: 'статья', preview: 'Текст новости' }],
              errors: [],
            },
          },
        }),
      },
      ...routes(),
    ]);
    renderWithProviders(<SourcesPage />, '/admin/sources?tab=website');

    fireEvent.click(await screen.findByRole('button', { name: 'Проверить сайт «ЕРЗ.РФ»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Проверка сайта: ЕРЗ.РФ' });
    expect(within(dialog).getByText(/Найдено записей: 3, ошибок: 0/)).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Новость один' })).toBeTruthy();
    // Служебные подробности пробы (HTTP, версия парсера, селекторы) на экран не выводятся.
    expect(dialog.textContent).not.toMatch(/HTTP|html-list|Селекторы/);
    expect(api.calls.filter(c => c.method !== 'GET').map(c => c.url)).toEqual(['/api/admin/sources/3/probe']);
  });

  it('ошибка загрузки — причина и «Повторить», а не пустой список', async () => {
    fakeApi([{ match: 'GET /api/admin/sources', respond: () => ({ status: 500, body: { error: 'boom' } }) }]);
    renderWithProviders(<SourcesPage />, '/admin/sources');

    expect((await screen.findByRole('alert')).textContent).toMatch(/Сбой сервера \(500\)/);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByText(/Каналов пока нет/)).toBeNull();
  });
});

describe('Админка: источники — плотный вид', () => {
  const page = (url: string) => renderWithRouter([{ path: '/admin/sources', element: <SourcesPage /> }], [url]);

  it('строка — одной линией: имя, адрес, «N публ. · дата · +новых»; причина сбоя — только у сломанного', async () => {
    fakeApi(routes([...sources, broken]));
    renderWithProviders(<SourcesPage />, '/admin/sources');

    await screen.findByText('Недвижимость изнутри');
    expect(screen.getByText('t.me/propertyinsider')).toBeTruthy();
    expect(screen.getByText(/^120 публ\. · .+ · \+3 новые$/)).toBeTruthy();
    expect(screen.getByText('канал стал закрытым: страница t.me/s/ не открывается без входа')).toBeTruthy();
    // У работающего канала причины нет: «последний проход прошёл» ярлык «работает» уже сказал.
    expect(screen.queryByText('последний проход прошёл')).toBeNull();
    // Переключатель — без слова состояния рядом: состояние в aria-checked.
    expect(screen.queryByText('включён')).toBeNull();
    // Прежней плашки «Не собираются» с абзацем нет — вместо неё фильтр в шапке списка.
    expect(screen.queryByText(/Обычная причина/)).toBeNull();
  });

  it('«Не собираются: N» — фильтр в адресе: только сломанные, повторное нажатие снимает', async () => {
    fakeApi(routes([...sources, broken]));
    const { router } = page('/admin/sources');

    const filter = await screen.findByRole('button', { name: 'Не собираются: 1' });
    expect(filter.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(filter);

    await waitFor(() => expect(router.state.location.search).toBe('?problems=1'));
    expect(screen.queryByText('Недвижимость изнутри')).toBeNull();
    expect(screen.getByText('Инфраструктура России')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Не собираются: 1' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Не собираются: 1' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByText('Недвижимость изнутри')).toBeTruthy();
  });

  it('фильтр берётся из адреса; смена вкладки его снимает; без сломанных — список целиком', async () => {
    fakeApi(routes([...sources, broken]));
    const { router } = page('/admin/sources?problems=1');

    expect(await screen.findByText('Инфраструктура России')).toBeTruthy();
    expect(screen.queryByText('Недвижимость изнутри')).toBeNull();

    fireEvent.click(within(screen.getByRole('tablist', { name: 'Вид источника' })).getByRole('tab', { name: /^Сайты/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?tab=website'));
    expect(await screen.findByText('ЕРЗ.РФ')).toBeTruthy();

    // Флаг в адресе при исправном списке ничего не прячет: снять его было бы нечем.
    await router.navigate('/admin/sources?tab=website&problems=1');
    expect(await screen.findByText('ЕРЗ.РФ')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Не собираются/ })).toBeNull();
  });

  it('«Подробнее» — окном: состояние словами и все действия с источником', async () => {
    fakeApi(routes([...sources, broken]));
    renderWithProviders(<SourcesPage />, '/admin/sources');

    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее «Инфраструктура России»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Инфраструктура России' });
    expect(within(dialog).getByText('Telegram-канал · t.me/infra_russia')).toBeTruthy();
    expect(within(dialog).getByText('сбор работает с ошибками')).toBeTruthy();
    expect(within(dialog).getByText('t.me/s/infra_russia отвечает 403')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Разборы' }).getAttribute('href')).toBe('/admin/process?source=4');
    // 2210 публикаций — удалять нечего предлагать.
    expect(within(dialog).queryByRole('button', { name: 'Удалить' })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('на телефоне в строке — одно «Подробнее», остальные действия — в его окне', async () => {
    stubViewport(390);
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    await screen.findByText('Недвижимость изнутри');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Публикации «Недвижимость изнутри»' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить «@stroykanal»' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Подробнее «@stroykanal»' }));
    const dialog = await screen.findByRole('dialog', { name: '@stroykanal' });
    expect(within(dialog).getByRole('link', { name: 'Разборы' }).getAttribute('href')).toBe('/admin/process?source=2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Удалить «@stroykanal»?' })).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'DELETE', url: '/api/admin/sources/2', body: null }));
  });

  it('добавить канал — строкой в шапке списка; пустое название не отправляется', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    fireEvent.change(await screen.findByRole('textbox', { name: 'Канал' }), { target: { value: 'https://t.me/s/newchannel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({ method: 'POST', url: '/api/admin/sources/telegram', body: { channel: 'newchannel' } }),
    );
    expect(await screen.findByText(/Канал добавлен выключенным/)).toBeTruthy();
  });

  it('на телефоне форма добавления — в окне, после добавления окно закрывается', async () => {
    stubViewport(390);
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить канал' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить канал' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Канал' }), { target: { value: '@newchannel' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Название (необязательно)' }), { target: { value: 'Новый канал' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить канал' }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'POST',
        url: '/api/admin/sources/telegram',
        body: { channel: 'newchannel', title: 'Новый канал' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('свой срок хранится пунктом «45 дней»; поле числа — только пока вводят, Esc его закрывает', async () => {
    const api = fakeApi(routes([source({ historyDays: 45 })]));
    renderWithProviders(<SourcesPage />, '/admin/sources');

    const picker = (await screen.findByRole('combobox', { name: 'Срок сбора: Недвижимость изнутри' })) as HTMLSelectElement;
    // Между числом и словом — неразрывный пробел (formatCountWord).
    expect(picker.selectedOptions[0]?.textContent).toBe('45\u00a0дней');
    expect(screen.queryByRole('spinbutton')).toBeNull();

    fireEvent.change(picker, { target: { value: 'custom' } });
    const days = screen.getByRole('spinbutton', { name: 'Срок сбора: Недвижимость изнутри: число дней' }) as HTMLInputElement;
    expect(days.value).toBe('45');
    fireEvent.change(days, { target: { value: '60' } });
    fireEvent.keyDown(days, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
    expect(picker.value).toBe('saved');
    expect(api.calls.some(c => c.method === 'PUT')).toBe(false);
  });
});

describe('channelKey', () => {
  it('ссылка, @имя и t.me/s/ — один и тот же канал', () => {
    expect(channelKey('@propertyinsider')).toBe('propertyinsider');
    expect(channelKey('https://t.me/propertyinsider')).toBe('propertyinsider');
    expect(channelKey('t.me/s/propertyinsider?before=10')).toBe('propertyinsider');
    expect(channelKey(' propertyinsider ')).toBe('propertyinsider');
  });
});
