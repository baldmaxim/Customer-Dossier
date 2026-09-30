// Вертикальный поток с промежутком из шкалы. gap родителя вместо margin детей: интервалы
// между блоками были 16, 18, 28, 30 и 34px от того, что каждый блок ставил свой отступ.

import { FC, HTMLAttributes, ReactNode } from 'react';

import styles from './Stack.module.css';

/** Ступень шкалы --sp-*: 0 — вплотную, 1 = 4px … 7 = 48px. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type LayoutElement = 'div' | 'section' | 'ul' | 'ol' | 'li' | 'nav' | 'header' | 'footer' | 'article' | 'aside' | 'form' | 'dl';

export interface IStackProps extends HTMLAttributes<HTMLElement> {
  gap?: Space;
  as?: LayoutElement;
  align?: 'start' | 'center' | 'end' | 'stretch';
  children: ReactNode;
}

export const Stack: FC<IStackProps> = ({ gap = 4, as: Tag = 'div', align = 'stretch', className, children, ...rest }) => (
  <Tag {...rest} className={[styles.stack, styles[`gap${gap}`], styles[`align-${align}`], className ?? ''].filter(Boolean).join(' ')}>
    {children}
  </Tag>
);
