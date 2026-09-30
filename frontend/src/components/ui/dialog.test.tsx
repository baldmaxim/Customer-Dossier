// Диалог: имя из заголовка, Esc и крестик закрывают, фокус внутрь и обратно;
// useConfirm — промис с ответом, закрытие без выбора — «нет».

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/render';
import { Button } from './Button';
import { useConfirm } from './confirm';
import { Dialog } from './Dialog';

const DialogHarness = ({ onClose }: { onClose?: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Сбросить пароль</Button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Новый пароль"
        description="Покажите его пользователю один раз."
        footer={<Button onClick={() => setOpen(false)}>Готово</Button>}
      >
        <input aria-label="Пароль" defaultValue="Issued-Pass-4410" />
      </Dialog>
    </>
  );
};

describe('Dialog', () => {
  it('закрытый диалог не рендерится вовсе', () => {
    renderWithProviders(<DialogHarness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('имя и описание из заголовка; фокус — на первом поле тела', () => {
    renderWithProviders(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
    const dialog = screen.getByRole('dialog', { name: 'Новый пароль' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Покажите его пользователю один раз.',
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Пароль'));
  });

  it('Esc закрывает, фокус возвращается к кнопке, открывшей диалог', async () => {
    const onClose = vi.fn();
    renderWithProviders(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Сбросить пароль' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('крестик «Закрыть» закрывает', async () => {
    const onClose = vi.fn();
    renderWithProviders(<DialogHarness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить пароль' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Esc, потраченный полем (очистка поиска), диалог не закрывает', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Dialog open onClose={onClose} title="Выбор">
        <input aria-label="Поиск" onKeyDown={e => e.preventDefault()} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('Поиск'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

const ConfirmHarness = ({ onAnswer }: { onAnswer: (answer: boolean) => void }) => {
  const confirm = useConfirm();
  return (
    <Button
      onClick={async () =>
        onAnswer(await confirm({ title: 'Удалить канал?', body: 'Публикаций по нему нет.', confirmLabel: 'Удалить', tone: 'danger' }))
      }
    >
      Удалить канал
    </Button>
  );
};

describe('useConfirm', () => {
  it('«Удалить» — true; для необратимого фокус сначала на «Отмена»', async () => {
    const onAnswer = vi.fn();
    renderWithProviders(<ConfirmHarness onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить канал' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить канал?' });
    expect(dialog.textContent).toContain('Публикаций по нему нет.');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отмена' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    });
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('Отмена и Esc — false', async () => {
    const onAnswer = vi.fn();
    renderWithProviders(<ConfirmHarness onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить канал' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }));
    });
    expect(onAnswer).toHaveBeenLastCalledWith(false);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Удалить канал' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить канал?' });
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(onAnswer).toHaveBeenLastCalledWith(false);
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });
});
