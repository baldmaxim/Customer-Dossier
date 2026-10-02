// Объект: шапка с уровнем и родителем, паспорт ДОМ.РФ первым (или словами, что его нет, и похожие
// объекты со сведениями), участники (карточки на телефоне, таблица шире) с «Откуда известно» у строки,
// период в адресе, разделы с содержимым раскрыты, схема строится только по раскрытию.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { IProjectDossier, IStatement } from '../api/types';
import { assertionResponse } from '../test/assertionFixture';
import { fakeApi, renderWithRouter, type IFakeRoute } from '../test/render';
import { stubViewport } from '../test/viewport';
import { ProjectPage } from './ProjectPage';

const statement = (id: number, text: string): IStatement => ({
  code: `s.${id}`,
  text,
  attribution: 'source_reported',
  assertionIds: [id],
  evidenceIds: [],
  quotes: [],
});

const participant = (companyId: number, companyName: string, role: string, inPeriod: IProjectDossier['participants'][number]['inPeriod'], assertionId: number) => ({
  companyId,
  companyName,
  role,
  building: 'корпус 12',
  workPackage: null,
  validFrom: '2024-03-01',
  validTo: null,
  periodPrecision: 'month',
  inPeriod,
  statement: statement(assertionId, `${companyName} — ${role} на объекте.`),
});

const dossier = (inPeriod: 'overlaps' | 'no_overlap' | 'no_period_selected' = 'no_period_selected'): IProjectDossier => ({
  project: {
    id: 56,
    name: 'Корпус 12 ЖК Демо',
    kind: 'residential',
    city: 'Санкт-Петербург',
    level: 'building',
    levelLabel: '12',
    parent: { id: 55, name: 'ЖК Демо' },
    children: [{ id: 57, name: 'Секция 1', level: 'phase', levelLabel: '1' }],
    mergedIntoId: null,
  },
  period: { from: null, to: null },
  state: {
    current: [{ building: null, state: 'construction', validFrom: '2026-08-01', periodPrecision: 'day' }],
    history: [
      { building: null, state: 'suspended', validFrom: '2025-06-01', periodPrecision: 'month', assertionId: 160 },
      { building: null, state: 'construction', validFrom: '2026-08-01', periodPrecision: 'day', assertionId: 161 },
    ],
  },
  participants: [
    participant(1, 'Общество с ограниченной ответственностью «Бета-Демо»', 'general_contractor', inPeriod, 5),
    participant(2, 'Дельта-Демо', 'subcontractor', inPeriod === 'overlaps' ? 'no_overlap' : inPeriod, 6),
  ],
  notCounted: [],
  contracts: [statement(7, 'Договор генподряда с Бета-Демо.')],
  coParticipationNote: 'Совместное участие на объекте не означает договора между компаниями.',
  events: [],
  cases: [],
  registry: {
    source: { key: 'r', title: 'Демо-реестр' },
    externalRef: '62087',
    asOf: '2026-09-21',
    fetchedAt: '2026-09-21T10:00:00.000Z',
    fields: [
      { label: 'Статус строительства', value: 'Строится' },
      { label: 'Сдача дома', value: 'IV квартал 2026' },
      { label: 'Количество квартир', value: '1024' },
      { label: 'Класс недвижимости', value: 'Комфорт' },
      { label: 'Генподрядчики', value: 'ООО «Бета-Демо»' },
    ],
    developer: { name: 'Общество с ограниченной ответственностью «СЗ Демо»', legalForm: 'ООО', inn: '7704412966', ogrn: null },
    groupName: 'ГК Демо',
    address: 'Санкт-Петербург, участок 12',
    changes: [],
    coverage: { loaded: 1, truncated: false },
    attribution: 'Проектная декларация застройщика — это заявление застройщика, а не проверенный факт.',
    hasPhoto: true,
    developerCompany: { id: 9, name: 'СЗ Демо' },
    groupCompany: { id: 10, name: 'ГК Демо' },
  },
});

