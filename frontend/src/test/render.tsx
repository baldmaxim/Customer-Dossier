import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

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

export const renderWithProviders = (ui: ReactElement, route = '/'): RenderResult & { client: QueryClient } => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
};
