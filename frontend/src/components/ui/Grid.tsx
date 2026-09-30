// Адаптивная сетка без медиазапросов: колонок столько, сколько влезает при ширине не меньше
// min; на телефоне — одна. min(100%, …) — колонка не шире контейнера, страница не едет вбок.

import { CSSProperties, FC, HTMLAttributes, ReactNode } from 'react';

import type { LayoutElement, Space } from './Stack';
import styles from './Stack.module.css';

export interface IGridProps extends HTMLAttributes<HTMLElement> {
  /** Минимальная ширина колонки: '240px', '18rem'. */
  min?: string;
  gap?: Space;
  as?: LayoutElement;
  children: ReactNode;
}

export const Grid: FC<IGridProps> = ({ min = '240px', gap = 4, as: Tag = 'div', className, style, children, ...rest }) => (
  <Tag
    {...rest}
    className={[styles.grid, styles[`gap${gap}`], className ?? ''].filter(Boolean).join(' ')}
    // Ширина колонки — значение из пропса, инлайн разрешён: это переменная, а не стиль.
    style={{ ...style, '--grid-min': min } as CSSProperties}
  >
    {children}
  </Tag>
);
