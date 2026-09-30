// Тосты: текст с ролью status (ошибка — alert), действие, закрытие крестиком и по таймеру,
// повторный show с тем же id заменяет тост. Область уведомлений живёт в DOM всегда.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render';
import { Button } from './Button';
import { useToast, type IToastOptions } from './toast';

const Shower = ({ options }: { options: IToastOptions }) => {
  const { show } = useToast();
  return <Button onClick={() => show(options)}>Показать</Button>;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('тосты', () => {
  it('сообщение — role="status" с текстом', () => {
    renderWithProviders(<Shower options={{ text: 'Канал добавлен', tone: 'success' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(screen.getByRole('status').textContent).toContain('Канал добавлен');
  });

  it('ошибка — role="alert" и не исчезает сама', () => {
    vi.useFakeTimers();
    renderWithProviders(<Shower options={{ text: 'Не удалось удалить', tone: 'danger' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByRole('alert').textContent).toContain('Не удалось удалить');
  });

  it('исчезает сам через duration', () => {
    vi.useFakeTimers();
    renderWithProviders(<Shower options={{ text: 'Сохранено', duration: 3000 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(screen.getByText('Сохранено')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000 + 500);
    });
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  it('действие вызывается, тост закрывается и сообщает об этом', async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    renderWithProviders(
      <Shower options={{ text: 'Доступна новая версия', duration: null, action: { label: 'Обновить', onClick }, onDismiss }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Доступна новая версия')).toBeNull());
  });

  it('крестик назван по смыслу (dismissLabel)', async () => {
    const onDismiss = vi.fn();
    renderWithProviders(<Shower options={{ text: 'Доступна новая версия', duration: null, dismissLabel: 'Отложить', onDismiss }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отложить' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Доступна новая версия')).toBeNull());
  });

  it('повторный show с тем же id заменяет тост, а не добавляет второй', () => {
    renderWithProviders(<Shower options={{ id: 'probe', text: 'Проба идёт…', duration: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    expect(screen.getAllByText('Проба идёт…')).toHaveLength(1);
  });

  it('показанный снова, пока прежний уходил, тост остаётся', async () => {
    renderWithProviders(<Shower options={{ id: 'probe', text: 'Проба идёт…', duration: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(screen.getByRole('button', { name: 'Показать' }));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(screen.getAllByText('Проба идёт…')).toHaveLength(1);
  });

  it('без провайдера — понятная ошибка, а не тихий no-op', () => {
    const Bare = () => {
      useToast();
      return null;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Голый render без обёрток: проверяем именно отсутствие провайдера.
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
