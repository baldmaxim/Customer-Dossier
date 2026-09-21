// Постановка запуска по одной редакции: отказ политики читается словами, второй запуск не создаётся.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fakeApi, renderWithProviders } from '../test/render';
import { EnqueueRunButton } from './EnqueueRunButton';

const PATH = 'POST /api/reprocess/revisions/7/runs';

describe('EnqueueRunButton', () => {
  it('отказ допуска — причина источника, а не номер статуса', async () => {
    fakeApi([
      {
        match: PATH,
        respond: () => ({
          status: 422,
          body: {
            outcome: 'refused_policy',
            reason: 'Источник «stroygazeta»: нет разрешения на ИИ-обработку — основание не подтверждено',
            code: 'refused_policy',
            error: 'Источник «stroygazeta»: нет разрешения на ИИ-обработку — основание не подтверждено',
          },
        }),
      },
    ]);
    renderWithProviders(<EnqueueRunButton revisionId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поставить на разбор' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/нет разрешения на ИИ-обработку/);
    expect(alert.textContent).toMatch(/Допуск на ИИ-обработку ставит оператор/);
    expect(alert.textContent).not.toMatch(/Ошибка 422/);
  });

  it('запуск уже в работе — ссылка на него, второго запроса нет', async () => {
    const api = fakeApi([{ match: PATH, respond: () => ({ status: 200, body: { outcome: 'already_live', runId: 5, pipelineEnabled: true } }) }]);
    renderWithProviders(<EnqueueRunButton revisionId={7} />);
    const button = screen.getByRole('button', { name: 'Поставить на разбор' });
    fireEvent.click(button);

    expect((await screen.findByRole('status')).textContent).toMatch(/такой запуск уже в работе/);
    expect(screen.getByRole('link', { name: 'запуск #5' })).toBeTruthy();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(api.calls.filter(c => c.method === 'POST').length).toBe(1);
  });

  it('нет соединения — сказано про соединение, постановка не считается выполненной', async () => {
    fakeApi([]);
    renderWithProviders(<EnqueueRunButton revisionId={7} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поставить на разбор' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/599|нет маршрута|Сбой сервера/);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
