// Карточка экранов до входа — вход, заявка на доступ и смена выданного пароля: знак портала,
// переключатель темы (шапки портала здесь нет, а сменить тему нужно и до входа), заголовок и форма.
//
// Фокус — на заголовке каждого нового экрана (вход ↔ заявка, «Заявка отправлена», смена пароля,
// выход из портала): нажатая кнопка исчезает вместе с экраном, и без этого фокус падал на body,
// а диктор молчал. Рамки у заголовка нет (base.css: h1[tabindex='-1']), первый Tab — к полям.

import { FC, ReactNode, useEffect, useRef } from 'react';

import { Button } from '../components/ui/Button';
import { useTheme } from '../hooks/useTheme';
import styles from './AuthCard.module.css';

interface IAuthCardProps {
  title: string;
  lead?: ReactNode;
  /** Под формой, за чертой: другой путь — «Нет доступа? Отправить заявку». */
  footer?: ReactNode;
  children: ReactNode;
}

export const AuthCard: FC<IAuthCardProps> = ({ title, lead, footer, children }) => {
  const { theme, toggle } = useTheme();
  const themeLabel = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.top}>
          {/* Обе версии в разметке: подмена src при смене темы мигает, CSS — нет. */}
          <img className={`${styles.logo} ${styles.logoLight}`} src="/logo-light.svg" alt="Досье Заказчика" />
          <img className={`${styles.logo} ${styles.logoDark}`} src="/logo-dark.svg" alt="" aria-hidden="true" />
          <Button variant="ghost" iconOnly icon={theme === 'dark' ? 'sun' : 'moon'} aria-label={themeLabel} onClick={toggle} />
        </div>
        <div className={styles.head}>
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {children}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </main>
  );
};
