// Ярлык статуса. Цвет здесь — только подсветка: смысл несёт текст.
// Итоговой оценки надёжности и светофора в портале нет (ADR-009), и один лишь
// цвет нечитаем при дальтонизме — поэтому подпись обязательна.

import { FC, ReactNode } from 'react';

import { useHint } from './useHint';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warn' | 'danger';

export interface IBadgeProps {
  tone?: BadgeTone;
  /** Пояснение по наведению, фокусу и тапу. */
  hint?: string;
  className?: string;
  children: ReactNode;
}

export const Badge: FC<IBadgeProps> = ({ tone = 'neutral', hint, className, children }) => {
  const { triggerProps, bubble, pin } = useHint(hint);
  const cls = [styles.badge, styles[tone], className ?? ''].filter(Boolean).join(' ');

  if (!hint) return <span className={cls}>{children}</span>;

  return (
    <>
      <span {...triggerProps} tabIndex={0} className={cls} onClick={pin}>
        {children}
      </span>
      {bubble}
    </>
  );
};
