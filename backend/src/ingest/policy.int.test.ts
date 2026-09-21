// TC-008: неподтверждённый или отозванный источник блокируется одинаково
// на всех входах — шедулер/CLI, форвард-бот, ручная вставка, очередь модели,
// теневой прогон, повторная обработка. Сетевой клиент подменён: любой вызов
// сети в этих тестах — провал.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';

const networkCalls: string[] = [];
vi.mock('../net/safeFetch.js', async importOriginal => {
  const original = await importOriginal<typeof import('../net/safeFetch.js')>();
  return {
    ...original,
    safeFetch: vi.fn(async (url: string | URL) => {
      networkCalls.push(new URL(url).hostname);
      throw new original.NetworkPolicyError('network', 'сеть в тестах запрещена');
    }),
  };
});

import { createApp } from '../app.js';
import { closeDb, getPool } from '../db/pool.js';
import { claimBatch, requeueStale } from '../pipeline/worker.js';
import { runShadowExtraction } from '../pipeline/compare.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { ingestTelegramSource, runIngestPass } from './scheduler.js';
import { getSourceByKey, updateSourcePolicy } from './sources.js';
import { storeDocument } from './store.js';

const ORIGIN = 'http://127.0.0.1:5173';

const countRuns = async (): Promise<number> =>
  (await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM source_runs')).rows[0]?.n ?? 0;

beforeAll(async () => {
  await resetAndMigrate();
});

beforeEach(() => {
  networkCalls.length = 0;
});

afterAll(async () => {
  await closeDb();
});

describe('сбор: шедулер и CLI (--source использует ту же функцию)', () => {
  it('unknown-источник не опрашивается и не пишет запуск', async () => {
    await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_unknown', access: 'unknown' });
    const source = await getSourceByKey('telegram', 'synthetic_unknown');
    const runsBefore = await countRuns();

    const report = await ingestTelegramSource(source!);

    expect(report.ok).toBe(false);
    expect(report.error).toContain('основание не подтверждено');
    expect(await countRuns()).toBe(runsBefore);
    expect(networkCalls).toEqual([]);
  });

  it('revoked и истёкший источник блокируются в проходе шедулера', async () => {
    await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_revoked', access: 'revoked' });
    await insertSyntheticSource({
      kind: 'telegram',
      key: 'synthetic_expired',
      access: 'approved',
      ai: 'approved',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const reports = await runIngestPass(50);
    const byKey = new Map(reports.map(r => [r.sourceKey, r]));

    expect(byKey.get('synthetic_revoked')?.error).toContain('отозвано');
    expect(byKey.get('synthetic_expired')?.error).toContain('срок');
    expect(networkCalls).toEqual([]);
  });

  it('разрешённый синтетический источник доходит до сетевого клиента, остальные — нет', async () => {
    await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_approved', access: 'approved' });
    const reports = await runIngestPass(50);
    const approved = reports.find(r => r.sourceKey === 'synthetic_approved');
    // Сеть подменена и падает — важно, что запрос пытались сделать только для него.
    expect(approved?.error).toContain('запрос запрещён');
    expect(networkCalls).toEqual(['t.me']);
  });
});

describe('форвард-бот', () => {
  it('без допуска manual:bot не обращается к Telegram', async () => {
    vi.resetModules();
    vi.stubEnv('TG_BOT_TOKEN', '123456:synthetic-token-not-real');
    vi.stubEnv('TG_BOT_ALLOWED_USER_IDS', '1');
    const { pollBotUpdates } = await import('./telegramBot.js');
    const { SourcePolicyError } = await import('./policy.js');
    try {
      await expect(pollBotUpdates(0)).rejects.toBeInstanceOf(SourcePolicyError);
      expect(networkCalls).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      const pool = await import('../db/pool.js');
      await pool.closeDb();
    }
  });
});

describe('ручная вставка через API', () => {
  let server: http.Server;
  let port = 0;

  const call = (
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> =>
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
            origin: ORIGIN,
            ...(payload ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        },
        res => {
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data ? JSON.parse(data) : {} }),
          );
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  // Вход снят: заголовки Host и Origin подставляет сам call.
  const headers: Record<string, string> = {};

  beforeAll(async () => {
    server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const TEXT = 'Синтетический текст для проверки допуска ручной вставки, достаточно длинный для записи.';

  it('без допуска manual:form текст не сохраняется', async () => {
    const before = (await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM raw_documents')).rows[0]?.n;
    const res = await call('POST', '/api/manual', headers, { body: TEXT });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('source_policy');
    const after = (await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM raw_documents')).rows[0]?.n;
    expect(after).toBe(before);
  });

  it('неавторизованная правка допуска не меняет источник (TC-004)', async () => {
    const form = await getSourceByKey('manual', 'form');
    const res = await call('PATCH', `/api/admin/sources/${form!.id}/policy`, {}, {
      accessStatus: 'approved',
      aiProcessingStatus: 'approved',
      basis: 'x',
      owner: 'y',
    });
    expect(res.status).toBe(401);
    const again = await getSourceByKey('manual', 'form');
    expect(again!.accessStatus).toBe('unknown');
  });

  it('разрешение без основания отклоняется, с основанием — пишется в журнал', async () => {
    const form = await getSourceByKey('manual', 'form');

    const bad = await call('PATCH', `/api/admin/sources/${form!.id}/policy`, headers, {
      accessStatus: 'approved',
      aiProcessingStatus: 'unknown',
    });
    expect(bad.status).toBe(400);

    const ok = await call('PATCH', `/api/admin/sources/${form!.id}/policy`, headers, {
      accessStatus: 'approved',
      aiProcessingStatus: 'unknown',
      basis: 'синтетическое основание для теста',
      owner: 'test-operator',
    });
    expect(ok.status).toBe(200);
    const log = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM source_policy_log WHERE source_id = $1`,
      [form!.id],
    );
    expect(log.rows[0]?.n).toBe(1);

    const stored = await call('POST', '/api/manual', headers, { body: TEXT });
    expect(stored.status).toBe(201);
  });

  it('отзыв допуска снова блокирует вход', async () => {
    const form = await getSourceByKey('manual', 'form');
    await updateSourcePolicy(
      form!.id,
      { accessStatus: 'revoked', aiProcessingStatus: 'unknown', scope: null, basis: null, reference: null, owner: null, expiresAt: null },
      'test',
    );
    const res = await call('POST', '/api/manual', headers, { body: `${TEXT} Второй вариант.` });
    expect(res.status).toBe(403);
  });
});

describe('модель: очередь разбора и теневой прогон', () => {
  it('в очередь модели попадают только документы источников с допуском к ИИ', async () => {
    const noAi = await insertSyntheticSource({ kind: 'website', key: 'synthetic-no-ai.test', access: 'approved', ai: 'unknown' });
    const withAi = await insertSyntheticSource({ kind: 'website', key: 'synthetic-ai.test', access: 'approved', ai: 'approved' });

    for (const [sourceId, text] of [
      [noAi, 'Документ источника без допуска к ИИ-обработке: синтетический текст для очереди.'],
      [withAi, 'Документ источника с допуском к ИИ-обработке: синтетический текст для очереди.'],
    ] as const) {
      await storeDocument({
        sourceId,
        sourceRunId: null,
        externalId: null,
        url: null,
        title: null,
        body: text,
        publishedAt: new Date('2026-09-01T00:00:00Z'),
        forwardFrom: null,
      });
    }

    await requeueStale();
    const claimed = await claimBatch(50);
    const sources = await getPool().query<{ source_id: number }>(
      'SELECT source_id FROM raw_documents WHERE id = ANY($1::bigint[])',
      [claimed.map(d => d.id)],
    );
    expect(sources.rows.map(r => r.source_id)).toEqual([withAi]);
  });

  it('теневой прогон не берёт документы без допуска к ИИ', async () => {
    // Все документы источника без допуска — в выборку не попадают; с допуском
    // документ ещё не extracted — тоже не попадает. Модель не вызывается.
    await getPool().query(`UPDATE raw_documents SET status = 'extracted'`);
    await getPool().query(
      `UPDATE sources SET ai_processing_status = 'revoked' WHERE key = 'synthetic-ai.test'`,
    );
    const result = await runShadowExtraction(50, null);
    expect(result.processed).toBe(0);
  });
});
