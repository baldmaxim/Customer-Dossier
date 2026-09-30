// Раздел страницы: заголовок, пояснение, действия и содержимое на карточке.
// Уровень заголовка — из контекста (h2 на странице, h3 внутри другого раздела); содержимое
// получает уровень на единицу глубже. Явный level — только если глубина известна заранее.
//
// EmptyState раньше жил в этом же файле; реэкспорт оставлен для прежних импортов.

import { FC, ReactNode } from 'react';

import { Heading } from './Heading';
import { HeadingLevelContext, deeper, useHeadingLevel, type HeadingLevel } from './headingLevel';
import styles from './Section.module.css';

export { EmptyState, type IEmptyStateProps } from './EmptyState';

export interface ISectionProps {
  title?: ReactNode;
  /** Короткое пояснение рядом с заголовком: «новые сверху», «всего 12». */
  note?: ReactNode;
  /** Кнопки раздела справа от заголовка (на телефоне — под ним). */
  actions?: ReactNode;
  level?: HeadingLevel;
  /** card — на карточке (по умолчанию); plain — прямо на полотне, без рамки. */
  variant?: 'card' | 'plain';
  id?: string;
  className?: string;
  children: ReactNode;
}

export const Section: FC<ISectionProps> = ({ title, note, actions, level, variant = 'card', id, className, children }) => {
  const contextLevel = useHeadingLevel();
  const own = level ?? contextLevel;
  return (
    <section id={id} className={[styles.section, styles[variant], className ?? ''].filter(Boolean).join(' ')}>
      {(title || note || actions) && (
        <div className={styles.head}>
          {title && (
            <Heading level={own} className={styles.title}>
              {title}
            </Heading>
          )}
          {note && <span className={styles.note}>{note}</span>}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <HeadingLevelContext.Provider value={deeper(own)}>{children}</HeadingLevelContext.Provider>
    </section>
  );
};
