// Маршруты админки — отдельно от портала, чтобы разделы админки перестраивались здесь,
// не трогая App.tsx. Вложенный роут один, и только здесь: шапка разделов рисуется один раз.
// Экраны грузятся лениво (adminPages.ts — отдельный чанк); редиректы — сразу, они крошечные.
//
// Разделы: Источники · Обработка · Проверка │ Модель · Пользователи │ Профиль. Прежние
// адреса («Конвейер» /admin, «Сбор» /admin/collect, «Результат» /admin/result) остались
// постоянными редиректами — по ссылкам из закладок и отчётов.

import type { ComponentType } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';

import { KeepQueryRedirect } from './KeepQueryRedirect';
import { RunsRedirect } from './RunsRedirect';

type AdminPages = typeof import('./adminPages');

/** Экран админки из ленивого чанка: код грузится при первом заходе в админку. */
const lazyPage =
  (pick: (pages: AdminPages) => ComponentType) =>
  async (): Promise<{ Component: ComponentType }> => ({ Component: pick(await import('./adminPages')) });

export const adminRoutes: RouteObject[] = [
  // Редиректы — отдельными маршрутами до ленивой оболочки: срабатывают сразу, не дожидаясь чанка.
  // «/admin» стоит раньше оболочки с тем же адресом — при равном ранге выигрывает первый.
  { path: '/admin', element: <Navigate to="/admin/sources" replace /> },
  // «Сбор» стал «Источниками»: вкладка (?tab=) переезжает вместе с адресом.
  { path: '/admin/collect', element: <KeepQueryRedirect to="/admin/sources" /> },
  // «Результат» разошёлся по разделам: журнал — в «Обработку», дубли и упоминания — в «Проверку».
  { path: '/admin/result', element: <Navigate to="/admin/review?tab=duplicates" replace /> },
  {
    path: '/admin',
    lazy: lazyPage(pages => pages.AdminLayout),
    children: [
      { path: 'sources', lazy: lazyPage(pages => pages.SourcesPage) },
      { path: 'sources/domrf', lazy: lazyPage(pages => pages.DomRfPage) },
      { path: 'sources/focus', lazy: lazyPage(pages => pages.FocusPage) },
      { path: 'sources/parser-api', lazy: lazyPage(pages => pages.ParserApiPage) },
      { path: 'process', lazy: lazyPage(pages => pages.RunsPage) },
      { path: 'process/:id', lazy: lazyPage(pages => pages.RunPage) },
      { path: 'review', lazy: lazyPage(pages => pages.ReviewQueuePage) },
      { path: 'model', lazy: lazyPage(pages => pages.ModelPage) },
      { path: 'users', lazy: lazyPage(pages => pages.UsersPage) },
      { path: 'users/:id', lazy: lazyPage(pages => pages.UserPage) },
      { path: 'account', lazy: lazyPage(pages => pages.AccountPage) },
    ],
  },
  // Профиль — вкладка админки; старая ссылка ведёт туда же.
  { path: '/account', element: <Navigate to="/admin/account" replace /> },
  // Постоянные редиректы: по старым ссылкам из закладок и отчётов.
  { path: '/runs', element: <Navigate to="/admin/process" replace /> },
  { path: '/runs/:id', element: <RunsRedirect /> },
  { path: '/review', element: <Navigate to="/admin/review" replace /> },
];
