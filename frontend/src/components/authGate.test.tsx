// Вход (ADR-014): на сервере без сессии — только экран входа; после входа — портал, кнопка «Выйти»
// и пункты меню по правам роли; изменяющие запросы несут CSRF-токен; выданный администратором
// пароль сначала меняется. Локально (AUTH_MODE=none) экрана входа нет.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessPermission, IAuthUser } from '../api/types';
import { fakeApi, renderWithProviders } from '../test/render';
import { AuthGate } from './AuthGate';
import { Layout } from './Layout';

const gate = () => (
  <AuthGate>
    <Layout>
      <p>Портал</p>
    </Layout>
  </AuthGate>
);

const headerOf = (init: RequestInit | undefined, name: string): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.[name];

const user = (role: IAuthUser['role'], permissions: AccessPermission[], mustChangePassword = false): IAuthUser => ({
  id: 7,
  login: 'ivanov',
  displayName: 'Иван Иванов',
  role,
  permissions,
  mustChangePassword,
});

const signedIn = (u: IAuthUser) => ({
  status: 200,
  body: { authRequired: true, authenticated: true, csrfToken: 'csrf-1', expiresAt: '2026-09-30T20:00:00Z', user: u },
});

const anonymous = () => ({ status: 200, body: { authRequired: true, authenticated: false } });

describe('вход', () => {
  // Тема уже проставлена инлайн-скриптом index.html: без неё шапка спросит matchMedia, которого нет в jsdom.
  beforeEach(() => document.documentElement.setAttribute('data-theme', 'light'));

  it('пока сессия читается — знак портала и «Открываю портал…», а не белый экран', async () => {
    fakeApi([{ match: 'GET /api/auth/session', respond: () => new Promise(() => undefined) }]);
    renderWithProviders(gate());

    expect((await screen.findByRole('status')).textContent).toContain('Открываю портал…');
    expect(screen.queryByText('Портал')).toBeNull();
    expect(screen.queryByLabelText('Логин')).toBeNull();
  });

  it('на сервере без сессии — экран входа, данных портала не запрашивается', async () => {
    const api = fakeApi([{ match: 'GET /api/auth/session', respond: anonymous }]);
    renderWithProviders(gate());

    expect(await screen.findByLabelText('Логин')).not.toBeNull();
    expect(screen.getByLabelText('Пароль')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Выйти/ })).toBeNull();
    expect(api.calls.map(c => c.url)).toEqual(['/api/auth/session']);
  });

  it('вход открывает портал; выход отправляет CSRF-токен и возвращает экран входа', async () => {
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous },
      { match: 'POST /api/auth/login', respond: () => signedIn(user('operator', ['portal.read', 'admin.view'])) },
      { match: 'POST /api/auth/logout', respond: anonymous },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: ' ivanov ' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Correct-Horse-7731' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    // Имя вошедшего — в доступном имени кнопки выхода (и в подсказке): кто выйдет, слышно и видно.
    const logout = await screen.findByRole('button', { name: 'Выйти (Иван Иванов)' });
    expect(api.calls.find(c => c.url === '/api/auth/login')?.body).toEqual({ login: 'ivanov', password: 'Correct-Horse-7731' });
    // Профиль — вкладка админки: отдельной ссылки в шапке нет.
    expect(screen.queryByRole('link', { name: /Мой профиль/ })).toBeNull();
    expect(logout.getAttribute('title')).toBe('Выйти (Иван Иванов)');

    fireEvent.click(logout);
    expect(await screen.findByLabelText('Логин')).not.toBeNull();
    const logoutCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/auth/logout');
    expect(headerOf(logoutCall?.[1], 'X-CSRF-Token')).toBe('csrf-1');
  });

  it('неверный пароль — текст ошибки, экран входа остаётся, поле пароля очищено', async () => {
    fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous },
      { match: 'POST /api/auth/login', respond: () => ({ status: 401, body: { error: 'Неверный логин или пароль', code: 'bad_credentials' } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'ivanov' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Неверный логин или пароль');
    expect((screen.getByLabelText('Пароль') as HTMLInputElement).value).toBe('');
  });

  it('меню по правам: читатель вместо админки видит свой профиль, оператор — админку с профилем внутри', async () => {
    fakeApi([{ match: 'GET /api/auth/session', respond: () => signedIn(user('viewer', ['portal.read'])) }]);
    const viewer = renderWithProviders(gate());
    await screen.findByText('Портал');
    expect(screen.queryAllByRole('link', { name: 'Админка' })).toHaveLength(0);
    // Главная — «Компании» (ADR-016).
    expect(screen.getAllByRole('link', { name: 'Компании' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Профиль' })[0]?.getAttribute('href')).toBe('/admin/account');
    viewer.unmount();

    fakeApi([{ match: 'GET /api/auth/session', respond: () => signedIn(user('operator', ['portal.read', 'admin.view'])) }]);
    renderWithProviders(gate());
    await screen.findByText('Портал');
    expect(screen.getAllByRole('link', { name: 'Админка' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('link', { name: 'Профиль' })).toHaveLength(0);
  });

  it('выданный пароль: портал закрыт, пока пользователь не задаст свой', async () => {
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: () => signedIn(user('viewer', ['portal.read'], true)) },
      { match: 'POST /api/auth/password', respond: () => signedIn(user('viewer', ['portal.read'], false)) },
    ]);
    renderWithProviders(gate());

    expect(await screen.findByRole('heading', { name: 'Задайте свой пароль' })).not.toBeNull();
    expect(screen.queryByText('Портал')).toBeNull();

    fireEvent.change(screen.getByLabelText('Пароль от администратора'), { target: { value: 'Issued-Pass-4410' } });
    fireEvent.change(screen.getByLabelText('Новый пароль'), { target: { value: 'Own-Secret-Pass-9' } });
    fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), { target: { value: 'Own-Secret-Pass-8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и войти' }));
    expect((await screen.findByRole('alert')).textContent).toContain('не совпадает');
    expect(api.calls.some(c => c.url === '/api/auth/password')).toBe(false);

    fireEvent.change(screen.getByLabelText('Новый пароль ещё раз'), { target: { value: 'Own-Secret-Pass-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить и войти' }));
    expect(await screen.findByText('Портал')).not.toBeNull();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/auth/password');
    expect(headerOf(call?.[1], 'X-CSRF-Token')).toBe('csrf-1');
    expect(api.calls.find(c => c.url === '/api/auth/password')?.body).toEqual({
      currentPassword: 'Issued-Pass-4410',
      newPassword: 'Own-Secret-Pass-9',
    });
  });

  it('локально входа нет: портал сразу, кнопки «Выйти» нет', async () => {
    fakeApi([
      {
        match: 'GET /api/auth/session',
        respond: () => ({
          status: 200,
          body: { authRequired: false, authenticated: true, user: { ...user('admin', ['portal.read', 'admin.view', 'users.manage']), login: 'operator' } },
        }),
      },
    ]);
    renderWithProviders(gate());

    await waitFor(() => expect(screen.getByText('Портал')).not.toBeNull());
    expect(screen.queryByLabelText('Логин')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Выйти/ })).toBeNull();
  });
});
