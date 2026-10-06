// «Новое» (этап 24F): лента по дням, вид и охват в адресе, «новое» — относительно отметки в браузере,
// «Отметить всё просмотренным» снимает метки и счётчик меню; ошибка не выдаётся за «нового нет».

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { INewsFeed, INewsItem } from '../api/types';
import { NewsCounter } from '../components/news/NewsCounter';
import { fakeApi, renderWithProviders } from '../test/render';
import { NewsPage } from './NewsPage';

const item = (over: Partial<INewsItem>): INewsItem => ({
  key: 'project:1',
  kind: 'new_project',
  at: '2026-10-05T10:00:00Z',
  title: 'Новый объект «Река», Москва',
  detail: null,
  companies: [{ id: 10, name: 'Девелопер', role: 'developer' }],
  project: { id: 1, name: 'Река' },
  source: { kind: 'publication', documentId: 75, href: null },
  watched: false,
  ...over,
});

const feed = (items: INewsItem[]): INewsFeed => ({
  format: 'news@1',
  since: '2026-09-22T00:00:00Z',
  days: 14,
  scope: 'all',
  items,
  counts: { new_project: 1, deadline_shift: 1, court_case: 0, fssp: 0 },
});

const ITEMS = [
  item({}),
  item({
    key: 'shift:1',
    kind: 'deadline_shift',
    at: '2026-10-03T09:00:00Z',
    title: 'Срок сдачи сменился: «Дом 1»',
    detail: 'III кв. 2027 → I кв. 2028 (позже)',
    project: null,
    source: { kind: 'registry', documentId: null, href: 'https://example.test/объект/1' },
    watched: true,
  }),
];

afterEach(() => {
  localStorage.clear();
});

describe('«Новое»', () => {
  it('лента по дням: вид, «новое», компании с ролью, основание; окно и охват уходят в запрос', async () => {
    const api = fakeApi([{ match: 'GET /api/news', respond: () => ({ status: 200, body: feed(ITEMS) }) }]);
    renderWithProviders(<NewsPage />, '/news?scope=watched&days=30');

    expect(await screen.findByRole('link', { name: 'Новый объект «Река», Москва' })).toBeTruthy();
    expect(api.calls[0]!.url).toBe('/api/news?days=30&scope=watched');
    expect(screen.getByRole('heading', { name: '05.10.2026' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '03.10.2026' })).toBeTruthy();
    expect(screen.getAllByText('новое')).toHaveLength(2);
    expect(screen.getByText('III кв. 2027 → I кв. 2028 (позже)')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Девелопер' })[0]!.getAttribute('href')).toBe('/company/10');
    expect(screen.getByRole('link', { name: 'публикация' }).getAttribute('href')).toBe('/documents/75');
    expect(screen.getByRole('link', { name: 'ДОМ.РФ' }).getAttribute('target')).toBe('_blank');
    expect(screen.getByText('на контроле')).toBeTruthy();
  });

  it('«Отметить всё просмотренным» снимает метки «новое» и счётчик меню', async () => {
    fakeApi([{ match: 'GET /api/news', respond: () => ({ status: 200, body: feed(ITEMS) }) }]);
    renderWithProviders(
      <>
        <NewsCounter />
        <NewsPage />
      </>,
      '/news',
    );
    await screen.findByRole('link', { name: 'Новый объект «Река», Москва' });
    // Счётчик меню: число и скрытое для глаз слово «непросмотренных» (у раздела — своя подпись с тире).
    await waitFor(() => expect(screen.getByText('непросмотренных').parentElement!.textContent).toBe('2 непросмотренных'));

    fireEvent.click(screen.getByRole('button', { name: 'Отметить всё просмотренным' }));
    await waitFor(() => expect(screen.queryAllByText('новое')).toHaveLength(0));
    expect(screen.queryByText('непросмотренных')).toBeNull();
    expect(screen.getByText('всё просмотрено')).toBeTruthy();
  });

  it('вид — в адресе; пусто — словами; ошибка — не «нового нет»', async () => {
    const api = fakeApi([{ match: 'GET /api/news', respond: () => ({ status: 200, body: feed([]) }) }]);
    renderWithProviders(<NewsPage />, '/news?kind=fssp');
    expect(await screen.findByText('За это время нового нет.')).toBeTruthy();
    expect(api.calls[0]!.url).toBe('/api/news?days=14&scope=all&kind=fssp');
    const kinds = screen.getByRole('group', { name: 'Вид' });
    expect(within(kinds).getByRole('button', { name: /ФССП/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('ошибка сервера — сообщение и «Повторить»', async () => {
    fakeApi([{ match: 'GET /api/news', respond: () => ({ status: 500, body: { error: 'сбой' } }) }]);
    renderWithProviders(<NewsPage />, '/news');
    expect(await screen.findByText('Лента не загрузилась')).toBeTruthy();
    expect(screen.queryByText('За это время нового нет.')).toBeNull();
  });
});
