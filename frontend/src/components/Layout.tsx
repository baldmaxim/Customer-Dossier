import { FC, ReactNode } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';

import { useTheme } from '../hooks/useTheme';
import styles from './Layout.module.css';

interface INavItem {
  to: string;
  label: string;
  end: boolean;
  /** Контур иконки для нижней панели на смартфоне. */
  icon: string;
}

// «Подрядчики» отсюда убраны: экран показывал тот же /api/contractors с теми же
// фильтрами, что и каталог на главной, — два пункта меню вели к одному списку.
const NAV: INavItem[] = [
  {
    to: '/',
    label: 'Компании',
    end: true,
    icon: 'M10.75 3.75a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM15.9 15.9 20.5 20.5',
  },
  {
    to: '/links',
    label: 'Связи',
    end: false,
    icon: 'M7 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM17 13.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM17 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM9.3 9.2l5.4 3.1M9.5 8.5 14.5 7',
  },
  {
    to: '/admin',
    label: 'Админка',
    end: false,
    icon: 'M3.5 7.5h9M16.5 7.5h4M3.5 16.5h4M11.5 16.5h9M14.5 5v5M9.5 14v5',
  },
];

const SUN =
  'M12 4.5v-2M12 21.5v-2M4.5 12h-2M21.5 12h-2M6.7 6.7 5.3 5.3M18.7 18.7l-1.4-1.4M6.7 17.3l-1.4 1.4M18.7 5.3l-1.4 1.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z';
const MOON = 'M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z';

const Glyph: FC<{ d: string; className?: string }> = ({ d, className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={d} />
  </svg>
);

interface ILayoutProps {
  children: ReactNode;
}

/**
 * Возврат на шаг назад — на каждой странице, кроме главной.
 *
 * Ссылки внутри текста уводят на карточки компаний и объектов, а обратного пути с них
 * не было вовсе: в установленном приложении кнопки браузера нет, и человек оказывался
 * в тупике. Если истории нет (прямая ссылка, перезагрузка), ведём на главную, а не
 * выбрасываем из портала.
 */
const BackBar: FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  if (location.pathname === '/') return null;

  // key === 'default' — первая запись истории: возвращаться некуда.
  return location.key === 'default' ? (
    <Link className={styles.back} to="/">
      ← К компаниям
    </Link>
  ) : (
    <button type="button" className={styles.back} onClick={() => navigate(-1)}>
      ← Назад
    </button>
  );
};

export const Layout: FC<ILayoutProps> = ({ children }) => {
  const { theme, toggle } = useTheme();
  const themeLabel = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link to="/" className={styles.brand} aria-label="Досье Заказчика — на главную">
            {/* Обе версии в разметке: подмена src при переключении темы даёт
                мигание, CSS-переключение — нет. */}
            <img className={styles.logoLight} src="/logo-light.svg" alt="Досье Заказчика" />
            <img className={styles.logoDark} src="/logo-dark.svg" alt="" aria-hidden="true" />
          </Link>

          <nav className={styles.nav} aria-label="Основная навигация">
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
          </nav>

          <button
            type="button"
            className={styles.themeButton}
            onClick={toggle}
            aria-label={themeLabel}
            title={themeLabel}
          >
            <Glyph d={theme === 'dark' ? SUN : MOON} className={styles.themeIcon} />
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <BackBar />
        {children}
      </main>

      {/* Нижняя панель — только на смартфоне: до неё дотягивается большой палец,
          а шапку на объекте держат одной рукой. */}
      <nav className={styles.tabbar} aria-label="Навигация">
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
            }
          >
            <Glyph d={item.icon} className={styles.tabIcon} />
            <span className={styles.tabLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
