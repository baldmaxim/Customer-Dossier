// HTTP-клиент интеграционных тестов: поднимает приложение на случайном порту
// и выполняет вход оператора. Токен синтетический.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApp } from '../../app.js';

export const TEST_ORIGIN = 'http://127.0.0.1:5173';

export interface ITestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export interface ITestApi {
  call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<ITestResponse>;
  /** Заголовки вошедшего оператора: cookie и CSRF. */
  auth: Record<string, string>;
  close: () => Promise<void>;
}

export const startTestApi = async (token = 'integration-operator-token-http-0123456789'): Promise<ITestApi> => {
  const server = http.createServer(createApp({ operatorToken: token, allowedOrigins: [TEST_ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const call: ITestApi['call'] = (method, path, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path,
          headers: {
            host: `127.0.0.1:${port}`,
            origin: TEST_ORIGIN,
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = data ? (JSON.parse(data) as Record<string, unknown>) : {};
            } catch {
              parsed = { raw: data };
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: parsed });
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  const login = await call('POST', '/api/auth/login', { token });
  const auth = {
    cookie: (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '',
    'x-csrf-token': String(login.body.csrfToken),
  };

  return {
    call: (method, path, body, headers = {}) => call(method, path, body, { ...auth, ...headers }),
    auth,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
};
