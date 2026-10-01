// Вход по ключу доступа (passkey): кнопка — только если сервер принимает ключи и браузер умеет WebAuthn;
// окно устройства — @simplewebauthn/browser (подменено), ответ уходит на сервер, сессия — как после пароля.
// Закрытое окно — не ошибка; ключа нет на портале — просьба браузеру забыть его.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { AuthGate } from './AuthGate';
import { Layout } from './Layout';

const browser = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

vi.mock('@simplewebauthn/browser', async importOriginal => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  ...browser,
}));

const gate = () => (
  <AuthGate>
    <Layout>
      <p>Портал</p>
    </Layout>
  </AuthGate>
);

const anonymous = (passkeys = true) => () => ({ status: 200, body: { authRequired: true, authenticated: false, ...(passkeys ? { passkeys: true } : {}) } });

const signedIn = () => ({
  status: 200,
  body: {
    authRequired: true,
    authenticated: true,
    passkeys: true,
    csrfToken: 'csrf-1',
    user: { id: 7, login: 'ivanov', displayName: 'Иван Иванов', role: 'viewer', permissions: ['portal.read'], mustChangePassword: false },
  },
});

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', rpId: 'pulse.meridianai.ru', userVerification: 'required' };
const ASSERTION = { id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key', response: {}, clientExtensionResults: {} };

describe('вход по ключу доступа', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    browser.browserSupportsWebAuthn.mockReturnValue(true);
    browser.startAuthentication.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('сервер ключей не принимает — кнопки нет', async () => {
    fakeApi([{ match: 'GET /api/auth/session', respond: anonymous(false) }]);
    renderWithProviders(gate());
    expect(await screen.findByLabelText('Логин')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Войти с ключом доступа' })).toBeNull();
  });

  it('браузер не умеет WebAuthn — кнопки нет', async () => {
    browser.browserSupportsWebAuthn.mockReturnValue(false);
    fakeApi([{ match: 'GET /api/auth/session', respond: anonymous() }]);
    renderWithProviders(gate());
    expect(await screen.findByLabelText('Логин')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Войти с ключом доступа' })).toBeNull();
  });

  it('без логина: параметры сервера → окно устройства → ответ на сервер → портал', async () => {
    browser.startAuthentication.mockResolvedValue(ASSERTION);
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous() },
      { match: 'POST /api/auth/passkey/options', respond: () => ({ status: 200, body: { options: OPTIONS } }) },
      { match: 'POST /api/auth/passkey', respond: signedIn },
    ]);
    renderWithProviders(gate());

    fireEvent.click(await screen.findByRole('button', { name: 'Войти с ключом доступа' }));
    expect(await screen.findByRole('button', { name: 'Выйти (Иван Иванов)' })).not.toBeNull();
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(api.calls.find(c => c.url === '/api/auth/passkey')?.body).toEqual({ response: ASSERTION });
  });

  it('после входа паролем и выхода кнопка ключа на экране входа остаётся', async () => {
    fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous() },
      { match: 'POST /api/auth/login', respond: signedIn },
      { match: 'POST /api/auth/logout', respond: () => ({ status: 200, body: { authRequired: true, authenticated: false } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.change(await screen.findByLabelText('Логин'), { target: { value: 'ivanov' } });
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Correct-Horse-7731' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти (Иван Иванов)' }));
    expect(await screen.findByRole('button', { name: 'Войти с ключом доступа' })).not.toBeNull();
  });

  it('окно устройства закрыто — без тревоги и без запроса входа', async () => {
    browser.startAuthentication.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }));
    const api = fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous() },
      { match: 'POST /api/auth/passkey/options', respond: () => ({ status: 200, body: { options: OPTIONS } }) },
    ]);
    renderWithProviders(gate());

    fireEvent.click(await screen.findByRole('button', { name: 'Войти с ключом доступа' }));
    await waitFor(() => expect(browser.startAuthentication).toHaveBeenCalled());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Войти с ключом доступа' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/Не удалось|не смогло/)).toBeNull();
    expect(api.calls.some(c => c.url === '/api/auth/passkey')).toBe(false);
  });

  it('ключа нет на портале — текст сервера и просьба браузеру забыть ключ', async () => {
    const signalUnknownCredential = vi.fn(async () => undefined);
    vi.stubGlobal('PublicKeyCredential', { signalUnknownCredential });
    browser.startAuthentication.mockResolvedValue(ASSERTION);
    fakeApi([
      { match: 'GET /api/auth/session', respond: anonymous() },
      { match: 'POST /api/auth/passkey/options', respond: () => ({ status: 200, body: { options: OPTIONS } }) },
      {
        match: 'POST /api/auth/passkey',
        respond: () => ({
          status: 401,
          body: { error: 'Этого ключа на портале нет — возможно, его убрали. Войдите по паролю', code: 'passkey_unknown', credentialId: 'Y3JlZA', rpId: 'pulse.meridianai.ru' },
        }),
      },
    ]);
    renderWithProviders(gate());

    fireEvent.click(await screen.findByRole('button', { name: 'Войти с ключом доступа' }));
    expect(await screen.findByText('Этого ключа на портале нет — возможно, его убрали. Войдите по паролю')).not.toBeNull();
    expect(signalUnknownCredential).toHaveBeenCalledWith({ rpId: 'pulse.meridianai.ru', credentialId: 'Y3JlZA' });
  });
});
