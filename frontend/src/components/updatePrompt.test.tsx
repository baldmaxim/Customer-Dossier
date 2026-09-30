// «Доступна новая версия» — тост общей системы: обновление только по нажатию (registerType:
// 'prompt'), «Отложить» закрывает и сообщает service worker'у, что обновление отложено.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/render';
import { UpdatePrompt } from './UpdatePrompt';

const sw = vi.hoisted(() => ({
  needRefresh: true,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(async () => undefined),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, sw.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.updateServiceWorker,
  }),
}));

beforeEach(() => {
  sw.needRefresh = true;
  sw.setNeedRefresh.mockClear();
  sw.updateServiceWorker.mockClear();
});

describe('UpdatePrompt', () => {
  it('новая версия — тост с «Обновить»; обновление только по нажатию', () => {
    renderWithProviders(<UpdatePrompt />);
    expect(screen.getByRole('status').textContent).toContain('Доступна новая версия');
    expect(sw.updateServiceWorker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('«Отложить» закрывает тост и снимает флаг обновления', async () => {
    renderWithProviders(<UpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Отложить' }));
    expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByText('Доступна новая версия')).toBeNull());
  });

  it('обновления нет — тоста нет', () => {
    sw.needRefresh = false;
    renderWithProviders(<UpdatePrompt />);
    expect(screen.queryByText('Доступна новая версия')).toBeNull();
  });
});
