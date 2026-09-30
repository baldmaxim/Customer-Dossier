// Панель выбранной вкладки. Рендерится одна — для текущего значения; при смене вкладки
// содержимое входит заново (enter-up), а прокрутка страницы не сбрасывается.
//
// tabIndex=0 по умолчанию (WAI-ARIA): панель чаще начинается с текста, и без этого Tab
// с вкладки перепрыгивал бы сразу к первой ссылке где-то в середине.

import { FC, ReactNode } from 'react';

import { panelId, tabId } from './tabs';
import styles from './Tabs.module.css';

export interface ITabPanelProps {
  idBase: string;
  /** Значение выбранной вкладки — то же, что в Tabs. */
  value: string;
  /** false — панель начинается с интерактивного элемента, отдельная остановка Tab не нужна. */
  focusable?: boolean;
  className?: string;
  children: ReactNode;
}

export const TabPanel: FC<ITabPanelProps> = ({ idBase, value, focusable = true, className, children }) => (
  <div
    key={value}
    role="tabpanel"
    id={panelId(idBase, value)}
    aria-labelledby={tabId(idBase, value)}
    tabIndex={focusable ? 0 : undefined}
    className={[styles.panel, className ?? ''].filter(Boolean).join(' ')}
  >
    {children}
  </div>
);
