// Оболочка админки: шапка раздела (один h1), строка состояния обработки и вкладки разделов.
//
// Разделы: Источники · Обработка · Проверка │ Модель · Пользователи │ Профиль. Раньше здесь
// было восемь вкладок, h1 «Админка» над каждым разделом, абзац про конвейер и второй h1
// внутри раздела — около 290px служебной шапки до первой строки дела на 1280.
//
// Профиль — вкладка админки, а не отдельная страница в шапке. Читателю админка недоступна:
// у него есть только профиль, без вкладок и строки состояния.
//
// Навигация называется «Разделы админки», а не «Навигация»: два одинаковых доступных имени
// в дереве сделали бы неоднозначным поиск навигации в e2e.

import { FC } from 'react';
import { matchPath, Navigate, Outlet, useLocation } from 'react-router-dom';

import { PageHeader } from '../../components/ui/PageHeader';
import { TabLinks } from '../../components/ui/TabLinks';
import { useAuth } from '../../hooks/useAuth';
import { PROFILE_PATH, sectionOf, visibleSections } from './adminSections';
import { AdminStatus } from './AdminStatus';
import styles from './AdminLayout.module.css';

export const AdminLayout: FC = () => {
  const { can } = useAuth();
  const { pathname } = useLocation();

  // Ссылку «Админка» читатель не видит, но адрес можно набрать руками: сервер ответил бы 403
  // на каждый запрос. Ему здесь доступен только свой профиль.
  if (!can('admin.view')) {
    if (!pathname.startsWith(PROFILE_PATH)) return <Navigate to={PROFILE_PATH} replace />;
    return (
      <div className={styles.admin}>
        <PageHeader title="Профиль" />
        <Outlet />
      </div>
    );
  }

  const section = sectionOf(pathname);
  // Без раздела — старый адрес (/admin, /admin/collect, /admin/result): дочерний маршрут
  // перенаправит, шапку рисовать незачем. Разбор и пользователь — детальные страницы со своим
  // заголовком и возвратом (BackBar): вкладки разделов над ними стали бы третьим уровнем навигации.
  if (!section || matchPath('/admin/process/:id', pathname) || matchPath('/admin/users/:id', pathname)) return <Outlet />;

  return (
    <div className={styles.admin}>
      <PageHeader eyebrow="Админка" title={section.label} actions={<AdminStatus />}>
        <TabLinks label="Разделы админки" items={visibleSections(can).map(s => ({ to: s.to, label: s.label, group: s.group }))} />
      </PageHeader>
      <Outlet />
    </div>
  );
};
