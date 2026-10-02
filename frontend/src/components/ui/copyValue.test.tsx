// CopyValue: значение — кнопка копирования с понятным именем; без буфера обмена — просто текст.

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render';
import { CopyValue } from './CopyValue';

const stubClipboard = (writeText: () => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CopyValue', () => {
  it('нажатие копирует значение и сообщает тостом', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    renderWithProviders(<CopyValue label="ОГРН" value="1021602000000" />);

    const button = screen.getByRole('button', { name: 'Скопировать ОГРН 1021602000000' });
    expect(button.textContent).toBe('1021602000000');
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('1021602000000'));
    expect(await screen.findByText('ОГРН скопирован')).toBeTruthy();
  });

  it('отказ буфера обмена — ошибкой, а не молча', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    renderWithProviders(<CopyValue label="ИНН" value="1655000000" />);

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ИНН 1655000000' }));
    expect(await screen.findByText('Не удалось скопировать ИНН')).toBeTruthy();
  });

  it('без Clipboard API — текст без кнопки', () => {
    renderWithProviders(<CopyValue label="ИНН" value="1655000000" />);

    expect(screen.getByText('1655000000')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
