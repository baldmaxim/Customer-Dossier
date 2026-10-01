// HTTP-запросы к приложению в тестах API: настоящий сервер на случайном порту loopback, без сети наружу.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

export const makeRequest =
  (portOf: () => number, defaultHost: () => string) =>
  (method: string, path: string, options: { headers?: Record<string, string>; body?: unknown; raw?: string } = {}): Promise<IResponse> =>
    new Promise((resolve, reject) => {
      const payload = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
      const req = http.request(
        {
          host: '127.0.0.1',
          port: portOf(),
          method,
          path,
          headers: {
            host: defaultHost(),
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...options.headers,
          },
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            let body: Record<string, unknown> = {};
            try {
              body = data ? (JSON.parse(data) as Record<string, unknown>) : {};
            } catch {
              body = { raw: data };
            }
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
          });
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

export const listen = async (app: http.RequestListener): Promise<{ server: http.Server; port: number }> => {
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
};

export const close = (server: http.Server): Promise<void> =>
  new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