const setup = (url: string, over: IFakeRoute[] = []) => {
  const api = fakeApi([
    ...over,
    {
      match: 'GET /api/projects/56/dossier',
      respond: u => ({ status: 200, body: dossier(u.includes('from=') ? 'overlaps' : 'no_period_selected') }),
    },
    { match: 'GET /api/assertions/5', respond: () => ({ status: 200, body: assertionResponse(5) }) },
    { match: 'GET /api/graph', respond: () => ({ status: 200, body: { nodes: [], edges: [], truncated: false, notes: [] } }) },
  ]);
  const view = renderWithRouter([{ path: '/projects/:id', element: <ProjectPage /> }], [url]);
  return { api, ...view };
};

describe('Объект', () => {
  it('шапка: уровень и родитель ссылкой, название, город, очереди ссылками, схема связей', async () => {
    setup('/projects/56');
    expect(await screen.findByRole('heading', { level: 1, name: 'Корпус 12 ЖК Демо' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ЖК Демо' }).getAttribute('href')).toBe('/projects/55');
    // Надпись над названием: уровень и родитель (родитель — ссылкой рядом).
    expect(screen.getByText(/^корпус 12 · входит в\s*$/, { selector: 'p' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'очередь 1' }).getAttribute('href')).toBe('/projects/57');
    expect(screen.getByRole('link', { name: 'Схема связей' }).getAttribute('href')).toBe('/links?project=56');
    expect(screen.getByText('строится с 01.08.2026')).toBeTruthy();
  });

  it('паспорт ДОМ.РФ первым: главные числа, застройщик и группа — ссылками, дата и атрибуция; остальное — раскрытием', async () => {
    setup('/projects/56');
    const passport = (await screen.findByRole('heading', { name: 'Паспорт объекта' })).closest('section')!;
    const terms = within(passport).getAllByRole('term').filter(t => !t.closest('details'));
    expect(terms.map(t => t.textContent)).toEqual(['Статус', 'Сдача дома', 'Квартир', 'Класс', 'Адрес', 'Застройщик', 'Группа компаний', 'Генподрядчик']);
    expect(terms[0]!.nextElementSibling?.textContent).toBe('Строится');
    const developer = within(passport).getByRole('link', { name: 'Общество с ограниченной ответственностью «СЗ Демо»' });
    expect(developer.getAttribute('href')).toBe('/company/9');
    expect(within(passport).getByRole('link', { name: 'ГК Демо' }).getAttribute('href')).toBe('/company/10');
    expect(within(passport).queryByText(/^ООО Общество/)).toBeNull();
    expect(within(passport).getByText('Сведения на 21.09.2026 (получены 21.09.2026)')).toBeTruthy();
    expect(within(passport).getByText(/не проверенный факт/)).toBeTruthy();
    expect(within(passport).getByText('Все сведения ДОМ.РФ')).toBeTruthy();
    expect(within(passport).getByRole('img', { name: 'Фото: Корпус 12 ЖК Демо' }).getAttribute('src')).toBe('/api/projects/56/photo');
    expect(within(passport).getByText('Фото: наш.дом.рф')).toBeTruthy();
  });

  it('без сведений ДОМ.РФ — словами, что их нет, и похожий объект со сведениями ссылкой', async () => {
    setup('/projects/56', [
      {
        match: 'GET /api/projects/56/dossier',
        respond: () => ({
          status: 200,
          body: { ...dossier(), registry: null, registryLookalikes: [{ projectId: 60, name: 'ЖК Демо-2', city: 'Москва', reason: 'name' }] },
        }),
      },
    ]);
    const note = (await screen.findByText('Сведений ДОМ.РФ по объекту нет')).closest('[class]')!.parentElement!;
    expect(within(note).getByRole('link', { name: 'ЖК Демо-2' }).getAttribute('href')).toBe('/projects/60');
    expect(within(note).getByRole('link', { name: '«Проверка» → «Дубли»' }).getAttribute('href')).toBe('/admin/review?tab=duplicates');
    expect(screen.queryByRole('heading', { name: 'Паспорт объекта' })).toBeNull();
    expect(screen.getByText('строится с 01.08.2026')).toBeTruthy();
  });

  it('на широком экране — таблица: строка ведёт на компанию, «Откуда известно» раскрывает цитаты', async () => {
    setup('/projects/56');
    const table = await screen.findByRole('table');
    const company = within(table).getByRole('link', { name: 'ООО «Бета-Демо»' });
    expect(company.getAttribute('href')).toBe('/company/1');
    expect(company.closest('tr')?.className).toContain('row-link');
    expect(screen.queryByText('Основания участия')).toBeNull();

    const toggle = within(table).getAllByRole('button', { name: 'Откуда известно' })[0]!;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
  });

  it('на телефоне участники — карточки-ссылки, «Откуда известно» — внутри карточки', async () => {
    stubViewport(390);
    setup('/projects/56');
    const list = await screen.findByRole('list', { name: 'Участники' });
    expect(screen.queryByRole('table')).toBeNull();
    const card = within(list).getByRole('link', { name: 'ООО «Бета-Демо»' }).closest('li')!;
    expect(card.className).toContain('row-link');
    expect(within(card).getByText(/генподрядчик · корпус 12/)).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: 'Откуда известно' }));
    expect(await within(card).findByText('Бета-Демо заключила договор субподряда с Дельта-Демо')).toBeTruthy();
  });

  it('период — в адресе: даты уходят в запрос, «только работавшие» отбирает участников', async () => {
    const { api, router } = setup('/projects/56?from=2024-01-01&to=2024-12-31&only=1');
    const table = await screen.findByRole('table');
    await waitFor(() => expect(api.calls.some(c => c.url.includes('from=2024-01-01') && c.url.includes('to=2024-12-31'))).toBe(true));
    expect(within(table).getByRole('link', { name: 'ООО «Бета-Демо»' })).toBeTruthy();
    expect(within(table).queryByRole('link', { name: 'Дельта-Демо' })).toBeNull();
    expect(screen.getByText(/^1 из 2\sучастников$/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Конец периода'), { target: { value: '2025-06-30' } });
    await waitFor(() => expect(router.state.location.search).toContain('to=2025-06-30'));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить период' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('раздел с содержимым раскрыт, пустой — свёрнут; схема не строится, пока её не открыли', async () => {
    const { api } = setup('/projects/56');
    await screen.findByRole('table');
    expect(screen.getByRole('heading', { level: 2, name: 'Договоры по сообщениям источников' }).closest('details')?.open).toBe(true);
    for (const name of ['События объекта', 'История состояния', 'Схема связей']) {
      expect(screen.getByRole('heading', { level: 2, name }).closest('details')?.open).toBe(false);
    }
    expect(api.calls.some(c => c.url.startsWith('/api/graph'))).toBe(false);

    const graph = screen.getByRole('heading', { level: 2, name: 'Схема связей' }).closest('details')!;
    fireEvent.click(graph.querySelector('summary')!);
    graph.dispatchEvent(new Event('toggle'));
    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/graph?projectId=56'))).toBe(true));
  });

  it('404 — «Объект не найден», сбой сервера — ошибка словами и «Повторить»', async () => {
    fakeApi([{ match: 'GET /api/projects/56/dossier', respond: () => ({ status: 404, body: { error: 'not found' } }) }]);
    renderWithRouter([{ path: '/projects/:id', element: <ProjectPage /> }], ['/projects/56']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Объект не найден' })).toBeTruthy();
  });

  it('сбой сервера — не «не найдено»: текст ошибки и «Повторить»', async () => {
    fakeApi([{ match: 'GET /api/projects/56/dossier', respond: () => ({ status: 500, body: { error: 'db down' } }) }]);
    renderWithRouter([{ path: '/projects/:id', element: <ProjectPage /> }], ['/projects/56']);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Сбой сервера \(500\)/);
    expect(within(alert).getByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByText('Объект не найден')).toBeNull();
  });
});
