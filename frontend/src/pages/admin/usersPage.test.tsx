// «Пользователи» (ADR-014): заявки на доступ (одобрить с ролью, отклонить после подтверждения,
// пусто — блока нет), список, смена роли — только после подтверждения и с ожидаемой версией, свою
// строку администратор не меняет, сброшенный пароль — в окне; имя ведёт на страницу пользователя; формы «Новый пользователь» нет —
// учётную запись человек заводит сам заявкой; без права users.manage — ни одного запроса.
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
  registration: 'approved',
  liveSessions: 1,
  passkeys: 2,
  ...extra,
});

/** Заявка на доступ: выключенный читатель, пароль задан самим человеком. */
const request = (id: number, login: string, displayName: string, extra: Partial<IUserRow> = {}): IUserRow =>
  row(id, login, 'viewer', {
    displayName,
    isActive: false,
    registration: 'pending',
    lastLoginAt: null,
    liveSessions: 0,
    createdBy: login,
    createdAt: '2026-09-30T09:15:00Z',
    version: 1,
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
    // Имя — ссылка на страницу пользователя (входы, ключи доступа, журнал); число ключей — в строке.
    expect(screen.getByRole('link', { name: 'Иван Иванов' }).getAttribute('href')).toBe('/admin/users/2');
    expect(screen.getAllByText(/ключей доступа: 2/).length).toBeGreaterThan(0);
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

  it('формы «Новый пользователь» нет: учётную запись заводит сам человек заявкой', async () => {
    fakeApi(standardRoutes([row(1, 'boss', 'admin')]));
    renderWithProviders(asAdmin(<UsersPage />));

    expect(await screen.findByLabelText('Роль: Главный')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Новый пользователь' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать пользователя' })).toBeNull();
    // Заявок нет — нет и блока заявок.
    expect(screen.queryByRole('heading', { name: /Заявки на доступ/ })).toBeNull();
    expect(screen.queryByText('Отклонённые заявки')).toBeNull();
  });

  it('заявки — наверху и не в списке пользователей; одобрение уходит с выбранной ролью и версией', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/users/5/approve',
        respond: () => ({ status: 200, body: request(5, 'petrov', 'Пётр Петров', { registration: 'approved', isActive: true, role: 'operator', version: 2 }) }),
      },
      ...standardRoutes([row(1, 'boss', 'admin'), request(5, 'petrov', 'Пётр Петров'), request(6, 'sidorov', 'Сидор Сидоров')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    const heading = await screen.findByRole('heading', { name: 'Заявки на доступ (2)' });
    const block = heading.closest('section')!;
    expect(within(block).getByText('Пётр Петров')).not.toBeNull();
    // В списке пользователей заявок нет: у них нет ни переключателя доступа, ни смены роли.
    expect(screen.queryByRole('switch', { name: 'Доступ: Пётр Петров' })).toBeNull();
    expect(screen.queryByLabelText('Роль: Пётр Петров')).toBeNull();
    expect(screen.getByText('всего 1')).not.toBeNull();

    const role = within(block).getByLabelText('Роль после одобрения: Пётр Петров') as HTMLSelectElement;
    expect(role.value).toBe('viewer');
    fireEvent.change(role, { target: { value: 'operator' } });
    fireEvent.click(within(block).getByRole('button', { name: 'Одобрить «Пётр Петров»' }));

    await waitFor(() => expect(api.calls.find(c => c.url === '/api/users/5/approve')?.body).toEqual({ expectedVersion: 1, role: 'operator' }));
    // Одобрение — без подтверждения: роль выбрана явно, кнопка — второе действие.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText(/Пётр Петров: заявка одобрена, роль — оператор/)).not.toBeNull();
  });

  it('отклонение — только после подтверждения; отказ ничего не отправляет', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/users/5/reject',
        respond: () => ({ status: 200, body: request(5, 'petrov', 'Пётр Петров', { registration: 'rejected', version: 2 }) }),
      },
      ...standardRoutes([row(1, 'boss', 'admin'), request(5, 'petrov', 'Пётр Петров')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить «Пётр Петров»' }));
    const dialog = await screen.findByRole('dialog', { name: 'Отклонить заявку: Пётр Петров?' });
    expect(dialog.textContent).toMatch(/petrov/);
    // У необратимого действия фокус сначала на «Отмена».
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Отмена'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.some(c => c.url.endsWith('/reject'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить «Пётр Петров»' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(api.calls.find(c => c.url === '/api/users/5/reject')?.body).toEqual({ expectedVersion: 1 }));
    expect(await screen.findByText('Пётр Петров: заявка отклонена.')).not.toBeNull();
  });

  it('заявку уже рассмотрел другой администратор — отказ сервера тостом', async () => {
    fakeApi([
      { match: 'POST /api/users/5/approve', respond: () => ({ status: 409, body: { error: 'Заявка уже одобрена', code: 'already_approved' } }) },
      ...standardRoutes([row(1, 'boss', 'admin'), request(5, 'petrov', 'Пётр Петров')]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    fireEvent.click(await screen.findByRole('button', { name: 'Одобрить «Пётр Петров»' }));
    expect(await screen.findByText('Заявка уже одобрена')).not.toBeNull();
  });

  it('отклонённые — свёрнуты под списком: одобрить можно, отклонить повторно — нет', async () => {
    const api = fakeApi([
      {
        match: 'POST /api/users/7/approve',
        respond: () => ({ status: 200, body: request(7, 'kozlov', 'Козлов', { registration: 'approved', isActive: true, version: 3 }) }),
      },
      ...standardRoutes([row(1, 'boss', 'admin'), request(7, 'kozlov', 'Козлов', { registration: 'rejected', version: 2 })]),
    ]);
    renderWithProviders(asAdmin(<UsersPage />));

    const summary = await screen.findByText('Отклонённые заявки');
    expect(screen.queryByRole('heading', { name: /Заявки на доступ/ })).toBeNull();
    const rejected = summary.closest('details')!;
    expect(within(rejected).queryByRole('button', { name: /Отклонить/ })).toBeNull();
    fireEvent.click(within(rejected).getByRole('button', { name: 'Одобрить «Козлов»' }));
    await waitFor(() => expect(api.calls.find(c => c.url === '/api/users/7/approve')?.body).toEqual({ expectedVersion: 2, role: 'viewer' }));
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
