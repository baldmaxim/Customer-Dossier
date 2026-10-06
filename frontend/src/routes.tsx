// Карта маршрутов портала. Корень (провайдеры, вход, оболочка) — в App.tsx; здесь только
// страницы и постоянные редиректы. Админка — src/pages/admin/routes.tsx.

import { Navigate, type RouteObject } from 'react-router-dom';

import { adminRoutes } from './pages/admin/routes';
import { CompaniesPage } from './pages/CompaniesPage';
import { CompanyPage } from './pages/CompanyPage';
import { DocumentPage } from './pages/DocumentPage';
import { LinksPage } from './pages/LinksPage';
import { NewsPage } from './pages/NewsPage';
import { ProjectPage } from './pages/ProjectPage';

export const portalRoutes: RouteObject[] = [
  { path: '/', element: <CompaniesPage /> },
  { path: '/company/:id', element: <CompanyPage /> },
  { path: '/news', element: <NewsPage /> },
  { path: '/links', element: <LinksPage /> },
  { path: '/documents/:id', element: <DocumentPage /> },
  { path: '/projects/:id', element: <ProjectPage /> },
  // «Подрядчики» были вторым видом того же каталога компаний — экран снят,
  // адрес ведёт на главную, где тот же список с теми же фильтрами.
  { path: '/contractors', element: <Navigate to="/" replace /> },
  // Обращения и снимки сняты с портала: данные в базе целы, экранов нет.
  // Редиректы постоянные — по старым ссылкам из закладок и отчётов.
  { path: '/cases/*', element: <Navigate to="/" replace /> },
  { path: '/snapshots/*', element: <Navigate to="/" replace /> },
];

/** Все страницы под оболочкой: портал, админка и «всё остальное — на главную». */
export const appRoutes: RouteObject[] = [
  ...portalRoutes,
  ...adminRoutes,
  { path: '*', element: <Navigate to="/" replace /> },
];
