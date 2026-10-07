// Карта маршрутов портала. Корень (провайдеры, вход, оболочка) — в App.tsx; здесь только
// страницы и постоянные редиректы. Админка — src/pages/admin/routes.tsx.

import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

import { adminRoutes } from './pages/admin/routes';
import { CompaniesPage } from './pages/CompaniesPage';
import { LinksRedirect } from './pages/LinksRedirect';

/**
 * Страница из своего чанка (07.10.2026): карточка компании, объект, «Новое» и публикация грузятся при первом
 * переходе, а не вместе с главной — основной чанк был 527 КБ. Главная — сразу: с неё портал открывают.
 */
const lazyPage =
  <M,>(load: () => Promise<M>, pick: (module: M) => ComponentType) =>
  async (): Promise<{ Component: ComponentType }> => ({ Component: pick(await load()) });

export const portalRoutes: RouteObject[] = [
  { path: '/', element: <CompaniesPage /> },
  { path: '/company/:id', lazy: lazyPage(() => import('./pages/CompanyPage'), m => m.CompanyPage) },
  { path: '/news', lazy: lazyPage(() => import('./pages/NewsPage'), m => m.NewsPage) },
  { path: '/documents/:id', lazy: lazyPage(() => import('./pages/DocumentPage'), m => m.DocumentPage) },
  { path: '/projects/:id', lazy: lazyPage(() => import('./pages/ProjectPage'), m => m.ProjectPage) },
  // «Подрядчики» были вторым видом того же каталога компаний — экран снят,
  // адрес ведёт на главную, где тот же список с теми же фильтрами.
  { path: '/contractors', element: <Navigate to="/" replace /> },
  // Экран «Связи» снят (06.10.2026): схема — окном с карточки компании или объекта.
  { path: '/links', element: <LinksRedirect /> },
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
