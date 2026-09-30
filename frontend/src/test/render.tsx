import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { vi } from 'vitest';

import { ConfirmProvider } from '../components/ui/ConfirmProvider';
import { ToastProvider } from '../components/ui/ToastProvider';

export interface IFakeRoute {
  /** Метод и начало пути: 'GET /api/reprocess/runs'. */
  match: string;
  respond: (url: string, init: RequestInit | undefined) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
}

export interface IFakeApi {
  calls: Array<{ method: string; url: string; body: unknown }>;
}

/** Подменённый fetch: синтетические ответы по маршрутам; неизвестный маршрут — 599, чтобы тест не прошёл молча. */
export const fakeApi = (routes: IFakeRoute[]): IFakeApi => {
  const api: IFakeApi = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = String(input);
      api.calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const route = routes.find(r => {
        const [m, path] = r.match.split(' ');
        return m === method && url.startsWith(path!);
      });
      const { status, body } = route ? await route.respond(url, init) : { status: 599, body: { error: `нет маршрута ${method} ${url}` } };
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return api;
};

/** Сеть недоступна: fetch отвергается TypeError, как в браузере. */
export const offlineApi = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
};

const testClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Тосты и подтверждения — как в корне приложения (AppRoot): useToast/useConfirm работают. */
const UiProviders = ({ children }: { children: ReactNode }): ReactElement => (
  <ToastProvider>
    <ConfirmProvider>{children}</ConfirmProvider>
  </ToastProvider>
);

export const renderWithProviders = (ui: ReactElement, route = '/'): RenderResult & { client: QueryClient } => {
  const client = testClient();
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <UiProviders>{ui}</UiProviders>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
};

/**
 * Data-роутер в памяти — как createBrowserRouter в App.tsx: история (PUSH/REPLACE), редиректы,
 * ScrollRestoration. router.state.location — куда пришли; router.navigate — переход из теста.
 */
export const renderWithRouter = (
  routes: RouteObject[],
  initialEntries: string[] = ['/'],
): RenderResult & { client: QueryClient; router: ReturnType<typeof createMemoryRouter> } => {
  const client = testClient();
  const router = createMemoryRouter(routes, { initialEntries });
  const result = render(
    <QueryClientProvider client={client}>
      <UiProviders>
        <RouterProvider router={router} />
      </UiProviders>
    </QueryClientProvider>,
  );
  return { ...result, client, router };
};
