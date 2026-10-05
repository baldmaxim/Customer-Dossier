// Шкала доли (распроданность): подпись и число текстом, полоса — подсветка. Один тон при любом
// значении: 10 % и 90 % — не «плохо» и «хорошо» (ADR-009). Доли нет — словами «недостаточно
// данных», пустая дорожка без числа не рисуется.

import { CSSProperties, FC, ReactNode } from 'react';

import { formatPercent } from '../../lib/labels';
import { barPercent } from './chartMath';
import styles from './Charts.module.css';

export interface IMeterProps {
  label: string;
  /** 0..1; null — недостаточно данных. */
  share: number | null;
  /** Как посчитано и по скольким объектам. */
  caption?: ReactNode;
  className?: string;
}

export const Meter: FC<IMeterProps> = ({ label, share, caption, className }) => (
  <div className={[styles.meter, className ?? ''].filter(Boolean).join(' ')}>
    <p className={styles.meterHead}>
      <span className={styles.meterLabel}>{label}</span>
      <span className={styles.meterValue}>{share === null ? 'недостаточно данных' : formatPercent(share)}</span>
    </p>
    {share !== null && (
      <span className={styles.meterTrack} aria-hidden="true">
        <span className={styles.meterFill} style={{ '--w': `${barPercent(share, 1)}%` } as CSSProperties} />
      </span>
    )}
    {caption && <p className={styles.meterCaption}>{caption}</p>}
  </div>
);
