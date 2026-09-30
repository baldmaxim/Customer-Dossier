// Скелет: серые полосы на месте будущих строк — раскладка не прыгает, когда данные придут.
// Только украшение (aria-hidden): что идёт загрузка, говорит Loading.

import { FC } from 'react';

import styles from './Skeleton.module.css';

export interface ISkeletonProps {
  /** Сколько полос; у последней из нескольких — 60% ширины, как у строки абзаца. */
  lines?: number;
  width?: string;
  height?: string;
  radius?: 'sm' | 'md' | 'full';
  className?: string;
}

export const Skeleton: FC<ISkeletonProps> = ({ lines = 1, width = '100%', height = '1em', radius = 'sm', className }) => (
  <span className={[styles.group, className ?? ''].filter(Boolean).join(' ')} aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => (
      <span
        key={i}
        className={`${styles.bar} ${styles[radius]}`}
        // Размеры — из пропсов, значения динамические: инлайн разрешён.
        style={{ width: lines > 1 && i === lines - 1 ? '60%' : width, height }}
      />
    ))}
  </span>
);
