// «Источники» (бывший «Сбор»): вкладки по виду источника в адресе, переключатель вместо
// редактора допуска, срок сбора, ссылки на публикации и разборы источника, удаление пустого
// источника — только с подтверждением.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { channelKey } from '../../components/admin/channelKey';
import { fakeApi, renderWithProviders } from '../../test/render';
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

const routes = () => [
  { match: 'GET /api/admin/sources', respond: () => ({ status: 200, body: { items: sources } }) },
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

  it('строка ведёт к публикациям источника и к его разборам', async () => {
    fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources');

    const publications = await screen.findByRole('link', { name: 'Публикации «Недвижимость изнутри»' });
    expect(publications.getAttribute('href')).toBe(`/?view=publications&q=${encodeURIComponent('Недвижимость изнутри')}`);
    expect(screen.getByRole('link', { name: 'Разборы «Недвижимость изнутри»' }).getAttribute('href')).toBe('/admin/process?source=1');
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

  it('сохраняет ссылку ДОМ.РФ и номер существующего объекта портала', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SourcesPage />, '/admin/sources?tab=website');
    expect(await screen.findByRole('link', { name: '№62087 (откроется в новой вкладке)' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ссылка на объект ДОМ.РФ' }), {
      target: { value: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62088' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Номер объекта в портале (необязательно)' }), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ссылку' }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'POST',
        url: '/api/admin/domrf-targets',
        body: { url: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62088', projectId: 42 },
      }),
    );
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

describe('channelKey', () => {
  it('ссылка, @имя и t.me/s/ — один и тот же канал', () => {
    expect(channelKey('@propertyinsider')).toBe('propertyinsider');
    expect(channelKey('https://t.me/propertyinsider')).toBe('propertyinsider');
    expect(channelKey('t.me/s/propertyinsider?before=10')).toBe('propertyinsider');
    expect(channelKey(' propertyinsider ')).toBe('propertyinsider');
  });
});
