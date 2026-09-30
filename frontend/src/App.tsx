import { FC } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import { AppRoot } from './components/AppRoot';
import { RouteError } from './components/RouteError';
import { Loading } from './components/ui/Loading';
import { appRoutes } from './routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Данные обновляются раз в 10 минут пересчётом метрик — рефетч на каждый
      // фокус окна только дёргает БД без пользы.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Data-роутер, а не <BrowserRouter>: только он умеет viewTransition у ссылок (View Transitions
// между страницами) и ScrollRestoration. Ошибка отрисовки страницы остаётся внутри оболочки
// (меню на месте); ошибка самой оболочки — на весь экран.
const router = createBrowserRouter([
  {
    element: <AppRoot />,
    errorElement: <RouteError fullPage />,
    children: [
      {
        errorElement: <RouteError />,
        // Первый заход прямо в админку: её чанк грузится лениво, а шапка и меню уже на месте.
        hydrateFallbackElement: <Loading variant="page" label="Открываю раздел…" />,
        children: appRoutes,
      },
    ],
  },
]);

export const App: FC = () => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
