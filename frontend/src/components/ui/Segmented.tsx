// Группа взаимоисключающих кнопок: «вид списка», «период», «тип связей».
// До неё то же самое жило как .filter, .tab, .segment и .buttonActive в четырёх
// файлах с тремя разными высотами.
//
// Роль остаётся button + aria-pressed, поэтому getByRole('button', { name })
// в тестах продолжает находить эти кнопки.

import { ReactElement } from 'react';

import { Button, ButtonSize } from './Button';
import styles from './Segmented.module.css';

export interface ISegmentedItem<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface ISegmentedProps<T extends string> {
  /** Доступное имя группы: «Вид», «Период», «Тип связей». */
  label: string;
  items: ReadonlyArray<ISegmentedItem<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: ButtonSize;
}

export const Segmented = <T extends string>({
  label,
  items,
  value,
  onChange,
  size = 'sm',
}: ISegmentedProps<T>): ReactElement => (
  <div className={styles.group} role="group" aria-label={label}>
    {items.map(item => (
      <Button
        key={item.value}
        size={size}
        variant="ghost"
        hint={item.hint}
        aria-pressed={item.value === value}
        className={item.value === value ? `${styles.item} ${styles.active}` : styles.item}
        onClick={() => onChange(item.value)}
      >
        {item.label}
      </Button>
    ))}
  </div>
);
