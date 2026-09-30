// Один тост: текст, действие, крестик. Таймер закрытия стоит, пока указатель или фокус
// внутри (WCAG 2.2.1: прочитать успевают все).

import { FC, useCallback, useEffect, useRef } from 'react';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import type { IToastOptions } from './toast';
import type { StatusTone } from '../../lib/statusTone';
import styles from './Toast.module.css';

export interface IToastEntry extends IToastOptions {
  id: string;
  tone: StatusTone;
  duration: number | null;
  leaving: boolean;
  version: number;
}

const TONE_ICON: Record<StatusTone, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'info',
};

interface IToastItemProps {
  toast: IToastEntry;
  onDismiss: (id: string) => void;
}

export const ToastItem: FC<IToastItemProps> = ({ toast, onDismiss }) => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { id, duration, leaving } = toast;

  const stop = useCallback((): void => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const start = useCallback((): void => {
    stop();
    if (duration === null || leaving) return;
    timer.current = setTimeout(() => onDismiss(id), duration);
  }, [stop, duration, leaving, onDismiss, id]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  return (
    <div
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      aria-atomic="true"
      className={[styles.toast, styles[toast.tone], leaving ? styles.leaving : ''].filter(Boolean).join(' ')}
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
    >
      <Icon name={TONE_ICON[toast.tone]} size="md" className={styles.icon} />
      <div className={styles.text}>{toast.text}</div>
      {toast.action && (
        <Button
          size="sm"
          variant="primary"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            onDismiss(id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        iconOnly
        icon="close"
        className={styles.close}
        aria-label={toast.dismissLabel ?? 'Закрыть'}
        onClick={() => onDismiss(id)}
      />
    </div>
  );
};
