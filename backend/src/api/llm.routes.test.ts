// Вкладка «Модель»: ключ OpenRouter из админки. Отказы — до базы (мёртвый адрес): неверный формат
// и ключ, который OpenRouter не принял, не записываются; ключ не возвращается ни в каком ответе.
// Права маршрутов (llm.manage — только администратор) проверяет auth/routePolicy.test.ts.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';

const ORIGIN = 'http://127.0.0.1:5173';
const SECRET = 'sk-or-v1-rejected-key-0001';

let server: http.Server;
let port = 0;

const put = (path: string, body: unknown): Promise<{ status: number; text: string; body: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'PUT',
        path,
        headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, 'content-type': 'application/json' },
      },
      res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, body: JSON.parse(text || '{}') as Record<string, unknown> }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

beforeAll(async () => {
  server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(
  () =>
    new Promise<void>(resolve => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);

afterEach(() => vi.unstubAllGlobals());

describe('ключ OpenRouter в админке', () => {
  it('не одна строка — 400 без запроса к OpenRouter', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    });
    for (const key of ['sk-or v1 with spaces', 'short', '']) {
      const res = await put('/api/admin/llm/key', { key });
      expect(res.status, key).toBe(400);
      expect(res.body.code).toBe('invalid_key');
    }
    expect((await put('/api/admin/llm/key', { key: SECRET, extra: 1 })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('OpenRouter не принял ключ — 422, ключ не сохранён и в ответ не попал', async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ error: { message: 'User not found.', code: 401 } }), { status: 401 });
    });
    const res = await put('/api/admin/llm/key', { key: ` ${SECRET} ` });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('key_rejected');
    expect(res.text).not.toContain(SECRET);
    // Провайдер в unit-окружении — LM Studio: ключ проверяется у самого OpenRouter, а не по адресу модели.
    expect(calls).toEqual([{ url: 'https://openrouter.ai/api/v1/key', auth: `Bearer ${SECRET}` }]);
  });
});
