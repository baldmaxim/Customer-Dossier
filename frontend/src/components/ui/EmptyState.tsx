// Пусто — словами и, где можно, с действием («Сбросить фильтр», «Добавить канал»).
// Пустой список и сбой загрузки — разные вещи: ошибка — Callout tone="danger", загрузка —
// Loading/Skeleton, а не «пусто» и не «0».

import { FC, ReactNode } from 'react';

import { Icon, type IconName } from './Icon';
import styles from './EmptyState.module.css';

export interface IEmptyStateProps {
  /** Почему пусто — словами. Пустой список и сбой загрузки читаются по-разному. */
  children?: ReactNode;
  /** Короткий заголовок над пояснением: «Ничего не найдено». */
  title?: ReactNode;
  /** false — без иконки (внутри плотной таблицы или списка). */
  icon?: IconName | false;
  /** Что сделать: Button или ButtonLink. */
  action?: ReactNode;
  /** Компактно — строка слева, для места внутри карточки или колонки. */
  size?: 'md' | 'sm';
  className?: string;
}

export const EmptyState: FC<IEmptyStateProps> = ({ children, title, icon = 'inbox', action, size = 'md', className }) => (
  <div className={[styles.empty, styles[size], className ?? ''].filter(Boolean).join(' ')}>
    {icon && (
      <span className={styles.icon}>
        <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
      </span>
    )}
    <div className={styles.body}>
      {title && <p className={styles.title}>{title}</p>}
      {children && <p className={styles.text}>{children}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  </div>
);
