// Возврат — только на детальных страницах: карточка компании, объект, публикация, разбор.
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
  { pattern: '/company/:id', parent: '/', parentLabel: 'К поиску' },
  { pattern: '/projects/:id', parent: '/', parentLabel: 'К поиску' },
  { pattern: '/documents/:id', parent: '/?view=publications', parentLabel: 'К публикациям' },
  { pattern: '/admin/process/:id', parent: '/admin/process', parentLabel: 'К разборам' },
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
