// Оболочка портала: ссылка «К содержанию», шапка с меню (от 600px; телефон боком — полосой слева),
// main, нижняя панель (телефон), объявление смены страницы для диктора. Страница — children (тесты) или
// дочерний маршрут (<Outlet/> в RouterProvider).

import { FC, ReactNode, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAnnouncer } from '../hooks/useAnnouncer';
import { useAuth } from '../hooks/useAuth';
import { useRouteFocus } from '../hooks/useRouteFocus';
import { useTheme } from '../hooks/useTheme';
import { BackBar } from './BackBar';
import { LlmSpend } from './LlmSpend';
import { inSection, navFor, type INavItem } from './navItems';
import { NewsCounter } from './news/NewsCounter';
import { Icon } from './ui/Icon';
import styles from './Layout.module.css';

interface ILayoutProps {
  children?: ReactNode;
}

/** Класс пункта: активный — по адресу, «в разделе» — на детальной странице раздела. */
const itemClass = (base: string, active: string, item: INavItem, pathname: string) =>
  ({ isActive }: { isActive: boolean }): string =>
    isActive || inSection(item, pathname) ? `${base} ${active}` : base;

export const Layout: FC<ILayoutProps> = ({ children }) => {
  const { theme, toggle } = useTheme();
  const { user, can, logout } = useAuth();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [announcement, announce] = useAnnouncer();
  useRouteFocus(mainRef, announce);

  const themeLabel = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  const logoutLabel = `Выйти (${user.displayName})`;
  const nav = navFor(can);

  return (
    <div className={styles.shell}>
      <a
        href="#main"
        className={styles.skip}
        onClick={e => {
          // Без перехода по #main: роутер принял бы якорь за смену адреса.
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        К содержанию
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" viewTransition className={styles.brand} aria-label="Досье Заказчика — на главную">
            {/* Обе версии в разметке: подмена src при переключении темы даёт
                мигание, CSS-переключение — нет. */}
            <img className={styles.logoLight} src="/logo-light.svg" alt="Досье Заказчика" />
            <img className={styles.logoDark} src="/logo-dark.svg" alt="" aria-hidden="true" />
            {/* Знак без надписи — для полосы меню слева (телефон боком): надпись в 72px не входит. */}
            <img className={styles.logoMark} src="/favicon.svg" alt="" aria-hidden="true" />
          </Link>

          <nav className={styles.nav} aria-label="Основная навигация">
            {nav.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                viewTransition
                className={itemClass(styles.navLink ?? '', styles.navLinkActive ?? '', item, pathname)}
              >
                <Icon name={item.icon} size="sm" />
                <span className={styles.navLabel}>{item.label}</span>
                {item.counter === 'news' && <NewsCounter />}
              </NavLink>
            ))}
          </nav>

          <div className={styles.tools}>
            <LlmSpend />
            <button type="button" className={styles.tool} onClick={toggle} aria-label={themeLabel} title={themeLabel}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="md" />
            </button>
            {logout && (
              <button type="button" className={styles.tool} onClick={logout} aria-label={logoutLabel} title={logoutLabel}>
                <Icon name="exit" size="md" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <BackBar />
        {children ?? <Outlet />}
      </main>

      {/* Нижняя панель — только на смартфоне: до неё дотягивается большой палец,
          а шапку на объекте держат одной рукой. data-tabbar — для --bottom-ui (index.css). */}
      <nav className={styles.tabbar} aria-label="Навигация" data-tabbar>
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            viewTransition
            className={itemClass(styles.tab ?? '', styles.tabActive ?? '', item, pathname)}
          >
            <span className={styles.tabIcon}>
              <Icon name={item.icon} size="lg" />
            </span>
            <span className={styles.tabLabel}>{item.label}</span>
            {item.counter === 'news' && <NewsCounter />}
          </NavLink>
        ))}
      </nav>

      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
};
