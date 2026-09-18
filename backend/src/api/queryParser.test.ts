// ACC-04: строка запроса API разбирается node:querystring ('simple'), а не qs; вложенные ключи и повторённые ключи — 400
// до авторизации и маршрутов. База (мёртвый адрес) не нужна.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';

const TOKEN = 'operator-token-for-unit-tests-0123456789';

let server: http.Server;
let port = 0;

const get = (path: string): Promise<{ status: number; body: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}` } }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let body: Record<string, unknown> = {};
        try {
          body = data ? (JSON.parse(data) as Record<string, unknown>) : {};
        } catch {
          body = { raw: data };
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });

const app = createApp({ operatorToken: TOKEN });

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('разбор строки запроса (ACC-04)', () => {
  it('включён простой разбор node:querystring, а не qs', () => {
    expect(app.get('query parser')).toBe('simple');
  });

  it('вложенный параметр — 400 invalid_query до авторизации', async () => {
    for (const path of ['/api/companies?q[x]=ab', '/api/companies?a[b]=1', '/api/reprocess/runs?status[]=failed', '/api/health?x]=1']) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.code, path).toBe('invalid_query');
    }
  });

  it('повторённый ключ — 400 invalid_query до авторизации', async () => {
    for (const path of ['/api/companies?q=ab&q=cd', '/api/entities/ambiguities?status=open&status=resolved']) {
      const res = await get(path);
      expect(res.status, path).toBe(400);
      expect(res.body.code, path).toBe('invalid_query');
    }
  });

  it('плоские параметры проходят дальше: без сессии — 401, а не 400', async () => {
    for (const path of ['/api/companies?q=ab', '/api/reprocess/runs?status=failed&limit=10', '/api/companies?q=a%5Bb%5D']) {
      const res = await get(path);
      expect(res.status, path).toBe(401);
    }
  });
});
