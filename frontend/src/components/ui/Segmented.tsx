// Группа взаимоисключающих кнопок — фильтры и режимы внутри экрана: «вид списка», «период»,
// «тип связей». Вкладки уровня страницы — Tabs, не Segmented (README примитивов).
//
// Роль остаётся button + aria-pressed, поэтому getByRole('button', { name })
// в тестах продолжает находить эти кнопки.
//
// Не помещается в ширину — прокручивается в одну строку, а не переносится «облаком»
// внутри пилюли; выбранный пункт при этом докручивается в видимую область.

import { ReactElement, useEffect, useRef } from 'react';

import { Button, type ButtonSize } from './Button';
import { scrollIntoRow } from './scrollIntoRow';
import styles from './Segmented.module.css';

export interface ISegmentedItem<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface ISegmentedProps<T extends string> {
  /** Доступное имя группы: «Вид», «Период», «Тип связей». */
  label: string;
  items: ReadonlyArray<ISegmentedItem<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: ButtonSize;
  /** Во всю ширину: пункты делят строку поровну (режимы на телефоне). */
  fill?: boolean;
  className?: string;
}

export const Segmented = <T extends string>({
  label,
  items,
  value,
  onChange,
  size = 'sm',
  fill = false,
  className,
}: ISegmentedProps<T>): ReactElement => {
  const groupRef = useRef<HTMLDivElement>(null);

  // Выбранный пункт за краем прокрутки не виден — докручиваем группу, не трогая страницу.
  useEffect(() => {
    const group = groupRef.current;
    scrollIntoRow(group, group?.querySelector<HTMLElement>('[aria-pressed="true"]'));
  }, [value]);

  return (
    <div
      ref={groupRef}
      className={[styles.group, fill ? styles.fill : '', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={label}
    >
      {items.map(item => (
        <Button
          key={item.value}
          size={size}
          variant="ghost"
          hint={item.hint}
          disabled={item.disabled}
          aria-pressed={item.value === value}
          className={item.value === value ? `${styles.item} ${styles.active}` : styles.item}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
};
