// Ряд с переносом: кнопки действий, ярлыки, мета-строка «город · роль · дата».
// Вместо разделителя «·» в тексте — промежуток: перенесённая строка не начинается с точки.

import { FC, HTMLAttributes, ReactNode } from 'react';

import type { LayoutElement, Space } from './Stack';
import styles from './Stack.module.css';

export interface IClusterProps extends HTMLAttributes<HTMLElement> {
  /** Один промежуток или [по вертикали, по горизонтали]. */
  gap?: Space | readonly [Space, Space];
  as?: LayoutElement;
  align?: 'start' | 'center' | 'baseline' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'between' | 'end';
  /** false — в одну строку (содержимое само решает, как ужиматься). */
  wrap?: boolean;
  children: ReactNode;
}

export const Cluster: FC<IClusterProps> = ({
  gap = 2,
  as: Tag = 'div',
  align = 'center',
  justify = 'start',
  wrap = true,
  className,
  children,
  ...rest
}) => {
  const [row, column] = typeof gap === 'number' ? [gap, gap] : gap;
  return (
    <Tag
      {...rest}
      className={[
        styles.cluster,
        styles[`rowGap${row}`],
        styles[`colGap${column}`],
        styles[`align-${align}`],
        styles[`justify-${justify}`],
        wrap ? '' : styles.nowrap,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Tag>
  );
};
