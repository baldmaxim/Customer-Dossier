// Один диалог подтверждения на приложение: useConfirm() возвращает промис с ответом.
// Закрытие без выбора (Esc, подложка, крестик) — это «нет».

import { FC, ReactNode, useCallback, useRef, useState } from 'react';

import { Button } from './Button';
import { ConfirmContext, type IConfirmOptions } from './confirm';
import { Dialog } from './Dialog';

interface IPending extends IConfirmOptions {
  resolve: (answer: boolean) => void;
}

export interface IConfirmProviderProps {
  children: ReactNode;
}

export const ConfirmProvider: FC<IConfirmProviderProps> = ({ children }) => {
  const [pending, setPending] = useState<IPending | null>(null);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback(
    (options: IConfirmOptions): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        setPending(prev => {
          // Новый запрос при открытом диалоге — прежний считается отменённым.
          prev?.resolve(false);
          return { ...options, resolve };
        });
        setOpen(true);
      }),
    [],
  );

  const answer = (value: boolean): void => {
    pending?.resolve(value);
    // Текст остаётся до конца анимации выхода: закрываем, но не стираем.
    setPending(prev => (prev ? { ...prev, resolve: () => undefined } : prev));
    setOpen(false);
  };

  const danger = pending?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onClose={() => answer(false)}
        title={pending?.title ?? ''}
        size="sm"
        // Необратимое — фокус на «Отмена»: случайный Enter ничего не удалит.
        initialFocus={danger ? cancelRef : confirmRef}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => answer(false)}>
              {pending?.cancelLabel ?? 'Отмена'}
            </Button>
            <Button ref={confirmRef} variant={danger ? 'danger-solid' : 'primary'} onClick={() => answer(true)}>
              {pending?.confirmLabel ?? 'Подтвердить'}
            </Button>
          </>
        }
      >
        {pending?.body}
      </Dialog>
    </ConfirmContext.Provider>
  );
};
