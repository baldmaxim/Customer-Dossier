// Секреты (закрытие приёмки 09): проверяется отсутствие ЗНАЧЕНИЙ вымышленных секретов-маркеров в логах,
// ответах HTTP, ошибках разбора окружения и тестовой цели, manifest и выгрузках. Отсутствие слов
// token/password — вспомогательный признак, а не доказательство; здесь ищутся сами значения.
// Настоящие секреты не используются. Бандл фронтенда проверяет `npm run check:build` (frontend).

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { parseEnv } from '../config/env.js';
import { prepareTestTargetProcess } from '../db/testTargetBootstrap.js';
import { pickConfig } from './manifest.js';

const M = {
  operator: 'MARKER-operator-token-5f1c2a9e7b3d4c6a',
  wrongToken: 'MARKER-wrong-token-9a8b7c6d5e4f3a2b1c',
  dbPassword: 'MARKERdbpw7731',
  bot: '123456789:MARKER-bot-token-AAAAAAAAAAAAAAAAAAAAAAA',
};
const ALL = Object.values(M);
const ORIGIN = 'http://127.0.0.1:5173';

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(a => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

const expectNoMarkers = (text: string): void => {
  for (const marker of ALL) expect(text).not.toContain(marker);
};

describe('HTTP: ошибки разбора и отказ базы не раскрывают секреты', () => {
  let server: http.Server;
  let port = 0;
  const request = (method: string, path: string, raw?: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN, 'content-type': 'application/json', ...headers } }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: data }));
      });
      req.on('error', reject);
      if (raw !== undefined) req.write(raw);
      req.end();
    });

  beforeAll(async () => {
    server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  // Вход снят, но тело запроса по-прежнему может нести секрет: битый JSON не должен вернуться эхом.
  it('битый JSON с секретом в теле и запрос с отказом базы', async () => {
    const broken = await request('POST', '/api/manual', `{"body": "${M.operator}", `);
    expect(broken.status).toBe(400);
    const rejected = await request('GET', '/api/companies?q=ab', undefined, { origin: 'http://evil.example' });
    expect(rejected.status).toBe(403);
    const failing = await request('GET', '/api/cases/1/dossier');
    expect(failing.status).toBeGreaterThanOrEqual(500);

    for (const r of [broken, rejected, failing]) {
      expectNoMarkers(r.text);
      expectNoMarkers(JSON.stringify(r.headers));
    }
    expectNoMarkers(logged.join('\n'));
  }, 30_000);
});

describe('окружение, тестовая цель и manifest', () => {
  it('ошибки разбора окружения не содержат значений', () => {
    const attempts: Array<Record<string, string>> = [
      { DATABASE_URL: `postgresql://u:${M.dbPassword}@127.0.0.1:5432/x`, DATABASE_POOL_MAX: M.operator },
      { DATABASE_URL: `postgresql://u:${M.dbPassword}@127.0.0.1:5432/x`, INGEST_ENABLED: M.operator },
      { DATABASE_URL: `postgresql://u:${M.dbPassword}@127.0.0.1:5432/x`, LMSTUDIO_BASE_URL: `http://u:${M.dbPassword}@10.0.0.1:1234/v1` },
      { DATABASE_URL: `postgresql://u:${M.dbPassword}@127.0.0.1:5432/x`, TG_BOT_TOKEN: M.bot, PORT: M.bot },
    ];
    let failures = 0;
    for (const source of attempts) {
      try {
        parseEnv(source);
      } catch (err) {
        failures += 1;
        expectNoMarkers((err as Error).message);
      }
    }
    expect(failures).toBeGreaterThan(0);
    expectNoMarkers(logged.join('\n'));
  });

  it('отказ тестовой цели не содержит пароль ни в тексте, ни в логе', () => {
    const env: NodeJS.ProcessEnv = { TEST_DATABASE_URL: `postgresql://u:${M.dbPassword}@db.example:5432/tg_info_test` };
    expect(() => prepareTestTargetProcess(env, `postgresql://u:${M.dbPassword}@127.0.0.1:5432/tg_info`)).toThrow();
    try {
      prepareTestTargetProcess(env, undefined);
    } catch (err) {
      expectNoMarkers((err as Error).message);
    }
    expectNoMarkers(logged.join('\n'));
  });

  it('параметры manifest: только разрешённые не-секретные ключи', () => {
    const json = JSON.stringify(
      pickConfig({ DATABASE_URL: `postgresql://u:${M.dbPassword}@h/db`, OPERATOR_TOKEN: M.operator, TG_BOT_TOKEN: M.bot, INGEST_ENABLED: false, HOST: '127.0.0.1' }),
    );
    expectNoMarkers(json);
    expect(json).toContain('INGEST_ENABLED');
  });
});
