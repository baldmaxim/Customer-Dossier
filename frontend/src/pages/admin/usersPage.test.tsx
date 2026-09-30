// «Пользователи» (ADR-014): список, создание, смена роли — только после подтверждения и с
// ожидаемой версией, свою строку администратор не меняет, выданный пароль — в окне, а не
// баннером; без права users.manage — ни одного запроса.
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
  permissions: ['portal.read', 'admin.view', 'dossier.view', 'users.manage'],
  roles: [
    { role: 'admin', permissions: ['portal.read', 'admin.view', 'dossier.view', 'users.manage'] },
    { role: 'operator', permissions: ['portal.read', 'admin.view', 'dossier.view'] },
    { role: 'viewer', permissions: ['portal.read'] },
  ],
};

const asAdmin = (ui: ReactElement) => (
  <AuthContext.Provider value={{ ...LOCAL_AUTH, authRequired: true, user: { ...LOCAL_AUTH.user, id: 1, login: 'boss' } }}>
    {ui}
  </AuthContext.Provider>
);

const standardRoutes = (users: IUserRow[]) => [
  { match: 'GET /api/users/roles', respond: () => ({ status: 200, body: ROLES }) },
  { match: 'GET /api/users/events', respond: () => ({ status: 200, body: { items: [], nextBefore: null } }) },
  { match: 'GET /api/users', respond: () => ({ status: 200, body: { items: users } }) },
];

describe('экран «Пользователи»', () => {
  it('список с ролями; свою роль и доступ администратор не меняет; снятые права в таблице не видны', async () => {
    fakeApi(standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer', { mustChangePassword: true })]));
    renderWithProviders(asAdmin(<UsersPage />));

    const own = (await screen.findByLabelText('Роль: Главный')) as HTMLSelectElement;
    expect(own.disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Доступ: Главный' }) as HTMLButtonElement).disabled).toBe(true);
    const other = screen.getByLabelText('Роль: Иван Иванов') as HTMLSelectElement;
    expect(other.disabled).toBe(false);
    expect(other.value).toBe('viewer');
    expect(screen.getByText('сменит пароль при входе')).not.toBeNull();
    // Таблица ролей: у читателя — только портал; права обращений и снимков не показываются.
    expect(await screen.findByRole('columnheader', { name: 'читатель' })).not.toBeNull();
    expect(screen.queryByText(/Обращения и снимки/)).toBeNull();
    // У колонки действий есть заголовок для диктора, а не пустой <th/>.
    expect(screen.getAllByRole('columnheader', { name: 'Действия' }).length).toBeGreaterThan(0);
  });

  it('смена роли — только после подтверждения; отказ ничего не отправляет', async () => {
    const api = fakeApi([
      { match: 'PATCH /api/users/2', respond: () => ({ status: 200, body: row(2, 'ivanov', 'operator', { version: 4 }) }) },
      ...standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.change(await screen.findByLabelText('Роль: Иван Иванов'), { target: { value: 'operator' } });
    const dialog = await screen.findByRole('dialog', { name: 'Сменить роль: Иван Иванов?' });
    expect(dialog.textContent).toMatch(/оператор/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.some(c => c.method === 'PATCH')).toBe(false);
    expect((screen.getByLabelText('Роль: Иван Иванов') as HTMLSelectElement).value).toBe('viewer');

    fireEvent.change(screen.getByLabelText('Роль: Иван Иванов'), { target: { value: 'operator' } });
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Сменить роль' }));
    await waitFor(() => expect(api.calls.find(c => c.method === 'PATCH')?.body).toEqual({ expectedVersion: 3, role: 'operator' }));
    expect(await screen.findByText(/Иван Иванов: роль — оператор/)).not.toBeNull();
  });

  it('выключение доступа тоже спрашивает подтверждение', async () => {
    const api = fakeApi([
      { match: 'PATCH /api/users/2', respond: () => ({ status: 200, body: row(2, 'ivanov', 'viewer', { isActive: false, version: 4 }) }) },
      ...standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.click(await screen.findByRole('switch', { name: 'Доступ: Иван Иванов' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Выключить доступ: Иван Иванов?' })).getByRole('button', {
        name: 'Выключить доступ',
      }),
    );
    await waitFor(() => expect(api.calls.find(c => c.method === 'PATCH')?.body).toEqual({ expectedVersion: 3, isActive: false }));
  });

  it('новый пользователь: логин в нижнем регистре, выданный пароль — в окне, один раз', async () => {
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
    const dialog = await screen.findByRole('dialog', { name: 'Пользователь создан' });
    expect(dialog.textContent).toContain(password);
    expect(dialog.textContent).toContain('petrov');
  });

  it('сброс пароля — в окне: сначала пароль и «Сбросить», затем он же для передачи', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/users/2/password',
        respond: () => ({ status: 200, body: row(2, 'ivanov', 'viewer', { mustChangePassword: true }) }),
      },
      ...standardRoutes([row(1, 'boss', 'admin'), row(2, 'ivanov', 'viewer')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.click(await screen.findByRole('button', { name: 'Сбросить пароль «Иван Иванов»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Сбросить пароль: Иван Иванов' });
    const password = (within(dialog).getByLabelText('Новый пароль: ivanov') as HTMLInputElement).value;
    expect(password.length).toBeGreaterThan(9);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сбросить пароль' }));
    await waitFor(() => expect(api.calls.find(c => c.url === '/api/users/2/password')?.body).toEqual({ password }));
    expect(await within(dialog).findByText(password)).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Готово' })).not.toBeNull();
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
