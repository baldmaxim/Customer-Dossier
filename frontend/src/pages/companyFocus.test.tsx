// Сведения ЕГРЮЛ из Контур.Фокуса на карточке компании (ADR-015): в шапке — статус, руководитель и
// юридический адрес с подписью, откуда они и на какую дату; на первой вкладке «Сведения» (ADR-016) — раздел «ЕГРЮЛ» с атрибуцией,
// «было — стало» и ссылкой на Фокус. «Обновить» — только тому, у кого sources.manage. Фокус не
// подключён — шапка как раньше, раздел говорит это словами.

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { AccessPermission } from '../api/types';
import { AuthContext, LOCAL_AUTH } from '../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../test/render';
import { companyRoutes, focusFound, focusView } from './companyPage.fixtures';
import { CompanyPage } from './CompanyPage';

const card = (): ReactElement => (
  <Routes>
    <Route path="/company/:id" element={<CompanyPage />} />
  </Routes>
);

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const egrulSection = async (): Promise<HTMLElement> =>
  (await screen.findByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус', level: 2 })).closest('section')!;

describe('Контур.Фокус на карточке компании', () => {
  it('шапка: статус, руководитель и юридический адрес — с подписью источника и даты', async () => {
    fakeApi(companyRoutes({ focus: focusFound() }));
    renderWithProviders(card(), '/company/7');

    const requisites = await screen.findByLabelText('Реквизиты');
    await waitFor(() => expect(within(requisites).getByText('Статус в ЕГРЮЛ')).toBeTruthy());
    expect(within(requisites).getByText('Действующее')).toBeTruthy();
    expect(within(requisites).getByText('Петров Пётр Петрович — Генеральный директор, с 01.09.2026')).toBeTruthy();
    expect(within(requisites).getByText('420000, Респ Татарстан, г Казань, ул Баумана, д 1')).toBeTruthy();
    expect(screen.getByText(/ЕГРЮЛ по данным Контур\.Фокуса, проверено 02\.10\.2026/)).toBeTruthy();
  });

  it('Фокус не подключён — в шапке строк ЕГРЮЛ нет; раздел говорит это словами', async () => {
    fakeApi(companyRoutes());
    renderWithProviders(card(), '/company/7');

    const section = await egrulSection();
    expect(await within(section).findByText(/Контур\.Фокус не подключён/)).toBeTruthy();
    expect(screen.queryByText('Статус в ЕГРЮЛ')).toBeNull();
    expect(within(section).queryByRole('button', { name: /Обновить из Контур\.Фокуса/ })).toBeNull();
  });

  it('«Сведения» → ЕГРЮЛ: строки, атрибуция, «было — стало», ссылка только на сам Фокус', async () => {
    fakeApi(companyRoutes({ focus: focusFound() }));
    renderWithProviders(card(), '/company/7');

    const section = await egrulSection();
    expect(await within(section).findByText('42.13 Строительство мостов и тоннелей')).toBeTruthy();
    expect(within(section).getByText(/проверено 02\.10\.2026; последнее изменение получено 01\.10\.2026/)).toBeTruthy();
    // Шапка уже показала статус, руководителя и адрес — раздел их не повторяет; атрибуция Фокуса — внизу вкладки.
    expect(within(section).queryByText('Статус')).toBeNull();
    expect(within(section).queryByText('Юридический адрес')).toBeNull();
    expect(within(section).queryByText(/а не оценка компании/)).toBeNull();
    const sources = screen.getByRole('heading', { name: 'Источники и даты' }).closest('section')!;
    expect(within(sources).getByText(/а не оценка компании/)).toBeTruthy();
    expect(within(section).getByRole('heading', { name: 'Что изменилось в ЕГРЮЛ' })).toBeTruthy();
    expect(within(section).getByText('Иванов Иван Иванович — Генеральный директор')).toBeTruthy();
    expect(within(section).getByText(/Следующее обновление — 16\.10\.2026/)).toBeTruthy();
    const link = within(section).getByRole('link', { name: /Открыть в Контур\.Фокусе/ });
    expect(link.getAttribute('href')).toBe('https://focus.kontur.ru/entity?query=1027700000001');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('«Обновить» — запрос, новые сведения на месте прежних, итог словами', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/companies/7/focus/refresh',
        respond: () => ({
          status: 200,
          body: { outcome: 'found', saved: 1, view: focusFound({ summary: { status: 'В стадии ликвидации', head: null, address: null } }) },
        }),
      },
      ...companyRoutes({ focus: focusView({ configured: true }) }),
    ]);
    renderWithProviders(card(), '/company/7');

    const section = await egrulSection();
    expect(await within(section).findByText(/ещё не запрашивались — придут с обновлением по расписанию/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Обновить из Контур.Фокуса' }));
    expect(await screen.findByText('Сведения ЕГРЮЛ обновлены — есть изменения.')).toBeTruthy();
    expect(api.calls.filter(c => c.method === 'POST').map(c => c.url)).toEqual(['/api/companies/7/focus/refresh']);
    // Шапка читает тот же кэш: статус пришёл с ответом кнопки.
    expect(await screen.findByText('В стадии ликвидации')).toBeTruthy();
  });

  it('отказ Фокуса — тост с причиной; читателю кнопки нет', async () => {
    fakeApi([
      {
        match: 'POST /api/companies/7/focus/refresh',
        respond: () => ({ status: 429, body: { error: 'Лимит запросов к Контур.Фокусу на сутки исчерпан', code: 'focus_limit' } }),
      },
      ...companyRoutes({ focus: focusView({ configured: true }) }),
    ]);
    renderWithProviders(card(), '/company/7');
    fireEvent.click(await within(await egrulSection()).findByRole('button', { name: 'Обновить из Контур.Фокуса' }));
    expect(await screen.findByText('Лимит запросов к Контур.Фокусу на сутки исчерпан')).toBeTruthy();
  });

  it('читатель видит сведения, но не кнопку', async () => {
    fakeApi(companyRoutes({ focus: focusFound() }));
    renderWithProviders(as(['portal.read'], card()), '/company/7');
    const section = await egrulSection();
    expect(await within(section).findByText('42.13 Строительство мостов и тоннелей')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: /Обновить/ })).toBeNull();
  });

  it('у имени нет ИНН и ОГРН — над названием «Юрлицо не установлено», назначение свёрнуто в шапке (ADR-016)', async () => {
    fakeApi(companyRoutes({ focus: focusView({ configured: true, identifier: null, problem: 'no_identifier' }), companyOver: { identifiers: [] } }));
    renderWithProviders(card(), '/company/7');
    expect(await screen.findByRole('button', { name: 'Пояснение: юрлицо не установлено' })).toBeTruthy();
    const assign = screen.getByText('Назначить компании').closest('details')!;
    expect(assign.open).toBe(false);
    expect(within(assign).getByText(/имя из публикаций без ИНН/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'ЕГРЮЛ — Контур.Фокус' })).toBeNull();
  });

  it('заголовок — наименование по ЕГРЮЛ, имя из публикаций — строкой реквизитов', async () => {
    fakeApi(companyRoutes({ focus: focusFound(), companyOver: { egrul: { name: 'ООО "МОСТОСТРОЙ"', fullName: null, status: 'Действующее', fetchedAt: '2026-10-02T08:00:00Z' } } }));
    renderWithProviders(card(), '/company/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'ООО "МОСТОСТРОЙ"' })).toBeTruthy();
    const requisites = screen.getByLabelText('Реквизиты');
    expect(within(requisites).getByText('В публикациях').nextElementSibling?.textContent).toBe('ООО «Мостострой»');
  });
});
