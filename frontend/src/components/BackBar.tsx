// Возврат — только на детальных страницах: карточка компании, объект, публикация, разбор, пользователь, ДОМ.РФ.
// На разделах верхнего уровня (поиск, связи, админка) он дублировал меню.
//
// Есть история — шаг назад (туда, откуда пришли: поиск с тем же запросом, прежняя вкладка).
// Нет истории (прямая ссылка, перезагрузка) — к родительскому списку, а не на главную:
// с разбора — в «Обработку», с публикации — в ленту публикаций.
//
// Страница может спрятать возврат (пост открыт вместо списка на телефоне и свой «К списку»
// рядом): data-hide-backbar на любом элементе внутри main — Layout.module.css.

import { FC } from 'react';
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';

import { Icon } from './ui/Icon';
import styles from './Layout.module.css';

interface IDetailRoute {
  pattern: string;
  parent: string;
  /** Подпись без истории: куда именно вернёт ссылка. */
  parentLabel: string;
}

export const DETAIL_ROUTES: ReadonlyArray<IDetailRoute> = [
  { pattern: '/company/:id', parent: '/', parentLabel: 'К компаниям' },
  { pattern: '/projects/:id', parent: '/', parentLabel: 'К компаниям' },
  // Общей ленты нет (ADR-016): без истории публикация возвращает к компаниям.
  { pattern: '/documents/:id', parent: '/', parentLabel: 'К компаниям' },
  { pattern: '/admin/process/:id', parent: '/admin/process', parentLabel: 'К разборам' },
  { pattern: '/admin/users/:id', parent: '/admin/users', parentLabel: 'К пользователям' },
  { pattern: '/admin/sources/domrf', parent: '/admin/sources?tab=website', parentLabel: 'К сайтам' },
  { pattern: '/admin/sources/focus', parent: '/admin/sources?tab=website', parentLabel: 'К сайтам' },
  { pattern: '/admin/sources/parser-api', parent: '/admin/sources?tab=website', parentLabel: 'К сайтам' },
];

export const BackBar: FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const route = DETAIL_ROUTES.find(r => matchPath(r.pattern, location.pathname));
  if (!route) return null;

  // key === 'default' — первая запись истории: возвращаться некуда.
  const hasHistory = location.key !== 'default';

  return (
    <div className={styles.backbar}>
      {hasHistory ? (
        <button type="button" className={styles.back} onClick={() => navigate(-1)}>
          <Icon name="back" size="md" />
          Назад
        </button>
      ) : (
        <Link to={route.parent} viewTransition className={styles.back}>
          <Icon name="back" size="md" />
          {route.parentLabel}
        </Link>
      )}
    </div>
  );
};
