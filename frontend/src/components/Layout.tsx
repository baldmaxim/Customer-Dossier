import { FC, ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';

import { useTheme } from '../hooks/useTheme';
import styles from './Layout.module.css';

const NAV = [
  { to: '/', label: 'Поиск', end: true },
  { to: '/contractors', label: 'Подрядчики', end: false },
  { to: '/admin', label: 'Админка', end: false },
];

export const Layout: FC<{ children: ReactNode }> = ({ children }) => {
  const { theme, toggle } = useTheme();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand}>
            Досье Заказчика
          </Link>

          <nav className={styles.nav}>
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              className={styles.themeButton}
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </nav>
        </div>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
};
