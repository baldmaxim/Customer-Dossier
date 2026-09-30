// Вкладки-ссылки: разделы, у каждого свой адрес (разделы админки). Вид — как у Tabs, но это
// навигация (<nav> + ссылки с aria-current="page"), а не tablist: каждая вкладка — отдельная
// страница, её можно открыть в новой вкладке браузера и отправить ссылкой.
//
// Переход между разделами не уводит фокус со вкладки (keepFocus в состоянии перехода):
// человек переключает разделы, а не уходит со страницы. Диктору раздел объявляет оболочка.

import { FC, Fragment, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { formatCount } from '../../lib/format';
import { KEEP_FOCUS_STATE } from '../../hooks/useRouteFocus';
import { scrollIntoRow } from './scrollIntoRow';
import styles from './Tabs.module.css';

export interface ITabLinkItem {
  to: string;
  label: string;
  /** Активна только на точном адресе (как NavLink end). */
  end?: boolean;
  count?: number | null;
  /** Группа: между разными группами рисуется разделитель. */
  group?: string;
}

export interface ITabLinksProps {
  /** Имя навигации: «Разделы админки». */
  label: string;
  items: ReadonlyArray<ITabLinkItem>;
  variant?: 'underline' | 'pill';
  className?: string;
}

export const TabLinks: FC<ITabLinksProps> = ({ label, items, variant = 'underline', className }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const list = listRef.current;
    scrollIntoRow(list, list?.querySelector<HTMLElement>('[aria-current="page"]'));
  }, [pathname]);

  return (
    <nav aria-label={label} className={className}>
      <div ref={listRef} className={[styles.list, styles[variant]].join(' ')}>
        {items.map((item, i) => {
          const previous = items[i - 1];
          const separated = previous !== undefined && previous.group !== item.group;
          return (
            <Fragment key={item.to}>
              {separated && <span className={styles.separator} aria-hidden="true" />}
              <NavLink to={item.to} end={item.end} viewTransition state={KEEP_FOCUS_STATE} className={styles.tab}>
                <span className={styles.label}>{item.label}</span>
                {item.count !== undefined && item.count !== null && (
                  <span className={styles.count}>{formatCount(item.count)}</span>
                )}
              </NavLink>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
};
