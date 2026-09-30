// Карточка экранов до входа — вход и смена выданного пароля: знак портала, переключатель
// темы (шапки портала здесь нет, а сменить тему нужно и до входа), заголовок и форма.

import { FC, ReactNode } from 'react';

import { Button } from '../components/ui/Button';
import { useTheme } from '../hooks/useTheme';
import styles from './AuthCard.module.css';

interface IAuthCardProps {
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}

export const AuthCard: FC<IAuthCardProps> = ({ title, lead, children }) => {
  const { theme, toggle } = useTheme();
  const themeLabel = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
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
          <h1 className={styles.title}>{title}</h1>
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {children}
      </div>
    </main>
  );
};
