// «С сайта компании» на вкладке «Объекты» (этап 25B): нет подтверждённого сайта — блока нет; проекты с отметками
// «новое» и «нет на портале», совпавший — ссылкой на объект портала; сайт не прочитан — словами.

import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ICompanySiteProjectRow, ICompanySiteProjects } from '../../api/types';
import { fakeApi, renderWithProviders } from '../../test/render';
import { CompanySiteProjects } from './CompanySiteProjects';

const row = (over: Partial<ICompanySiteProjectRow> = {}): ICompanySiteProjectRow => ({
  name: 'ЖК «Берег»',
  status: 'planned',
  completion: 'IV квартал 2028',
  city: 'Москва',
  address: null,
  quote: 'ЖК «Берег» — скоро старт продаж',
  host: 'demo.ru',
  pageUrl: 'https://demo.ru/projects',
  pageTitle: 'Проекты',
  seenAt: '2026-10-06T10:00:00Z',
  firstSeenAt: '2026-10-01T10:00:00Z',
  isNew: true,
  match: null,
  ...over,
});

const SITE = { host: 'demo.ru', url: 'https://demo.ru/', status: 'active' as const, health: 'ok', healthReason: null, lastReadAt: '2026-10-06T10:00:00Z', pages: 2 };

const serve = (body: ICompanySiteProjects, companyId = 7) =>
  fakeApi([{ match: `GET /api/companies/${companyId}/site-projects`, respond: () => ({ status: 200, body }) }]);

afterEach(() => vi.unstubAllGlobals());

describe('проекты с сайта компании', () => {
  it('новое и «нет на портале» — ярлыками; совпавший — ссылкой на объект; цитата и страница видны', async () => {
    serve({ sites: [SITE], projects: [row(), row({ name: 'ЖК «Остров»', status: 'selling', completion: null, quote: 'ЖК «Остров» — в продаже', isNew: false, match: { projectId: 42, name: 'Остров' } })], waiting: 1 });
    renderWithProviders(<CompanySiteProjects companyId={7} />);
    expect(await screen.findByText('С сайта компании')).toBeTruthy();
    expect(screen.getByText('проектов 2, нет на портале 1')).toBeTruthy();
    expect(screen.getByText('новое')).toBeTruthy();
    expect(screen.getByText('нет на портале')).toBeTruthy();
    expect(screen.getByText('сдача: IV квартал 2028')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ЖК «Остров»' }).getAttribute('href')).toBe('/projects/42');
    expect(screen.getByText('«ЖК «Берег» — скоро старт продаж»')).toBeTruthy();
    expect(screen.getByText(/Страниц ждут разбора: 1/)).toBeTruthy();
  });

  it('подтверждённого сайта нет — блока нет; сайт не прочитан — словами с причиной', async () => {
    const api = serve({ sites: [], projects: [], waiting: 0 });
    const { container } = renderWithProviders(<CompanySiteProjects companyId={7} />);
    await vi.waitFor(() => expect(api.calls.length).toBe(1));
    expect(container.textContent).toBe('');

    serve({ sites: [{ ...SITE, lastReadAt: null, health: 'blocked', healthReason: 'robots.txt сайта запрещает читать главную страницу' }], projects: [], waiting: 0 }, 8);
    renderWithProviders(<CompanySiteProjects companyId={8} />);
    expect(await screen.findByText('Сайт ещё не прочитан.')).toBeTruthy();
    expect(screen.getByText(/не прочитан: доступ закрыт — robots\.txt/)).toBeTruthy();
  });
});
