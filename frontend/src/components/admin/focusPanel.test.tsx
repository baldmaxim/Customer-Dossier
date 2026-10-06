// Контур.Фокус в админке (вкладка «Сервисы», раскрытием): состояние словами, расход тарифа за сутки, ключ — только
// администратору (поле очищается после сохранения, ключ на экран не возвращается), журнал запросов
// подписями, а не машинными значениями. Имена переменных окружения — только в пояснении.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, IFocusKeyStatus, IFocusSettings } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { FocusPanel } from './FocusPanel';

const SECRET = 'focus-test-secret-9f3a';

const keyStatus = (over: Partial<IFocusKeyStatus> = {}): IFocusKeyStatus => ({
  source: 'none',
  hint: null,
  updatedAt: null,
  updatedBy: null,
  envKeySet: false,
  problem: null,
  canStore: true,
  ...over,
});

const settings = (over: Partial<IFocusSettings> = {}): IFocusSettings => ({
  key: keyStatus(),
  enabled: true,
  dailyLimit: 100,
  refreshDays: 14,
  usedLastDay: 6,
  coverage: { companies: 40, identifiers: 38, found: 3, notFound: 1, due: 34, failing: 0 },
  recent: [
    { requestedAt: '2026-10-02T08:00:00Z', method: 'egrDetails', identifiersCount: 1, httpStatus: 403, outcome: 'method_forbidden', error: 'Access denied', actor: 'scheduler' },
    { requestedAt: '2026-10-02T07:59:00Z', method: 'req', identifiersCount: 1, httpStatus: 200, outcome: 'ok', error: null, actor: 'boss' },
  ],
  ...over,
});

const as = (permissions: AccessPermission[], ui: ReactElement): ReactElement => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}>
    {ui}
  </AuthContext.Provider>
);

const ADMIN: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage', 'focus.manage'];
const OPERATOR: AccessPermission[] = ['portal.read', 'admin.view', 'sources.manage'];

describe('страница Контур.Фокуса', () => {
  it('состояние: расписание, расход за сутки, покрытие; журнал — подписями', async () => {
    fakeApi([{ match: 'GET /api/admin/focus', respond: () => ({ status: 200, body: settings() }) }]);
    renderWithProviders(as(ADMIN, <FocusPanel />));

    expect(await screen.findByText(/по расписанию, раз в 14 дн\./)).toBeTruthy();
    expect(screen.getByText('6 из 100 — компания стоит два запроса')).toBeTruthy();
    expect(screen.getByText('40 (разных реквизитов — 38)')).toBeTruthy();
    expect(screen.getByText(/деятельность и учредители · не входит в тариф \(HTTP 403\) · по расписанию/)).toBeTruthy();
    expect(screen.getByText(/реквизиты и статус · ответ получен · boss/)).toBeTruthy();
    expect(screen.getByText('Без ключа портал к Контур.Фокусу не обращается.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/FOCUS_DAILY_LIMIT|method_forbidden|scheduler/);
    expect(screen.getByRole('button', { name: 'Пояснение: где это настраивается' }).getAttribute('aria-description')).toMatch(/FOCUS_DAILY_LIMIT/);
  });

  it('сохранение: ключ уходит один раз, поле очищается, на экране — только четыре последних символа', async () => {
    let saved = false;
    const api = fakeApi([
      {
        match: 'GET /api/admin/focus',
        respond: () => ({
          status: 200,
          body: settings({ key: saved ? keyStatus({ source: 'admin', hint: '9f3a', updatedAt: '2026-10-02T09:00:00Z', updatedBy: 'boss' }) : keyStatus() }),
        }),
      },
      {
        match: 'PUT /api/admin/focus/key',
        respond: () => {
          saved = true;
          return { status: 200, body: { key: keyStatus({ source: 'admin', hint: '9f3a' }), check: { verdict: 'accepted', error: null } } };
        },
      },
    ]);
    renderWithProviders(as(ADMIN, <FocusPanel />));

    const field = (await screen.findByLabelText(/Ключ Контур\.Фокуса/)) as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: ` ${SECRET} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    expect(await screen.findByText('Ключ сохранён, Контур.Фокус его принял.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('задан в админке, оканчивается на …9f3a')).toBeTruthy());
    expect(api.calls.filter(c => c.method === 'PUT')).toEqual([{ method: 'PUT', url: '/api/admin/focus/key', body: { key: SECRET } }]);
    expect(((await screen.findByLabelText(/Новый ключ Контур\.Фокуса/)) as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('оператор видит состояние, но не форму ключа', async () => {
    fakeApi([{ match: 'GET /api/admin/focus', respond: () => ({ status: 200, body: settings({ key: keyStatus({ source: 'env' }) }) }) }]);
    renderWithProviders(as(OPERATOR, <FocusPanel />));

    expect(await screen.findByText('из настроек сервера')).toBeTruthy();
    expect(screen.getByText('Ключ задаёт администратор.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Сохранить ключ' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Пояснение/ })).toBeNull();
  });

  it('состояние не получено — ошибка с «Повторить», а не пустая страница', async () => {
    fakeApi([{ match: 'GET /api/admin/focus', respond: () => ({ status: 500, body: { error: 'сбой' } }) }]);
    renderWithProviders(as(ADMIN, <FocusPanel />));
    expect(await screen.findByText('Состояние Контур.Фокуса не получено')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});
