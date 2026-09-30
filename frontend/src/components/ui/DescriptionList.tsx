// Пары «подпись — значение»: реквизиты, сведения реестра, параметры разбора, профиль.
// Шесть самодельных реализаций (Row, Line, dl.facts…) сводятся сюда.
//
// layout: stacked — подпись над значением (телефон); inline — две колонки;
// auto (по умолчанию) — stacked до 600px, inline шире.

import { FC, ReactNode } from 'react';

import { DescriptionTerm } from './DescriptionTerm';
import styles from './DescriptionList.module.css';

export interface IDescriptionItem {
  label: ReactNode;
  /** Пусто — покажите «—» или «не указано» словами; null/'' здесь печатается как «—». */
  value: ReactNode;
  /** Пояснение к подписи — по наведению и фокусу. */
  hint?: string;
  /** Ключ React, если подпись не строка. */
  key?: string;
}

export interface IDescriptionListProps {
  items: ReadonlyArray<IDescriptionItem>;
  layout?: 'stacked' | 'inline' | 'auto';
  /** Плотнее: меньше промежутки, мелкий шрифт — для панели сбоку. */
  dense?: boolean;
  className?: string;
}

export const DescriptionList: FC<IDescriptionListProps> = ({ items, layout = 'auto', dense = false, className }) => (
  <dl className={[styles.list, styles[layout], dense ? styles.dense : '', className ?? ''].filter(Boolean).join(' ')}>
    {items.map((item, i) => (
      <div key={item.key ?? (typeof item.label === 'string' ? item.label : i)} className={styles.row}>
        <DescriptionTerm label={item.label} hint={item.hint} />
        <dd className={styles.value}>{item.value === null || item.value === '' || item.value === undefined ? '—' : item.value}</dd>
      </div>
    ))}
  </dl>
);
