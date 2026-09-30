// Экран «Пользователи» (ADR-014): список, создание, смена роли с ожидаемой версией, свою строку
// администратор не меняет, без права users.manage — ни одного запроса.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { IUserRow } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { UsersPage } from './UsersPage';

const row = (id: number, login: string, role: IUserRow['role'], extra: Partial<IUserRow> = {}): IUserRow => ({
  id,
  login,
  displayName: login === 'boss' ? 'Главный' : 'Иван Иванов',
  role,
  isActive: true,
  mustChangePassword: false,
  failedAttempts: 0,
  lockedUntil: null,
  lastLoginAt: '2026-09-30T08:00:00Z',
  passwordChangedAt: '2026-09-01T08:00:00Z',
  createdAt: '2026-09-01T08:00:00Z',
  createdBy: 'cli',
  updatedAt: '2026-09-01T08:00:00Z',
  version: 3,
  liveSessions: 1,
  ...extra,
});

const ROLES = {
  permissions: ['portal.read', 'admin.view', 'users.manage'],
  roles: [
    { role: 'admin', permissions: ['portal.read', 'admin.view', 'users.manage'] },
    { role: 'operator', permissions: ['portal.read', 'admin.view'] },
    { role: 'viewer', permissions: ['portal.read'] },
  ],
};

const asAdmin = (ui: ReactElement) => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, user: { ...LOCAL_AUTH.user, id: 1, login: 'boss' } }}>{ui}</AuthContext.Provider>
);

const standardRoutes = (users: IUserRow[]) => [
  { match: 'GET /api/users/roles', respond: () => ({ status: 200, body: ROLES }) },
  { match: 'GET /api/users/events', respond: () => ({ status: 200, body: { items: [], nextBefore: null } }) },
  { match: 'GET /api/users', respond: () => ({ status: 200, body: { items: users } }) },
];

describe('экран «Пользователи»', () => {
  it('список с ролями; свою роль и доступ администратор не меняет', async () => {
    fakeApi(standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer', { mustChangePassword: true })]));
    renderWithProviders(asAdmin(<UsersPage />));

    const own = (await screen.findByLabelText('Роль: Главный')) as HTMLSelectElement;
    expect(own.disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Доступ: Главный' }) as HTMLButtonElement).disabled).toBe(true);
    const other = screen.getByLabelText('Роль: Иван Иванов') as HTMLSelectElement;
    expect(other.disabled).toBe(false);
    expect(other.value).toBe('viewer');
    expect(screen.getByText('сменит пароль')).not.toBeNull();
    // Таблица ролей: у читателя — только портал.
    expect(await screen.findByRole('columnheader', { name: 'читатель' })).not.toBeNull();
  });

  it('смена роли уходит с ожидаемой версией', async () => {
    const api = fakeApi([
      { match: 'PATCH /api/users/2', respond: () => ({ status: 200, body: row(2, 'ivanov', 'operator', { version: 4 }) }) },
      ...standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.change(await screen.findByLabelText('Роль: Иван Иванов'), { target: { value: 'operator' } });
    await waitFor(() => expect(api.calls.find(c => c.method === 'PATCH')?.body).toEqual({ expectedVersion: 3, role: 'operator' }));
    expect((await screen.findByRole('status')).textContent).toContain('оператор');
  });

  it('новый пользователь: логин в нижнем регистре, выданный пароль показан один раз', async () => {
    const api = fakeApi([
      { match: 'POST /api/users', respond: () => ({ status: 201, body: row(3, 'petrov', 'operator', { mustChangePassword: true }) }) },
      ...standardRoutes([row(1, 'boss', 'admin')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    const form = (await screen.findByRole('button', { name: 'Создать пользователя' })).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Логин'), { target: { value: ' Petrov ' } });
    fireEvent.change(within(form).getByLabelText('Имя'), { target: { value: 'Пётр Петров' } });
    fireEvent.change(within(form).getByLabelText('Роль'), { target: { value: 'operator' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Сгенерировать' }));
    const password = (within(form).getByLabelText('Пароль для первого входа') as HTMLInputElement).value;
    expect(password).toHaveLength(14);
    fireEvent.click(within(form).getByRole('button', { name: 'Создать пользователя' }));

    await waitFor(() =>
      expect(api.calls.find(c => c.method === 'POST' && c.url === '/api/users')?.body).toEqual({
        login: 'petrov',
        displayName: 'Пётр Петров',
        role: 'operator',
        password,
      }),
    );
    expect((await screen.findByRole('status')).textContent).toContain(password);
  });

  it('без права users.manage — отказ словами и ни одного запроса', async () => {
    const api = fakeApi([]);
    renderWithProviders(
      <AuthContext.Provider value={{ ...LOCAL_AUTH, can: p => p !== 'users.manage' }}>
        <UsersPage />
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Пользователями управляет администратор.')).not.toBeNull();
    expect(api.calls).toHaveLength(0);
  });
});
