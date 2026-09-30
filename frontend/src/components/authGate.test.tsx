// Вход оператора (ADR-013): на сервере без сессии — только экран входа, после входа — портал
// и кнопка «Выйти»; изменяющие запросы несут CSRF-токен. Локально (AUTH_MODE=none) экрана входа нет.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { AuthGate } from './AuthGate';
import { Layout } from './Layout';

const gate = () => (
  <AuthGate
    renderPortal={onLogout => (
      <Layout onLogout={onLogout}>
        <p>Портал</p>
      </Layout>
    )}
  />
);

const headerOf = (init: RequestInit | undefined, name: string): string | undefined =>
  (init?.headers as Record<string, string> | undefined)?.[name];

describe('вход оператора', () => {
  // Тема уже проставлена инлайн-скриптом index.html: без неё шапка спросит matchMedia, которого нет в jsdom.
  beforeEach(() => document.documentElement.setAttribute('data-theme', 'light'));

  it('на сервере без сессии — экран входа, данных портала не запрашивается', async () => {
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) },
    ]);
    renderWithProviders(gate());

    expect(await screen.findByLabelText('Токен оператора')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Выйти' })).toBeNull();
    expect(api.calls.map(c => c.url)).toEqual(['/api/auth/session']);
  });

  it('вход открывает портал; выход отправляет CSRF-токен и возвращает экран входа', async () => {
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) },
      {
        match: 'POST /api/auth/login',
        respond: () => ({ status: 200, body: { authRequired: true, authenticated: true, csrfToken: 'csrf-1', expiresAt: '2026-09-30T20:00:00Z' } }),
      },
      { match: 'POST /api/auth/logout', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Токен оператора'), { target: { value: 'operator-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    const logout = await screen.findByRole('button', { name: 'Выйти' });
    expect(api.calls.find(c => c.url === '/api/auth/login')?.body).toEqual({ token: 'operator-token' });

    fireEvent.click(logout);
    expect(await screen.findByLabelText('Токен оператора')).not.toBeNull();
    const logoutCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/auth/logout');
    expect(headerOf(logoutCall?.[1], 'X-CSRF-Token')).toBe('csrf-1');
  });

  it('неверный токен — текст ошибки, экран входа остаётся', async () => {
    fakeApi([
      { match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) },
      { match: 'POST /api/auth/login', respond: () => ({ status: 401, body: { error: 'Неверный токен оператора', code: 'bad_token' } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Токен оператора'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Неверный токен оператора');
    expect(screen.getByLabelText('Токен оператора')).not.toBeNull();
  });

  it('локально входа нет: портал сразу, кнопки «Выйти» нет', async () => {
    fakeApi([{ match: 'GET /api/auth/session', respond: () => ({ status: 200, body: { authRequired: false, authenticated: true } }) }]);
    renderWithProviders(gate());

    await waitFor(() => expect(screen.getByText('Портал')).not.toBeNull());
    expect(screen.queryByLabelText('Токен оператора')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Выйти' })).toBeNull();
  });
});
