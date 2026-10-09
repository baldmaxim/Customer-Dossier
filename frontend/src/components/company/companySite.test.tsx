// «Сайт компании» на карточке (этап 25A): подтверждённый сайт — ссылкой; кандидаты из поиска с признаками
// проверки; оператор решает «Это сайт компании / Не он» ярлычками, читатель видит только «ждут решения оператора».
// На карточке коротко: как найден, заголовок страницы, кто решил и объяснение модели — в очереди «Сайты компаний».

import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccessPermission, ICompanySites, ISiteCandidate } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { CompanySite } from './CompanySite';

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const candidate = (over: Partial<ISiteCandidate> = {}): ISiteCandidate => ({
  id: 11,
  companyId: 7,
  host: 'demo-stroy.ru',
  url: 'https://demo-stroy.ru/',
  foundVia: 'web_search',
  title: 'Демо-Строй — квартиры',
  snippet: null,
  modelReason: 'ИНН компании в подвале сайта',
  model: 'test-model',
  checkStatus: 'ok',
  checkedAt: '2026-10-06T10:00:00Z',
  checkError: null,
  pageTitle: 'Демо-Строй',
  innOnPage: true,
  ogrnOnPage: null,
  nameOnPage: true,
  otherInns: [],
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  firstSeenAt: '2026-10-06T09:00:00Z',
  sharedWith: [],
  ...over,
});

const body = (over: Partial<ICompanySites> = {}): ICompanySites => ({
  mode: 'on',
  candidates: [candidate(), candidate({ id: 12, host: 'demo-invest.ru', url: 'https://demo-invest.ru/', innOnPage: false, otherInns: ['7700000016'], modelReason: null })],
  familySites: [],
  search: { query: 'q', outcome: 'found', resultCount: 5, searchedAt: '2026-10-06T09:00:00Z', nextSearchAt: '2027-01-04T09:00:00Z', lastError: null, requestedBy: null },
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('сайт компании на карточке', () => {
  it('оператор: признаки проверки словами, без строк подробностей; «Это сайт компании» отправляет решение', async () => {
    const api = fakeApi([
      { match: 'GET /api/companies/7/site', respond: () => ({ status: 200, body: body() }) },
      { match: 'POST /api/admin/company-site-candidates/11/confirm', respond: () => ({ status: 200, body: { companyId: 7, host: 'demo-stroy.ru' } }) },
    ]);
    renderWithProviders(as(['portal.read', 'sources.manage'], <CompanySite companyId={7} companyName="Демо-Строй" />));
    expect(await screen.findByText('ИНН компании на сайте')).toBeTruthy();
    expect(screen.getByText('на сайте другой ИНН')).toBeTruthy();
    // Подробности поиска на карточке не печатаются.
    expect(screen.queryByText(/Модель:|найден поиском|Демо-Строй — квартиры/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Это сайт компании — demo-stroy.ru' }));
    await waitFor(() => expect(api.calls.some(c => c.method === 'POST' && c.url.endsWith('/company-site-candidates/11/confirm'))).toBe(true));
    expect(await screen.findByText('demo-stroy.ru — сайт компании.')).toBeTruthy();
  });

  it('читатель: подтверждённый сайт ссылкой, кандидаты — только числом, кнопок нет', async () => {
    fakeApi([
      {
        match: 'GET /api/companies/7/site-projects',
        respond: () => ({
          status: 200,
          body: {
            sites: [{ host: 'demo.ru', url: 'https://demo.ru/', status: 'active', health: 'ok', healthReason: null, lastReadAt: '2026-10-06T12:00:00Z', pages: 3 }],
            projects: [
              { name: 'ЖК Остров', status: 'selling', completion: null, city: null, address: null, quote: 'ЖК Остров в продаже', host: 'demo.ru', pageUrl: 'https://demo.ru/p', pageTitle: null, seenAt: '2026-10-06T12:00:00Z', firstSeenAt: '2026-10-06T12:00:00Z', isNew: true, match: null },
            ],
            waiting: 0,
          },
        }),
      },
      {
        match: 'GET /api/companies/7/site',
        respond: () => ({ status: 200, body: body({ candidates: [candidate({ id: 13, host: 'demo.ru', url: 'https://demo.ru/', state: 'confirmed', decidedBy: 'oper', decidedAt: '2026-10-06T11:00:00Z' }), candidate()] }) }),
      },
    ]);
    renderWithProviders(as(['portal.read'], <CompanySite companyId={7} companyName="Демо-Строй" />));
    const link = await screen.findByRole('link', { name: /demo\.ru/ });
    expect(link.getAttribute('href')).toBe('https://demo.ru/');
    expect(screen.getByText('Найдены кандидаты: 1 — ждут решения оператора.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Это сайт компании/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Искать/ })).toBeNull();
    // 25B: прочитан ли сайт и что на нём — ссылкой на вкладку «Объекты».
    expect(await screen.findByRole('link', { name: 'Проектов на сайте: 1, нет на портале: 1' })).toBeTruthy();
    // Один сайт — адрес не повторяется в строке о чтении; кто и когда подтвердил — не на карточке.
    expect(screen.getByText(/^прочитан 06\.10/)).toBeTruthy();
    expect(screen.queryByText(/решение: oper/)).toBeNull();
    expect(screen.queryByText('сайт компании')).toBeNull();
  });

  it('сайта нет, поиск выключен — так и сказано; СЗ показывает сайт группы', async () => {
    fakeApi([
      {
        match: 'GET /api/companies/7/site',
        respond: () => ({ status: 200, body: body({ mode: 'off', candidates: [], search: null, familySites: [{ companyId: 3, companyName: 'ГК Демо', host: 'gk-demo.ru', url: 'https://gk-demo.ru/' }] }) }),
      },
    ]);
    renderWithProviders(as(['portal.read'], <CompanySite companyId={7} companyName="СЗ Демо-1" />));
    expect(await screen.findByText('сайт группы «ГК Демо»')).toBeTruthy();
    expect(screen.getByText('Сайт не искали: поиск сайтов выключен.')).toBeTruthy();
  });

  it('поиск выключен — оператору «Искать сейчас» не предлагается, «Указать вручную» остаётся', async () => {
    fakeApi([{ match: 'GET /api/companies/7/site', respond: () => ({ status: 200, body: body({ mode: 'off', candidates: [], search: null }) }) }]);
    renderWithProviders(as(['portal.read', 'sources.manage'], <CompanySite companyId={7} companyName="ООО Демо" />));
    expect(await screen.findByRole('button', { name: 'Указать вручную… — ООО Демо' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Искать (сейчас|снова)/ })).toBeNull();
  });
});
