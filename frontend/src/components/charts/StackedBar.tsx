// Полоса «часть целого» для порядковых категорий (полнота текста, происхождение) — ступенями одного
// оттенка, от сильной к слабой (--chart-1…4, проверены валидатором dataviz). Цвет следует за
// категорией, а не за местом: ступень — по позиции в переданном порядке, нулевой сегмент цвета соседей
// не сдвигает. Номинальные категории сюда не передавать — для них BarList одним цветом.
//
// Полоса aria-hidden: смысл несёт легенда — каждая категория текстом с числом и долей. Между
// сегментами — 2px поверхности, рамок у сегментов нет.

import { CSSProperties, FC } from 'react';

import { formatCount } from '../../lib/format';
import { formatPercent } from '../../lib/labels';
import { barPercent, shareOf } from './chartMath';
import styles from './Charts.module.css';

/** Ступеней цвета — четыре: пятая категория сюда не помещается (свёрнуть в «прочие» у вызывающего). */
const STEPS = 4;

export interface IStackSegment {
  key: string;
  label: string;
  value: number;
}

export interface IStackedBarProps {
  /** Имя легенды для диктора: «Полнота текстов». */
  label: string;
  /** Порядок — от сильной категории к слабой; не больше четырёх. */
  segments: ReadonlyArray<IStackSegment>;
  /** Знаменатель; по умолчанию — сумма сегментов. */
  total?: number;
  className?: string;
}

export const StackedBar: FC<IStackedBarProps> = ({ label, segments, total, className }) => {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const steps = segments.slice(0, STEPS).map((segment, i) => ({ ...segment, step: i + 1 }));
  const present = steps.filter(s => s.value > 0);
  return (
    <div className={[styles.stack, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.stackBar} aria-hidden="true">
        {present.map(s => (
          <span key={s.key} className={styles.stackSeg} data-step={s.step} style={{ '--w': `${barPercent(s.value, sum)}%` } as CSSProperties} />
        ))}
      </div>
      <ul className={styles.legend} aria-label={label}>
        {present.map(s => (
          <li key={s.key} className={styles.legendItem}>
            <span className={styles.swatch} data-step={s.step} aria-hidden="true" />
            <span>{s.label}</span>
            <span className={styles.legendValue}>
              {formatCount(s.value)} · {formatPercent(shareOf(s.value, sum))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
