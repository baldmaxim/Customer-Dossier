// Мини-столбики в плитке сводки (публикации по месяцам). Только форма ряда: число и подпись уже
// стоят в плитке текстом, поэтому для диктора график скрыт. Счётные данные — столбиками, а не
// линией: линия между месяцами выдумывала бы значения посередине.

import { CSSProperties, FC } from 'react';

import { barPercent, niceMax } from './chartMath';
import styles from './Charts.module.css';

export interface ISparklineProps {
  values: ReadonlyArray<number>;
  /** Последний месяц неполный — светлее. */
  partialLast?: boolean;
  className?: string;
}

export const Sparkline: FC<ISparklineProps> = ({ values, partialLast = false, className }) => {
  const top = niceMax(Math.max(0, ...values));
  return (
    <span className={[styles.spark, className ?? ''].filter(Boolean).join(' ')} aria-hidden="true" style={{ '--n': Math.max(1, values.length) } as CSSProperties}>
      {values.map((v, i) => (
        <span
          // Ряд фиксированной длины и не переставляется: индекс — устойчивый ключ.
          key={i}
          className={styles.sparkBar}
          data-partial={(partialLast && i === values.length - 1) || undefined}
          style={{ '--h': `${v > 0 ? Math.max(8, barPercent(v, top)) : 0}%` } as CSSProperties}
        />
      ))}
    </span>
  );
};
