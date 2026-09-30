// Раздел «Модель»: провайдер из настроек сервера, ключ OpenRouter — только администратору; ключ не
// возвращается на экран, поле очищается после сохранения, без права llm.manage формы нет. Имена
// переменных окружения — только в пояснениях администратору.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AccessPermission, ILlmKeyStatus, ILlmSettings } from '../../api/types';
import { AuthContext, LOCAL_AUTH } from '../../hooks/useAuth';
import { fakeApi, renderWithProviders } from '../../test/render';
import { ModelPage } from './ModelPage';

const SECRET = 'sk-or-v1-test-secret-abcd';

const keyStatus = (over: Partial<ILlmKeyStatus> = {}): ILlmKeyStatus => ({
  source: 'none',
  hint: null,
  updatedAt: null,
  updatedBy: null,
  envKeySet: false,
  problem: null,
  canStore: true,
  ...over,
});

const settings = (over: Partial<ILlmSettings> = {}): ILlmSettings => ({
  provider: 'openrouter',
  model: 'qwen/qwen3-30b-a3b-instruct-2507',
  routeProviders: [],
  key: keyStatus(),
  connection: { ok: false, error: 'ключ OpenRouter не задан: админка → «Модель» или LLM_API_KEY в .env' },
  ...over,
});

const as = (permissions: AccessPermission[], ui: ReactElement) => (
  <AuthContext.Provider
    value={{ ...LOCAL_AUTH, authRequired: true, can: p => permissions.includes(p), user: { ...LOCAL_AUTH.user, permissions } }}
  >
    {ui}
  </AuthContext.Provider>
);

const ADMIN: AccessPermission[] = ['portal.read', 'admin.view', 'llm.manage'];

describe('вкладка «Модель»', () => {
  it('провайдер и модель из .env; без ключа — разбор ждёт, а не падает', async () => {
    fakeApi([{ match: 'GET /api/admin/llm', respond: () => ({ status: 200, body: settings() }) }]);
    renderWithProviders(as(ADMIN, <ModelPage />));

    expect(await screen.findByText('OpenRouter — модель в облаке')).not.toBeNull();
    expect(screen.getByText('qwen/qwen3-30b-a3b-instruct-2507')).not.toBeNull();
    expect(screen.getByText('самый дешёвый подходящий')).not.toBeNull();
    expect(screen.getByText('не отвечает')).not.toBeNull();
    expect(screen.getByText('не задан')).not.toBeNull();
    expect(screen.getByText(/Без ключа разбор ждёт/)).not.toBeNull();
    // Имена переменных окружения — не в тексте экрана, а в пояснении.
    expect(document.body.textContent).not.toMatch(/LLM_PROVIDER|LMSTUDIO_MODEL|OPENROUTER_PROVIDERS/);
    expect(screen.getByRole('button', { name: 'Пояснение: где это настраивается' }).getAttribute('aria-description')).toMatch(
      /LLM_PROVIDER/,
    );
  });

  it('пока настройки грузятся — «Проверяю модель…», а не пустое состояние', () => {
    fakeApi([{ match: 'GET /api/admin/llm', respond: () => new Promise(() => undefined) }]);
    renderWithProviders(as(ADMIN, <ModelPage />));
    expect(screen.getByRole('status').textContent).toMatch(/Проверяю модель/);
  });

  it('сохранение: ключ уходит один раз, поле очищается, на экране — только четыре последних символа', async () => {
    let saved = false;
    const api = fakeApi([
      {
        match: 'GET /api/admin/llm',
        respond: () => ({
          status: 200,
          body: saved
            ? settings({
                key: keyStatus({ source: 'admin', hint: 'abcd', updatedAt: '2026-09-30T10:00:00Z', updatedBy: 'boss' }),
                connection: { ok: true, error: null },
              })
            : settings(),
        }),
      },
      {
        match: 'PUT /api/admin/llm/key',
        respond: () => {
          saved = true;
          return { status: 200, body: { key: keyStatus({ source: 'admin', hint: 'abcd' }), check: { verdict: 'accepted', error: null } } };
        },
      },
    ]);
    const { container } = renderWithProviders(as(ADMIN, <ModelPage />));

    const input = (await screen.findByLabelText('Ключ OpenRouter')) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: ` ${SECRET} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    expect(await screen.findByText('Ключ сохранён, OpenRouter его принял.')).not.toBeNull();
    expect(api.calls.filter(c => c.method === 'PUT')).toEqual([{ method: 'PUT', url: '/api/admin/llm/key', body: { key: SECRET } }]);
    await waitFor(() => expect(screen.getByText('задан в админке, оканчивается на …abcd')).not.toBeNull());
    expect(((await screen.findByLabelText(/Новый ключ OpenRouter/)) as HTMLInputElement).value).toBe('');
    expect(container.textContent).not.toContain(SECRET);
    expect(screen.getByRole('button', { name: 'Удалить ключ из админки' })).not.toBeNull();
  });

  it('OpenRouter не принял ключ — текст отказа, ключ в поле остаётся для правки', async () => {
    fakeApi([
      { match: 'GET /api/admin/llm', respond: () => ({ status: 200, body: settings() }) },
      {
        match: 'PUT /api/admin/llm/key',
        respond: () => ({ status: 422, body: { error: 'OpenRouter не принял ключ — он не сохранён', code: 'key_rejected' } }),
      },
    ]);
    renderWithProviders(as(ADMIN, <ModelPage />));

    const input = (await screen.findByLabelText('Ключ OpenRouter')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ключ' }));

    expect(await screen.findByText('OpenRouter не принял ключ — он не сохранён')).not.toBeNull();
    expect(input.value).toBe(SECRET);
  });

  it('оператор видит состояние, но формы ключа у него нет; при LM Studio ключ не используется', async () => {
    fakeApi([
      {
        match: 'GET /api/admin/llm',
        respond: () => ({
          status: 200,
          body: settings({
            provider: 'lmstudio',
            model: 'qwen/qwen3-8b',
            key: keyStatus({ source: 'admin', hint: 'abcd' }),
            connection: { ok: true, error: null },
          }),
        }),
      },
    ]);
    renderWithProviders(as(['portal.read', 'admin.view'], <ModelPage />));

    expect(await screen.findByText('LM Studio — модель на своём компьютере')).not.toBeNull();
    expect(screen.getByText('Пока разбор идёт через LM Studio, ключ не используется.')).not.toBeNull();
    expect(screen.getByText('Ключ задаёт администратор.')).not.toBeNull();
    expect(screen.queryByLabelText(/ключ OpenRouter/i)).toBeNull();
    // Оператору не нужны имена переменных и в пояснениях.
    expect(screen.queryByRole('button', { name: 'Пояснение: где это настраивается' })).toBeNull();
  });
});
