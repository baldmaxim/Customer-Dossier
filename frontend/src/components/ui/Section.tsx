// Карточка-раздел: поверхность, рамка, заголовок. Повторялась в десяти модулях.

import { FC, ReactNode } from 'react';

import styles from './Section.module.css';

export interface ISectionProps {
  title?: string;
  /** Короткое пояснение справа от заголовка. */
  note?: ReactNode;
  /** Уровень заголовка: h2 по умолчанию, h1 у страницы нет — он в PageHeader. */
  level?: 2 | 3;
  className?: string;
  children: ReactNode;
}

export const Section: FC<ISectionProps> = ({ title, note, level = 2, className, children }) => {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={className ? `${styles.section} ${className}` : styles.section}>
      {(title || note) && (
        <div className={styles.head}>
          {title && <Heading className={styles.title}>{title}</Heading>}
          {note && <span className={styles.note}>{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
};

export interface IEmptyStateProps {
  /** Почему пусто — словами. Пустой список и сбой загрузки читаются по-разному. */
  children: ReactNode;
  className?: string;
}

export const EmptyState: FC<IEmptyStateProps> = ({ children, className }) => (
  <p className={className ? `${styles.empty} ${className}` : styles.empty}>{children}</p>
);
