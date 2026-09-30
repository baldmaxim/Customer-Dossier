// Поверхность с рамкой: элемент списка, панель, плитка. Раздел с заголовком — Section;
// Card — когда заголовок свой или его нет вовсе.
//
// Около пятнадцати вариантов «карточки» с четырьмя разными отступами и тремя радиусами
// сводятся сюда: padding и тон — из шкалы, тень — только у поднятых и интерактивных.

import { FC, HTMLAttributes, ReactNode } from 'react';

import styles from './Card.module.css';

export type CardElement = 'div' | 'section' | 'article' | 'aside' | 'li';

export interface ICardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  /** none | sm 12px | md 16px (по умолчанию) | lg 24px. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** muted — второстепенная поверхность; accent — выделенная подложка. */
  tone?: 'default' | 'muted' | 'accent';
  /** Поднятый слой: тень. Для обычной карточки на полотне не нужен. */
  elevated?: boolean;
  /** Карточка — цель нажатия (вместе с .row-link внутри): тень при наведении и «проседание». */
  interactive?: boolean;
  /** Выбранная (мастер-деталь): рамка и полоса акцента, а не только оттенок. */
  selected?: boolean;
  children: ReactNode;
}

export const Card: FC<ICardProps> = ({
  as: Tag = 'div',
  padding = 'md',
  tone = 'default',
  elevated = false,
  interactive = false,
  selected = false,
  className,
  children,
  ...rest
}) => (
  <Tag
    {...rest}
    className={[
      styles.card,
      styles[`pad-${padding}`],
      tone === 'default' ? '' : styles[tone],
      elevated ? styles.elevated : '',
      interactive ? styles.interactive : '',
      selected ? styles.selected : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </Tag>
);
