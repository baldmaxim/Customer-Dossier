// Область тостов и её состояние. Одна на приложение (корень роутера) и одна в тестах
// (renderWithProviders). Область живёт в DOM всегда — aria-live объявляет только то, что
// появилось в уже существующей области.

import { FC, ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import { ToastContext, type IToastApi, type IToastOptions } from './toast';
import { ToastItem, type IToastEntry } from './ToastItem';
import styles from './Toast.module.css';

/** Больше трёх одновременно — уже не тост, а лента: старые уходят. */
const MAX_TOASTS = 3;
/** Сколько тост доигрывает анимацию выхода (--dur-exit) перед удалением из DOM. */
const EXIT_MS = 160;

export interface IToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: FC<IToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<IToastEntry[]>([]);
  const counter = useRef(0);
  const entries = useRef(new Map<string, IToastEntry>());

  const remove = useCallback((id: string): void => {
    // Тост с тем же id успели показать снова, пока старый уходил, — новый не трогаем.
    if (entries.current.get(id)?.leaving === false) return;
    entries.current.delete(id);
    setToasts(list => list.filter(t => t.id !== id || !t.leaving));
  }, []);

  const dismiss = useCallback(
    (id: string): void => {
      const entry = entries.current.get(id);
      if (!entry || entry.leaving) return;
      entries.current.set(id, { ...entry, leaving: true });
      setToasts(list => list.map(t => (t.id === id ? { ...t, leaving: true } : t)));
      entry.onDismiss?.();
      setTimeout(() => remove(id), EXIT_MS);
    },
    [remove],
  );

  const show = useCallback(
    (options: IToastOptions): string => {
      counter.current += 1;
      const id = options.id ?? `toast-${counter.current}`;
      const tone = options.tone ?? 'info';
      const entry: IToastEntry = {
        ...options,
        id,
        tone,
        duration: options.duration === undefined ? (tone === 'danger' ? null : 6000) : options.duration,
        leaving: false,
        // Новая версия того же тоста перезапускает таймер: ключ React меняется.
        version: counter.current,
      };
      entries.current.set(id, entry);
      setToasts(list => {
        const replaced = list.some(t => t.id === id);
        const next = replaced ? list.map(t => (t.id === id ? entry : t)) : [...list, entry];
        const active = next.filter(t => !t.leaving);
        if (active.length <= MAX_TOASTS) return next;
        // Уходят старые, но сначала исчезающие сами: висящий до закрытия («Доступна новая
        // версия», ошибка) человек ещё не видел ответа на него.
        const excess = active.length - MAX_TOASTS;
        const victims = [...active.filter(t => t.duration !== null), ...active.filter(t => t.duration === null)].slice(0, excess);
        const drop = new Set(victims.map(t => t.id));
        drop.forEach(d => entries.current.delete(d));
        return next.filter(t => !drop.has(t.id));
      });
      return id;
    },
    [],
  );

  const api = useMemo<IToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} aria-live="polite" aria-relevant="additions text" data-toast-region>
        {toasts.map(toast => (
          <ToastItem key={`${toast.id}:${toast.version}`} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
