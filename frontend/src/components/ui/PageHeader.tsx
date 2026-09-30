// Шапка страницы: eyebrow («Компания»), h1, мета-строка, вводный абзац и действия.
// Один h1 на страницу — здесь. h1 с tabIndex=-1: после перехода по маршруту оболочка
// переводит фокус на него (Layout), и диктор сразу слышит, где оказался.
//
// Строковый title заодно ставит заголовок вкладки браузера («… — Досье Заказчика»);
// для составного title передайте docTitle строкой, null — не трогать заголовок вкладки.

import { FC, ReactNode } from 'react';

import { usePageTitle } from '../../hooks/usePageTitle';
import styles from './PageHeader.module.css';

export interface IPageHeaderProps {
  title: ReactNode;
  /** Заголовок только для диктора: на экране его роль играет переключатель или сам пост. */
  titleHidden?: boolean;
  /** Надпись над заголовком: вид страницы или родитель («Объект · ЖК „Северный“»). */
  eyebrow?: ReactNode;
  /** Строка под заголовком: реквизиты, город, даты — Cluster или текст. */
  meta?: ReactNode;
  /** Вводный абзац (ограничен шириной --prose). */
  lead?: ReactNode;
  /** Кнопки страницы: справа от заголовка с 600px, под ним на телефоне. */
  actions?: ReactNode;
  /** Заголовок вкладки браузера, если title — не строка; null — не менять. */
  docTitle?: string | null;
  /** Под шапкой, на всю её ширину: вкладки (Tabs) или плашка. */
  children?: ReactNode;
  className?: string;
}

export const PageHeader: FC<IPageHeaderProps> = ({
  title,
  titleHidden = false,
  eyebrow,
  meta,
  lead,
  actions,
  docTitle,
  children,
  className,
}) => {
  usePageTitle(docTitle === undefined ? (typeof title === 'string' ? title : null) : docTitle);
  return (
    <header className={[styles.header, className ?? ''].filter(Boolean).join(' ')}>
      <div className={styles.top}>
        <div className={styles.titleBlock}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h1 tabIndex={-1} className={titleHidden ? 'visually-hidden' : styles.title}>
            {title}
          </h1>
          {meta && <div className={styles.meta}>{meta}</div>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {lead && <p className={styles.lead}>{lead}</p>}
      {children}
    </header>
  );
};
