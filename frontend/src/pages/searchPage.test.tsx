// Каталог и лента: строка открывается целиком, а не только имя.
//
// Накладка — псевдоэлемент, в jsdom её клик не проверить: здесь проверяется разметка
// (ссылка-накладка в строке, соседние цели подняты над ней), а сам переход по пустой
// ячейке — в e2e (dailyRoute.spec.ts).
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { ContractorsPage } from './ContractorsPage';
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
  sourceTitle: 'Канал',
  sourceKind: 'telegram',
  sourceKey: 'demo',
  publishedAt: '2026-09-20T09:00:00Z',
  firstObservedAt: '2026-09-20T09:05:00Z',
  canonicalUrl: null,
  state: 'active',
  title: 'Конкурс на корпус 3',
  completeness: 'full',
  revisionNo: 1,
  documentId: 19,
  bodyChars: 120,
  revisionCount: 2,
};

const routes = (feed: unknown[] = [feedItem]) => [
  { match: 'GET /api/contractors/summary', respond: () => ({ status: 200, body: { byIdentity: [], refresh, totals: { companies: 19, projects: 3, documents: 21, pendingMerges: 0, lonelyCompanies: 4 } } }) },
  { match: 'GET /api/contractors', respond: () => ({ status: 200, body: { status: 'ok', refresh, items: [row] } }) },
  { match: 'GET /api/feed', respond: () => ({ status: 200, body: { items: feed } }) },
];

describe('Главная: строка целиком — цель перехода', () => {
  it('в строке каталога ссылка накрывает строку, «схема» остаётся отдельной целью', async () => {
    fakeApi(routes());
    const { container } = renderWithProviders(<SearchPage />);

    const company = await screen.findByRole('link', { name: 'ООО «Пример»' });
    expect(company.getAttribute('href')).toBe('/company/42');
    expect(company.className).toContain('row-link-target');
    expect(company.closest('tr')?.className).toContain('row-link');

    const graph = screen.getByRole('link', { name: 'схема' });
    expect(graph.className).toContain('row-link-above');
    expect(container.querySelectorAll('tr.row-link').length).toBeGreaterThan(0);
  });

  it('строка ленты ведёт к публикации; без документа вести некуда', async () => {
    fakeApi(routes([feedItem, { ...feedItem, id: 6, title: 'Без документа', documentId: null, revisionCount: 1 }]));
    renderWithProviders(<SearchPage />);

    const doc = await screen.findByRole('link', { name: 'Конкурс на корпус 3' });
    expect(doc.getAttribute('href')).toBe('/documents/19');
    expect(doc.closest('tr')?.className).toContain('row-link');

    const plain = screen.getByText('Без документа');
    expect(plain.closest('a')).toBeNull();
    expect(plain.closest('tr')?.className ?? '').not.toContain('row-link');
  });
});

describe('Подрядчики: то же правило строки', () => {
  it('строка таблицы и карточка на смартфоне открывают компанию целиком', async () => {
    fakeApi([
      { match: 'GET /api/contractors', respond: () => ({ status: 200, body: { status: 'ok', refresh, items: [row] } }) },
    ]);
    const { container } = renderWithProviders(<ContractorsPage />, '/contractors');

    const links = await screen.findAllByRole('link', { name: 'ООО «Пример»' });
    expect(links.every(l => l.className.includes('row-link-target'))).toBe(true);
    expect(container.querySelectorAll('tr.row-link').length).toBe(1);
    // Мобильная раскладка — та же строка карточкой, и она тоже целиком ссылка.
    expect(container.querySelectorAll('article.row-link').length).toBe(1);
  });
});
