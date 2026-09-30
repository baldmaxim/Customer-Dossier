// Карточка списка: заголовок (ссылка на всю карточку), сведения, числа справа, действия.
// Ссылка остаётся ссылкой (средний клик, Ctrl+клик), кнопки действий подняты над накладкой.

import { FC, ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';

import styles from './CardList.module.css';

export interface ICardListItemProps {
  /** Куда ведёт карточка. Без to — просто карточка, без накладки-ссылки. */
  to?: To;
  title: ReactNode;
  /** Строка под заголовком: «Москва · заказчик, генподрядчик». */
  meta?: ReactNode;
  /** Справа: числа, дата, ярлык состояния. */
  aside?: ReactNode;
  /** Кнопки и ссылки внутри карточки — отдельные цели нажатия. */
  actions?: ReactNode;
  /** Переход анимируется (по умолчанию): карточка ведёт на другой экран. */
  viewTransition?: boolean;
  selected?: boolean;
  /** Остальное содержимое: ярлыки, выдержка. */
  children?: ReactNode;
}

export const CardListItem: FC<ICardListItemProps> = ({
  to,
  title,
  meta,
  aside,
  actions,
  viewTransition = true,
  selected = false,
  children,
}) => (
  <li className={[styles.item, to ? 'row-link' : '', selected ? styles.selected : ''].filter(Boolean).join(' ')}>
    <div className={styles.main}>
      {to ? (
        <Link to={to} viewTransition={viewTransition} className={`row-link-target ${styles.title}`}>
          {title}
        </Link>
      ) : (
        <span className={styles.title}>{title}</span>
      )}
      {meta && <div className={styles.meta}>{meta}</div>}
      {children}
    </div>
    {aside && <div className={styles.aside}>{aside}</div>}
    {actions && <div className={`row-link-above ${styles.actions}`}>{actions}</div>}
  </li>
);
