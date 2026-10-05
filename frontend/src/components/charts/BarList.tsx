// Строки-полосы: подпись · полоса · число. Для номинальных категорий (роли, виды событий, статусы
// объектов, сдача по годам) — один цвет на все строки: цвет не говорит «хорошо/плохо» (ADR-009) и
// не дублирует длину полосы. Каждая строка — текст: число читается и без полосы, полоса aria-hidden.
//
// total — знаменатель: полоса — доля от него на дорожке («на 3 из 10 объектов»); без него полоса —
// доля от наибольшего значения, дорожки нет. Сортировка — у вызывающего (по убыванию или по порядку
// лет), здесь порядок не меняется. Хвост длиннее limit сворачивается в одну строку словами.

import { CSSProperties, FC, ReactNode } from 'react';

import { formatCount } from '../../lib/format';
import { barPercent } from './chartMath';
import styles from './Charts.module.css';

export interface IBarListItem {
  key: string;
  label: ReactNode;
  value: number;
}

export interface IBarListProps {
  /** Имя списка для диктора: «Роли на объектах». */
  label: string;
  items: ReadonlyArray<IBarListItem>;
  /** Знаменатель доли; без него полоса — от наибольшего значения. */
  total?: number | null;
  /** Сколько строк показать; остальные — строкой «ещё N — M». */
  limit?: number;
  /** Подпись свёрнутого хвоста: (сколько строк, их сумма) → «ещё 3 вида — 7». */
  restText?: (count: number, sum: number) => string;
  className?: string;
}

const defaultRest = (count: number, sum: number): string => `ещё ${formatCount(count)} — ${formatCount(sum)}`;

export const BarList: FC<IBarListProps> = ({ label, items, total = null, limit = 6, restText = defaultRest, className }) => {
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  const withTotal = total !== null && total > 0;
  const base = withTotal ? total : Math.max(0, ...items.map(i => i.value));
  return (
    <div className={[styles.barList, className ?? ''].filter(Boolean).join(' ')}>
      <ul className={styles.barRows} aria-label={label}>
        {shown.map(item => (
          <li key={item.key} className={styles.barRow}>
            <span className={styles.barLabel}>{item.label}</span>
            <span className={withTotal ? `${styles.barTrack} ${styles.barTrackFilled}` : styles.barTrack} aria-hidden="true">
              <span className={styles.barFill} style={{ '--w': `${barPercent(item.value, base)}%` } as CSSProperties} />
            </span>
            <span className={styles.barValue}>{formatCount(item.value)}</span>
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <p className={styles.barRest}>
          {restText(
            rest.length,
            rest.reduce((sum, i) => sum + i.value, 0),
          )}
        </p>
      )}
    </div>
  );
};
