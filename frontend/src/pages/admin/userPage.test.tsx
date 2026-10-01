// Страница пользователя (админка): роль и доступ, ключи доступа — «Убрать» после подтверждения, открытые
// входы и журнал только этого пользователя; неизвестный — «не найден»; без права users.manage — ни одного запроса.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { IUserRow } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { UserPage } from './UserPage';

const IVAN: IUserRow = {
  id: 2,
  login: 'ivanov',
  displayName: 'Иван Иванов',
  role: 'operator',
  isActive: true,
  mustChangePassword: false,
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: '2026-09-30T08:00:00Z',
  passwordChangedAt: '2026-09-01T08:00:00Z',
  createdAt: '2026-09-01T08:00:00Z',
  createdBy: 'ivanov',
  updatedAt: '2026-09-01T08:00:00Z',
  version: 3,
  registration: 'approved',
};

const page = (ui: ReactElement = <UserPage />, can = true) => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, can: () => can, user: { ...LOCAL_AUTH.user, id: 1, login: 'boss' } }}>
    <Routes>
      <Route path="/admin/users/:id" element={ui} />
    </Routes>
  </AuthContext.Provider>
);

describe('страница пользователя', () => {
  it('доступ, ключи, входы и журнал этого пользователя; ключ убирается после подтверждения', async () => {
    let keys = [{ id: 9, name: 'iPhone', deviceType: 'multiDevice', backedUp: true, createdAt: '2026-10-01T08:00:00Z', lastUsedAt: null }];
    const api = fakeApi([
      { match: 'GET /api/users/2/passkeys', respond: () => ({ status: 200, body: { enabled: true, items: keys } }) },
      { match: 'GET /api/users/2/sessions', respond: () => ({ status: 200, body: { items: [] } }) },
      { match: 'GET /api/users/events', respond: () => ({ status: 200, body: { items: [], nextBefore: null } }) },
      { match: 'GET /api/users/2', respond: () => ({ status: 200, body: IVAN }) },
      {
        match: 'POST /api/users/2/passkeys/9/revoke',
        respond: () => {
          keys = [];
          return { status: 200, body: { ok: true } };
        },
      },
    ]);
    renderWithProviders(page(), '/admin/users/2');

    expect(await screen.findByRole('heading', { level: 1, name: 'Иван Иванов' })).not.toBeNull();
    expect((screen.getByLabelText('Роль: Иван Иванов') as HTMLSelectElement).value).toBe('operator');
    expect(screen.getByText(/по заявке с экрана входа/)).not.toBeNull();
    expect(await screen.findByText('Открытых входов нет.')).not.toBeNull();
    await waitFor(() => expect(api.calls.some(c => c.url.startsWith('/api/users/events') && c.url.includes('userId=2'))).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: 'Убрать «iPhone»' }));
    const confirm = await screen.findByRole('dialog', { name: 'Убрать ключ «iPhone»?' });
    expect(api.calls.some(c => c.method === 'POST')).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Убрать ключ' }));
    expect(await screen.findByText('Ключей нет — пользователь входит по паролю.')).not.toBeNull();
    expect(api.calls.some(c => c.method === 'POST' && c.url === '/api/users/2/passkeys/9/revoke')).toBe(true);
  });

  it('неизвестный пользователь — «не найден» и путь к списку', async () => {
    fakeApi([{ match: 'GET /api/users/404', respond: () => ({ status: 404, body: { error: 'Пользователь не найден', code: 'not_found' } }) }]);
    renderWithProviders(page(), '/admin/users/404');
    expect(await screen.findByRole('heading', { level: 1, name: 'Пользователь не найден' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'К пользователям' }).getAttribute('href')).toBe('/admin/users');
  });

  it('без права users.manage — отказ словами и ни одного запроса', async () => {
    const api = fakeApi([]);
    renderWithProviders(page(<UserPage />, false), '/admin/users/2');
    expect(await screen.findByText('Пользователями управляет администратор.')).not.toBeNull();
    expect(api.calls).toEqual([]);
  });
});
