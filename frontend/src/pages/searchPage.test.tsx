// Главная: переключатель «Компании / Публикации» и один поиск, который меняет смысл вместе с ним.
//
// Накладка строки каталога — псевдоэлемент, в jsdom её клик не проверить: здесь проверяется
// разметка (ссылка-накладка в строке, соседние цели подняты над ней), а сам переход по
// пустой ячейке — в e2e (dailyRoute.spec.ts).
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
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
  publications: 3,
  families: 1,
  courtRoles: null,
};

const feedItem = {
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
};

const routes = () => [
  { match: 'GET /api/contractors/summary', respond: () => ({ status: 200, body: { byIdentity: [], refresh, totals: { companies: 19, projects: 3, documents: 21, pendingMerges: 0, lonelyCompanies: 4 } } }) },
  { match: 'GET /api/contractors', respond: () => ({ status: 200, body: { status: 'ok', refresh, items: [row] } }) },
  { match: 'GET /api/feed', respond: () => ({ status: 200, body: { items: [feedItem], nextCursor: null } }) },
  { match: 'GET /api/revisions/9', respond: () => ({ status: 200, body: { revision: { id: 9, sourceItemId: 5, revisionNo: 1, title: null, body: 'Полный текст поста о корпусе 3.', representation: 'x', bodyHash: 'x', completeness: 'full', completenessReason: null, attachments: [], publishedAt: '2026-09-20T09:00:00Z', sourceModifiedAt: null, firstObservedAt: '2026-09-20T09:05:00Z', chronology: 'observed_order', sameContentAsRevisionId: null, legacyDocumentId: 19, origin: 'ingest' } } }) },
];

describe('Главная', () => {
  it('в строке каталога ссылка накрывает строку, «схема» остаётся отдельной целью', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(<SearchPage />);

    const link = await screen.findByRole('link', { name: 'ООО «Пример»' });
    expect(link.getAttribute('href')).toBe('/company/42');
    expect(link.className).toContain('row-link-target');
    expect(link.closest('tr')?.className).toContain('row-link');
    expect(screen.getByRole('link', { name: 'схема' }).className).toContain('row-link-above');
    expect(container.querySelectorAll('tr.row-link').length).toBe(1);
  });

  it('под названием компании ничего нет: город — своей колонкой, ярлыка идентификации нет', async () => {
    fakeApi(routes());
    renderWithProviders(<SearchPage />);

    const cell = (await screen.findByRole('link', { name: 'ООО «Пример»' })).closest('td')!;
    expect(cell.textContent).toBe('ООО «Пример»');
    expect(screen.getByRole('cell', { name: 'Москва' })).toBeTruthy();
    expect(screen.queryByText('только название, реквизитов нет')).toBeNull();
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

  it('в режиме публикаций поиск уходит в ленту, а не в поиск компаний', async () => {
    const api = fakeApi(routes());
    renderWithProviders(<SearchPage />, '/?view=publications');
    await screen.findByText('Конкурс на корпус 3');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Поиск по публикациям' }), { target: { value: 'корпус' } });

    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/feed') && c.url.includes('q=%D0%BA%D0%BE%D1%80%D0%BF%D1%83%D1%81'))).toBe(true));
    expect(api.calls.some(c => c.url.startsWith('/api/companies?q='))).toBe(false);
  });
});
