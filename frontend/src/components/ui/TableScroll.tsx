// Таблица со своей горизонтальной прокруткой: страница по горизонтали не едет
// никогда (e2e T18-05 проверяет это на 390px).

import { FC, ReactNode } from 'react';

import styles from './TableScroll.module.css';

export interface ITableScrollProps {
  /** Ниже этой ширины таблица скроллится внутри себя. */
  minWidth?: number;
  /** Шапка липнет к верху собственного окна прокрутки (контейнер получает высоту). */
  stickyHead?: boolean;
  className?: string;
  children: ReactNode;
}

export const TableScroll: FC<ITableScrollProps> = ({ minWidth = 720, stickyHead = false, className, children }) => (
  <div className={[styles.wrap, stickyHead ? styles.tall : '', className ?? ''].filter(Boolean).join(' ')}>
    {/* Ширина динамическая — инлайн здесь разрешён правилами проекта. */}
    <table className={styles.table} style={{ minWidth }}>
      {children}
    </table>
  </div>
);
