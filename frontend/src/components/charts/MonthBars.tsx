// Столбики по месяцам (signals@3: публикации и события за 24 месяца). Одна величина — одна шкала: два
// ряда рисуются двумя графиками на одной оси месяцев, а не двумя шкалами на одном (dataviz: dual-axis
// — главная ошибка графиков).
//
// Наведение (или нажатие пальцем) показывает месяц и число строкой над графиком; без наведения там
// итог и самый высокий месяц. График для диктора — role="img" со сводкой словами; все числа по месяцам
// — таблицей в ChartData рядом. Последний месяц обычно неполный (срез посреди месяца): его столбик
// светлее, и это сказано словами — иначе спад в последнем месяце читается как спад активности.

import { CSSProperties, FC, useState } from 'react';

import { formatCount, formatCountWord, type PluralForms } from '../../lib/format';
import { formatMonth } from '../../lib/labels';
import { barPercent, niceMax, peakOf, type IMonthPoint } from './chartMath';
import styles from './Charts.module.css';

export interface IMonthBarsProps {
  /** Что за ряд: «Публикации по месяцам». */
  label: string;
  points: ReadonlyArray<IMonthPoint>;
  /** Формы слова для чисел: ['публикация', 'публикации', 'публикаций']. */
  forms: PluralForms;
  /** Последний месяц не закончился на дату среза. */
  partialLast?: boolean;
  className?: string;
}

/** Метка оси — год под январём и под первым столбиком, если до января хватает места. */
const tickOf = (point: IMonthPoint, index: number): string | null => {
  const [year, month] = point.month.split('-');
  if (month === '01') return year ?? null;
  return index === 0 && Number(month) <= 9 ? (year ?? null) : null;
};

export const MonthBars: FC<IMonthBarsProps> = ({ label, points, forms, partialLast = false, className }) => {
  const [active, setActive] = useState<number | null>(null);
  const total = points.reduce((s, p) => s + p.value, 0);
  const peak = peakOf(points);
  const top = niceMax(peak?.value ?? 0);
  const first = points[0];
  const last = points[points.length - 1];
  const lastIndex = points.length - 1;

  const peakText = peak ? `больше всего — ${formatMonth(peak.month)} (${formatCount(peak.value)})` : 'ни одного';
  const partialText = partialLast && last ? `; ${formatMonth(last.month)} ещё не закончился` : '';
  const summary =
    first && last
      ? `${label}, ${formatMonth(first.month)} — ${formatMonth(last.month)}: всего ${formatCountWord(total, forms)}, ${peakText}${partialText}`
      : `${label}: нет данных`;
  const hovered = active === null ? null : points[active];
  const readout = hovered
    ? `${formatMonth(hovered.month)} — ${formatCountWord(hovered.value, forms)}${partialLast && active === lastIndex ? ', месяц не закончился' : ''}`
    : `всего ${formatCountWord(total, forms)} · ${peakText}`;

  return (
    <figure className={[styles.months, className ?? ''].filter(Boolean).join(' ')}>
      <figcaption className={styles.monthsHead}>
        <span className={styles.monthsLabel}>{label}</span>
        <span className={styles.monthsReadout} aria-hidden="true">
          {readout}
        </span>
      </figcaption>
      <div
        className={styles.monthsPlot}
        role="img"
        aria-label={summary}
        style={{ '--n': Math.max(1, points.length) } as CSSProperties}
        onPointerLeave={() => setActive(null)}
      >
        {points.map((p, i) => (
          <span
            key={p.month}
            className={styles.monthCol}
            data-active={active === i || undefined}
            onPointerEnter={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            {p.value > 0 && (
              <span
                className={styles.monthBar}
                data-partial={(partialLast && i === lastIndex) || undefined}
                style={{ '--h': `${barPercent(p.value, top)}%` } as CSSProperties}
              />
            )}
          </span>
        ))}
      </div>
      <div className={styles.monthsAxis} aria-hidden="true" style={{ '--n': Math.max(1, points.length) } as CSSProperties}>
        {points.map((p, i) => (
          <span key={p.month}>{tickOf(p, i)}</span>
        ))}
      </div>
    </figure>
  );
};
