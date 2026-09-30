// Подтверждение действия: удалить источник, сменить роль, сбросить пароль. Вместо
// window.confirm — диалог портала (тема, крупные кнопки, понятные слова на кнопках):
//
//   const confirm = useConfirm();
//   if (await confirm({ title: 'Удалить канал?', body: '…', confirmLabel: 'Удалить', tone: 'danger' })) remove();

import { createContext, ReactNode, useContext } from 'react';

export interface IConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Глагол действия, а не «ОК»: «Удалить», «Сменить роль». */
  confirmLabel: string;
  cancelLabel?: string;
  /** danger — необратимое: красная кнопка, фокус сначала на «Отмена». */
  tone?: 'default' | 'danger';
}

export type ConfirmFn = (options: IConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export const useConfirm = (): ConfirmFn => {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm: нет ConfirmProvider выше по дереву (в тестах — renderWithProviders)');
  return confirm;
};
