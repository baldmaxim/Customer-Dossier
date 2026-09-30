// Ярлык статуса. Цвет здесь — только подсветка: смысл несёт текст.
// Итоговой оценки надёжности и светофора в портале нет (ADR-009), и один лишь
// цвет нечитаем при дальтонизме — поэтому подпись обязательна.
//
// Тон статуса — из src/lib/statusTone.ts (toneOf(RUN_STATUS_TONE, run.status)), подпись —
// из labels.ts. 'accent' — не статус, а выделение (роль компании, вид связи).
//
// С пояснением ярлык — кнопка: фокус с клавиатуры, нажатие пальцем, пояснение диктору через
// aria-description. Раньше это был span с tabIndex без роли — безымянная остановка Tab.

import { FC, ReactNode } from 'react';

import type { StatusTone } from '../../lib/statusTone';
import { useHint } from './useHint';
import styles from './Badge.module.css';

export type BadgeTone = StatusTone | 'accent';

const TONE_CLASS: Record<BadgeTone, string | undefined> = {
  neutral: styles.neutral,
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  accent: styles.accent,
};

export interface IBadgeProps {
  tone?: BadgeTone;
  /** Пояснение по наведению, фокусу и тапу. */
  hint?: string;
  className?: string;
  children: ReactNode;
}

export const Badge: FC<IBadgeProps> = ({ tone = 'neutral', hint, className, children }) => {
  const { triggerProps, bubble, pin } = useHint(hint);
  const cls = [styles.badge, TONE_CLASS[tone], className ?? ''].filter(Boolean).join(' ');

  if (!hint) return <span className={cls}>{children}</span>;

  return (
    <>
      <button {...triggerProps} type="button" className={styles.trigger} onClick={pin}>
        <span className={`${cls} ${styles.hinted}`}>{children}</span>
      </button>
      {bubble}
    </>
  );
};
