// HTTP-клиент. Base URL из VITE_API_URL; в dev пусто — работает vite-прокси.
//
// Вход по токену снят на время разработки: заголовков авторизации нет. API
// слушает только loopback и проверяет Host и Origin — этим защита и исчерпана.

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    /** Тело ответа об ошибке: конфликты слияния, план компенсации. */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });

  if (!response.ok) {
    // Тело ошибки может быть не-JSON (прокси, nginx) — не роняем на парсинге.
    const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(body?.error ?? `Ошибка ${response.status}`, response.status, body?.code ?? null, body);
  }

  return (await response.json()) as T;
};

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
