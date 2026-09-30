// Контекст тостов: короткое сообщение о результате действия («Канал добавлен», «Не удалось
// удалить: …»). Живёт над нижней панелью и сам исчезает; ошибка — висит до закрытия.
// То, что должно остаться на экране, — Callout, а не тост.

import { createContext, ReactNode, useContext } from 'react';

import type { StatusTone } from '../../lib/statusTone';

export interface IToastAction {
  label: string;
  onClick: () => void;
}

export interface IToastOptions {
  /** Свой id: повторный show с тем же id заменяет тост, а не добавляет второй. */
  id?: string;
  tone?: StatusTone;
  text: ReactNode;
  action?: IToastAction;
  /** Мс до закрытия; null — висит, пока не закроют. По умолчанию 6 с, у danger — null. */
  duration?: number | null;
  /** Имя крестика для диктора: «Закрыть», «Отложить». */
  dismissLabel?: string;
  /** Тост закрыт — крестиком, по таймеру, действием или dismiss(id). */
  onDismiss?: () => void;
}

export interface IToastApi {
  show: (options: IToastOptions) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<IToastApi | null>(null);

export const useToast = (): IToastApi => {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast: нет ToastProvider выше по дереву (в тестах — renderWithProviders)');
  return api;
};
