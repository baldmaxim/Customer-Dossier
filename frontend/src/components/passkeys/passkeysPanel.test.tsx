// Свои ключи доступа в профиле: список, добавление — пароль, затем окно устройства, ответ уходит на сервер
// с названием; «Убрать» — только после подтверждения; браузер без WebAuthn — пояснение вместо кнопки.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IPasskeyRow } from '../../api/types';
import { fakeApi, renderWithProviders } from '../../test/render';
import { PasskeysPanel } from './PasskeysPanel';

const browser = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));

vi.mock('@simplewebauthn/browser', async importOriginal => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  ...browser,
}));

const key = (id: number, name: string, extra: Partial<IPasskeyRow> = {}): IPasskeyRow => ({
  id,
  name,
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-10-01T08:00:00Z',
  lastUsedAt: null,
  ...extra,
});

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', rp: { id: 'pulse.meridianai.ru', name: 'Досье Заказчика' }, user: { id: 'dXNlcg', name: 'ivanov', displayName: 'Иван' } };
const ATTESTATION = { id: 'Y3JlZA', rawId: 'Y3JlZA', type: 'public-key', response: {}, clientExtensionResults: {} };

describe('ключи доступа в профиле', () => {
  beforeEach(() => {
    browser.browserSupportsWebAuthn.mockReturnValue(true);
    browser.startRegistration.mockReset();
  });

  it('пусто — словами; добавление: пароль → окно устройства → ключ с названием в списке', async () => {
    let items: IPasskeyRow[] = [];
    browser.startRegistration.mockResolvedValue(ATTESTATION);
    const api = fakeApi([
      { match: 'GET /api/auth/passkeys', respond: () => ({ status: 200, body: { items } }) },
      { match: 'POST /api/auth/passkeys/options', respond: () => ({ status: 200, body: { options: OPTIONS } }) },
      {
        match: 'POST /api/auth/passkeys',
        respond: () => {
          items = [key(5, 'Рабочий ноутбук')];
          return { status: 201, body: items[0] };
        },
      },
    ]);
    renderWithProviders(<PasskeysPanel />);

    expect(await screen.findByText('Ключей пока нет — вход только по паролю.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ключ доступа' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить ключ доступа' });
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'Correct-Horse-7731' } });
    fireEvent.change(within(dialog).getByLabelText('Название'), { target: { value: ' Рабочий ноутбук ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продолжить' }));

    expect(await screen.findByText(/Ключ «Рабочий ноутбук» добавлен/)).not.toBeNull();
    expect(api.calls.find(c => c.url === '/api/auth/passkeys/options')?.body).toEqual({ currentPassword: 'Correct-Horse-7731' });
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(api.calls.find(c => c.method === 'POST' && c.url === '/api/auth/passkeys')?.body).toEqual({ response: ATTESTATION, name: 'Рабочий ноутбук' });
    expect(await screen.findByText('Рабочий ноутбук')).not.toBeNull();
  });

  it('неверный пароль — отказ в окне, устройство не вызывается', async () => {
    fakeApi([
      { match: 'GET /api/auth/passkeys', respond: () => ({ status: 200, body: { items: [] } }) },
      { match: 'POST /api/auth/passkeys/options', respond: () => ({ status: 400, body: { error: 'Текущий пароль неверен', code: 'bad_password' } }) },
    ]);
    renderWithProviders(<PasskeysPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить ключ доступа' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить ключ доступа' });
    fireEvent.change(within(dialog).getByLabelText('Текущий пароль'), { target: { value: 'wrong-password-value' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Продолжить' }));
    expect(await within(dialog).findByText('Текущий пароль неверен')).not.toBeNull();
    expect(browser.startRegistration).not.toHaveBeenCalled();
  });

  it('«Убрать» — только после подтверждения', async () => {
    const api = fakeApi([
      { match: 'GET /api/auth/passkeys', respond: () => ({ status: 200, body: { items: [key(5, 'iPhone', { lastUsedAt: '2026-10-01T09:00:00Z' })] } }) },
      { match: 'DELETE /api/auth/passkeys/5', respond: () => ({ status: 200, body: { ok: true } }) },
    ]);
    renderWithProviders(<PasskeysPanel />);

    expect(await screen.findByText('синхронизируется между устройствами')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать «iPhone»' }));
    const confirm = await screen.findByRole('dialog', { name: 'Убрать ключ «iPhone»?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls.some(c => c.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Убрать «iPhone»' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Убрать ключ «iPhone»?' })).getByRole('button', { name: 'Убрать ключ' }));
    expect(await screen.findByText(/Ключ «iPhone» убран/)).not.toBeNull();
    expect(api.calls.some(c => c.method === 'DELETE' && c.url === '/api/auth/passkeys/5')).toBe(true);
  });

  it('браузер без ключей доступа — пояснение вместо кнопки', async () => {
    browser.browserSupportsWebAuthn.mockReturnValue(false);
    fakeApi([{ match: 'GET /api/auth/passkeys', respond: () => ({ status: 200, body: { items: [] } }) }]);
    renderWithProviders(<PasskeysPanel />);
    expect(await screen.findByText(/Этот браузер не умеет ключи доступа/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить ключ доступа' })).toBeNull();
  });
});
