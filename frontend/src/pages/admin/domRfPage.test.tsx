// Страница наш.дом.рф: вкладки «Компании · Объекты · Карточки» с числами, вкладка в адресе; подсказки модели —
// выключены, пока оператор не разрешит ИИ-обработку источника (с подтверждением), включённые — с числами.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../../test/render';
import { DomRfPage } from './DomRfPage';

const SUMMARY = {
  companies: { companies: 2867, searched: 33, withPending: 12, confirmed: 5, notFound: 9 },
  objects: { pending: 315 },
  cards: { waiting: 1, total: 3 },
  hints: { running: true, sourceId: 14, allowed: false, reason: 'нет разрешения', provider: 'openrouter', model: 'qwen/qwen3-30b-a3b-instruct-2507', hinted: 0, waiting: 50 },
};

const EMPTY_COMPANIES = { items: [], matched: 0, totals: SUMMARY.companies };

const TARGETS = {
  items: [
    {
      id: 1,
      externalRef: '62087',
      url: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62087',
      projectId: 42,
      projectName: 'Большая Татарская 35',
      requestedAt: '2026-09-28T08:00:00Z',
      capturedAt: '2026-09-28T09:00:00Z',
      status: 'captured',
    },
  ],
};

describe('Страница наш.дом.рф', () => {
  it('вкладки с числами ожидающего; подсказки выключены — «Разрешить» спрашивает подтверждение и пишет допуск', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-summary', respond: () => ({ status: 200, body: SUMMARY }) },
      { match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: EMPTY_COMPANIES }) },
      { match: 'POST /api/admin/domrf-hints/permission', respond: () => ({ status: 200, body: { sourceId: 14, allowed: true, reason: null } }) },
    ]);
    renderWithProviders(<DomRfPage />, '/admin/sources/domrf');

    const tabs = within(screen.getByRole('tablist', { name: 'Разделы ДОМ.РФ' }));
    await waitFor(() => expect(tabs.getByRole('tab', { name: /^Компании/ }).textContent).toContain('12'));
    expect(tabs.getByRole('tab', { name: /^Объекты/ }).textContent).toContain('315');
    expect(tabs.getByRole('tab', { name: /^Компании/ }).getAttribute('aria-selected')).toBe('true');

    expect(await screen.findByText('Подсказки модели выключены')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Разрешить подсказки' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/внешний сервис OpenRouter/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Разрешить' }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: 'POST', url: '/api/admin/domrf-hints/permission', body: { allowed: true } }));
  });

  it('подсказки включены — сколько составлено и сколько ждёт', async () => {
    fakeApi([
      { match: 'GET /api/admin/domrf-summary', respond: () => ({ status: 200, body: { ...SUMMARY, hints: { ...SUMMARY.hints, allowed: true, reason: null, hinted: 7, waiting: 43 } } }) },
      { match: 'GET /api/admin/domrf-companies', respond: () => ({ status: 200, body: EMPTY_COMPANIES }) },
    ]);
    renderWithProviders(<DomRfPage />, '/admin/sources/domrf');
    expect(await screen.findByText('Подсказки модели включены')).toBeTruthy();
    expect(screen.getByText(/С подсказкой — 7, ждут подсказки — 43/)).toBeTruthy();
  });

  it('«Карточки»: ссылка ДОМ.РФ и номер существующего объекта портала сохраняются', async () => {
    const api = fakeApi([
      { match: 'GET /api/admin/domrf-summary', respond: () => ({ status: 200, body: SUMMARY }) },
      { match: 'GET /api/admin/domrf-targets', respond: () => ({ status: 200, body: TARGETS }) },
      { match: 'POST /api/admin/domrf-targets', respond: () => ({ status: 200, body: { item: {} } }) },
    ]);
    renderWithProviders(<DomRfPage />, '/admin/sources/domrf?tab=cards');
    expect(await screen.findByRole('link', { name: '№62087 (откроется в новой вкладке)' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ссылка на объект ДОМ.РФ' }), {
      target: { value: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62088' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Номер объекта в портале (необязательно)' }), { target: { value: '42' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить ссылку' }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'POST',
        url: '/api/admin/domrf-targets',
        body: { url: 'https://наш.дом.рф/сервисы/каталог-новостроек/объект/62088', projectId: 42 },
      }),
    );
  });
});
