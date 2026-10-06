// Страница «Сайты компаний» (этап 25A): поиск выключен — так и сказано, сайт можно указать вручную; очередь —
// компании с кандидатами и решениями; фильтр — в адресе и уходит в запрос.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../../test/render';
import { CompanySitesPage } from './CompanySitesPage';

const TOTALS = { searched: 40, withPending: 1, confirmed: 12, notFound: 9, usedLastDay: 7 };

const ROW = {
  companyId: 7,
  name: 'Демо-Строй',
  roles: ['customer'],
  search: { query: 'q', outcome: 'found', resultCount: 5, searchedAt: '2026-10-06T09:00:00Z', nextSearchAt: '2027-01-04T09:00:00Z', lastError: null, requestedBy: null },
  candidates: [
    {
      id: 11,
      companyId: 7,
      host: 'demo-stroy.ru',
      url: 'https://demo-stroy.ru/',
      foundVia: 'web_search',
      title: null,
      snippet: null,
      modelReason: 'ИНН в подвале',
      model: 'm',
      checkStatus: 'blocked',
      checkedAt: '2026-10-06T10:00:00Z',
      checkError: 'HTTP 403',
      pageTitle: null,
      innOnPage: null,
      ogrnOnPage: null,
      nameOnPage: null,
      otherInns: [],
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      firstSeenAt: '2026-10-06T09:00:00Z',
      sharedWith: [{ companyId: 3, name: 'ГК Демо' }],
    },
  ],
};

describe('Страница «Сайты компаний»', () => {
  it('поиск выключен — пояснение; очередь с признаками; «Указать вручную» отправляет адрес', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/company-sites/summary', respond: () => ({ status: 200, body: { mode: 'off', dailyLimit: 50, totals: TOTALS } }) },
      { match: 'GET /api/admin/company-sites', respond: () => ({ status: 200, body: { mode: 'off', dailyLimit: 50, items: [ROW], matched: 1, totals: TOTALS } }) },
      { match: 'POST /api/admin/company-sites/7/manual', respond: () => ({ status: 200, body: { id: 20, companyId: 7, host: 'demo.ru' } }) },
    ]);
    renderWithProviders(<CompanySitesPage />, '/admin/sources/company-sites');

    expect(await screen.findByText('Поиск сайтов выключен')).toBeTruthy();
    expect(await screen.findByText('Поисков за сутки: 7 из 50. Каждый поиск платный (веб-поиск OpenRouter).')).toBeTruthy();
    expect(await screen.findByText('закрыт для портала')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ГК Демо' })).toBeTruthy();
    expect(screen.getByText('Ждут решения: 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Указать вручную… — Демо-Строй' }));
    fireEvent.change(screen.getByLabelText('Сайт «Демо-Строй»'), { target: { value: 'https://demo.ru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(api.calls.find(c => c.method === 'POST')?.body).toEqual({ url: 'https://demo.ru' }));
  });
});
