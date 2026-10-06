// Страница parser-api.com в админке (этап 24A): расход за сутки и месяц, охват компаний «на контроле», ключ —
// только администратору (поле очищается после сохранения, ключ на экран не возвращается, «принят» не говорим),
// журнал — подписями и с пометкой оплаченного.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, ILlmKeyStatus, IParserApiSettings } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { ParserApiPage } from './ParserApiPage';

const SECRET = 'parser-test-secret-4c1d';

const keyStatus = (over: Partial<ILlmKeyStatus> = {}): ILlmKeyStatus => ({
  source: 'none',
  hint: null,
  updatedAt: null,
  updatedBy: null,
  envKeySet: false,
  problem: null,
  canStore: true,
  ...over,
});

const settings = (over: Partial<IParserApiSettings> = {}): IParserApiSettings => ({
  key: keyStatus(),
  enabled: false,
  limits: { daily: 20, monthly: 200 },
  kadMaxPages: 3,
  usage: { day: 4, month: 37 },
  coverage: { watched: 5, checked: 12, failing: 1, due: 13 },
  recent: [
    { requestedAt: '2026-10-06T08:00:00Z', method: 'kad_search', inn: '7736255508', page: 2, httpStatus: 403, apiCode: 40303, outcome: 'ip_rejected', billable: false, error: 'IP', actor: 'scheduler' },
    { requestedAt: '2026-10-06T07:59:00Z', method: 'bo_details', inn: '7736255508', page: null, httpStatus: 200, apiCode: null, outcome: 'ok', billable: true, error: null, actor: 'boss' },
  ],
  ...over,
});

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const ADMIN: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage', 'parserapi.manage'];
const OPERATOR: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage'];

describe('страница parser-api.com', () => {
  it('состояние: только кнопкой, расход за сутки и месяц, охват; журнал — подписями, оплаченное помечено', async () => {
    fakeApi([{ match: 'GET /api/admin/parser-api', respond: () => ({ status: 200, body: settings() }) }]);
    renderWithProviders(as(ADMIN, <ParserApiPage />));

    expect(await screen.findByText('только кнопкой в карточке компании')).toBeTruthy();
    expect(screen.getByText('4 из 20')).toBeTruthy();
    expect(screen.getByText(/37 из 200 — полная проверка компании стоит 6–9 запросов/)).toBeTruthy();
    expect(screen.getByText(/картотека дел · ИНН 7736255508 · стр\. 2 · адрес портала не разрешён \(HTTP 403, код 40303\) · по расписанию/)).toBeTruthy();
    expect(screen.getByText(/ГИР БО: отчётность · ИНН 7736255508 · ответ получен \(списан с тарифа\) · boss/)).toBeTruthy();
    expect(screen.getByText('Без ключа портал к parser-api.com не обращается.')).toBeTruthy();
    // Старый сервер без поля connection, ключа нет — серый «не подключён», не зелёный.
    expect(screen.getByText('не подключён').className).not.toMatch(/success/);
  });

  it('подключение: зелёный «подключён» — только после успешного ответа сервиса; до него — «ждёт первого ответа»', async () => {
    fakeApi([
      {
        match: 'GET /api/admin/parser-api',
        respond: () => ({
          status: 200,
          body: settings({ key: keyStatus({ source: 'admin', hint: 'e97c' }), connection: { state: 'connected', at: '2026-10-06T08:00:00Z' } }),
        }),
      },
    ]);
    renderWithProviders(as(ADMIN, <ParserApiPage />));
    expect((await screen.findByText('подключён')).className).toMatch(/success/);
  });

  it('подключение: ключ задан, настоящего ответа ещё не было — не зелёный', async () => {
    fakeApi([
      { match: 'GET /api/admin/parser-api', respond: () => ({ status: 200, body: settings({ key: keyStatus({ source: 'admin', hint: 'e97c' }), connection: { state: 'unverified', at: null } }) }) },
    ]);
    renderWithProviders(as(ADMIN, <ParserApiPage />));
    expect((await screen.findByText('ключ задан, ждёт первого ответа')).className).not.toMatch(/success/);
  });

  it('оператор видит состояние, но не форму ключа', async () => {
    fakeApi([{ match: 'GET /api/admin/parser-api', respond: () => ({ status: 200, body: settings() }) }]);
    renderWithProviders(as(OPERATOR, <ParserApiPage />));

    expect(await screen.findByText('Ключ задаёт администратор.')).toBeTruthy();
    expect(screen.queryByLabelText(/Ключ parser-api\.com/)).toBeNull();
  });

  it('сохранение ключа: поле очищается, ключ не возвращается, тост не говорит «принят»', async () => {
    let current = settings();
    const api = fakeApi([
      { match: 'GET /api/admin/parser-api', respond: () => ({ status: 200, body: current }) },
      {
        match: 'PUT /api/admin/parser-api/key',
        respond: () => {
          current = settings({ key: keyStatus({ source: 'admin', hint: '4c1d', updatedAt: '2026-10-06T09:00:00Z', updatedBy: 'boss' }) });
          return { status: 200, body: { key: current.key, check: { verdict: 'unknown', error: null } } };
        },
      },
    ]);
    renderWithProviders(as(ADMIN, <ParserApiPage />));

    const input = (await screen.findByLabelText(/Ключ parser-api\.com/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    expect(await screen.findByText(/Ключ сохранён\. Подтвердит первый запрос/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('задан в админке, оканчивается на …4c1d')).toBeTruthy());
    expect(input.value).toBe('');
    expect(api.calls.find(c => c.method === 'PUT')?.body).toEqual({ key: SECRET });
    expect(document.body.textContent).not.toContain(SECRET);
    expect(document.body.textContent).not.toMatch(/принят/);
  });
});
