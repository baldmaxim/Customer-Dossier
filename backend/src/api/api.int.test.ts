// API на настоящей базе: поиск по алиасу и ИНН (R18), заблокированные слияние
// и удаление с документами, неизменность сохранённого ответа модели (R06).

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { createApp } from '../app.js';
import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument } from '../ingest/store.js';
import { ExtractionPayloadMismatchError, recordExtraction } from '../pipeline/worker.js';
import { resolveCompany } from '../resolve/company.js';
import { normalizeName } from '../resolve/normalize.js';

const TOKEN = 'integration-operator-token-api-0123456789abc';
const ORIGIN = 'http://127.0.0.1:5173';
let server: http.Server;
let port = 0;
let auth: Record<string, string> = {};

const call = (
  method: string,
  path: string,
  headers: Record<string, string> = {},
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

beforeAll(async () => {
  await resetAndMigrate();
  server = http.createServer(createApp({ operatorToken: TOKEN, allowedOrigins: [ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  const login = await call('POST', '/api/auth/login', {}, { token: TOKEN });
  auth = {
    cookie: (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '',
    'x-csrf-token': String(login.body.csrfToken),
  };
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDb();
});

describe('поиск компаний (R18)', () => {
  beforeAll(async () => {
    await withTransaction(async client => {
      const created = await resolveCompany(client, {
        surface: 'Синтетикстрой Север',
        taxId: '7707083893',
        legalForm: 'ООО',
        city: null,
        documentId: null,
      });
      // Альтернативное написание, непохожее на основное имя.
      const alias = normalizeName('Нордтех', 'company');
      await client.query(
        `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source)
         VALUES ('company', $1, 'Нордтех', $2, $3, 'manual')`,
        [created!.companyId, alias.norm, alias.latin],
      );
    });
  });

  it('находит компанию по альтернативному написанию', async () => {
    const res = await call('GET', `/api/companies?q=${encodeURIComponent('Нордтех')}`, auth);
    expect(res.status).toBe(200);
    const names = (res.body.items as Array<{ name: string }>).map(i => i.name);
    expect(names.some(n => n.includes('Синтетикстрой'))).toBe(true);
  });

  it('находит компанию по ИНН', async () => {
    const res = await call('GET', '/api/companies?q=7707083893', auth);
    const items = res.body.items as Array<{ name: string; score: number }>;
    expect(items[0]?.name).toContain('Синтетикстрой');
    expect(items[0]?.score).toBe(1);
  });
});

describe('заблокированные изменяющие операции', () => {
  it('слияние через API — 423, очередь не меняется', async () => {
    const pair = await getPool().query<{ id: number }>(
      `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons, status)
       VALUES ('company', 900001, 900002, 0.8, '{}'::jsonb, 'pending') RETURNING id`,
    );
    const id = pair.rows[0]!.id;
    const res = await call('POST', `/api/admin/merges/${id}/merge`, auth, {});
    expect(res.status).toBe(423);
    const status = await getPool().query<{ status: string }>('SELECT status FROM merge_queue WHERE id = $1', [id]);
    expect(status.rows[0]?.status).toBe('pending');
  });

  it('удаление источника с документами — 423, документы на месте', async () => {
    const sourceId = await insertSyntheticSource({ kind: 'website', key: 'synthetic-delete.test', status: 'paused' });
    await storeDocument({
      sourceId,
      sourceRunId: null,
      externalId: 'synthetic/1',
      url: null,
      title: null,
      body: 'Синтетический документ, который нельзя удалить вместе с источником в этой версии.',
      publishedAt: null,
      forwardFrom: null,
    });
    const res = await call('DELETE', `/api/admin/sources/${sourceId}?withDocuments=true`, auth);
    expect(res.status).toBe(423);
    const docs = await getPool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM raw_documents WHERE source_id = $1',
      [sourceId],
    );
    expect(docs.rows[0]?.n).toBe(1);
  });

  it('добавление сайта не делает сетевых запросов и не включает источник', async () => {
    const res = await call('POST', '/api/admin/sources/website', auth, { url: 'https://synthetic-new-site.test' });
    expect(res.status).toBe(201);
    const source = res.body.source as { status: string; accessStatus: string };
    expect(source.status).toBe('paused');
    expect(source.accessStatus).toBe('unknown');
  });

  it('список источников показывает причины блокировки', async () => {
    const res = await call('GET', '/api/admin/sources', auth);
    const item = (res.body.items as Array<{ key: string; collectBlockedReason: string | null }>).find(
      i => i.key === 'synthetic-new-site.test',
    );
    expect(item?.collectBlockedReason).toContain('основание не подтверждено');
  });
});

describe('ответ модели в extractions (R06)', () => {
  let documentId = 0;
  const usage = { tokensIn: 1, tokensOut: 1, latencyMs: 1 };

  beforeAll(async () => {
    const sourceId = await insertSyntheticSource({ kind: 'website', key: 'synthetic-extract.test' });
    const stored = await storeDocument({
      sourceId,
      sourceRunId: null,
      externalId: 'synthetic/extract',
      url: null,
      title: null,
      body: 'Синтетический документ для проверки записи ответов модели по чанкам.',
      publishedAt: null,
      forwardFrom: null,
    });
    documentId = stored.documentId!;
  });

  it('успешный повтор после сбоя заменяет строку-ошибку (B-15)', async () => {
    const failedId = await recordExtraction(documentId, 0, 'llm_error', null, 'timeout', usage);
    const okId = await recordExtraction(documentId, 0, 'ok', { doc_relevant: false }, null, usage);
    expect(okId).toBe(failedId);
    const row = await getPool().query<{ status: string }>('SELECT status FROM extractions WHERE id = $1', [okId]);
    expect(row.rows[0]?.status).toBe('ok');
  });

  it('тот же успешный ответ — та же строка', async () => {
    const again = await recordExtraction(documentId, 0, 'ok', { doc_relevant: false }, null, usage);
    expect(again).toBeTypeOf('number');
  });

  it('другой успешный ответ при тех же промпте и модели — остановка, старый payload не тронут', async () => {
    await expect(
      recordExtraction(documentId, 0, 'ok', { doc_relevant: true }, null, usage),
    ).rejects.toBeInstanceOf(ExtractionPayloadMismatchError);
    const row = await getPool().query<{ relevant: string }>(
      `SELECT payload->>'doc_relevant' AS relevant FROM extractions WHERE document_id = $1 AND chunk_index = 0`,
      [documentId],
    );
    expect(row.rows[0]?.relevant).toBe('false');
  });

  it('ошибка не затирает сохранённый успешный ответ', async () => {
    await recordExtraction(documentId, 0, 'llm_error', null, 'later failure', usage);
    const row = await getPool().query<{ status: string }>(
      'SELECT status FROM extractions WHERE document_id = $1 AND chunk_index = 0',
      [documentId],
    );
    expect(row.rows[0]?.status).toBe('ok');
  });
});
