// Карточка компании на настоящей базе (этап 22): лента публикаций, контрагенты и
// состояние обработки на экране админки.
//
// Эти три запроса ходят по представлениям (`published_assertions_v`,
// `co_participations_v`) и по колонкам, которых нет в unit-профиле, — без живого
// PostgreSQL опечатка в имени столбца не ловится ничем.
//
// Данные готовятся тем же путём, что и в рабочем портале: источник → публикация →
// запуск с подставным провайдером → публикация набора. Никаких INSERT'ов в канон руками.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { createApp } from '../app.js';
import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument } from '../ingest/store.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import * as fx from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { INN_A } from '../reprocess/__fixtures__/extraction.js';

const ORIGIN = 'http://127.0.0.1:5173';
let server: http.Server;
let port = 0;

const call = (path: string): Promise<{ status: number; body: Record<string, unknown> }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
      },
    );
    req.on('error', reject);
    req.end();
  });

let sourceId = 0;
let seq = 0;

/** Один текст источника, разобранный и опубликованный: ровно как в рабочем потоке. */
const ingest = async (body: string, answer: ReturnType<typeof fx.answer>): Promise<void> => {
  seq += 1;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: `card_demo/${seq}`,
    url: `https://t.me/s/card_demo/${seq}`,
    title: null,
    body,
    publishedAt: new Date('2026-09-18T07:00:00Z'),
    forwardFrom: null,
  });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = fx.semanticProvider(() => answer);
  const queued = await enqueueRun(getPool(), {
    revisionId: stored.revisionId,
    provider,
    chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 },
    requestedBy: 'test',
  });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const claim = await claimNextRun('card-int-test', { runId: queued.runId });
  const run = await processRun(provider, claim!);
  if (run.candidateSetId === null) throw new Error(`набор не собран: ${run.status} ${run.error ?? ''}`);
  await publishCandidateSet({ setId: run.candidateSetId, expectedVersion: 0, actor: 'test' });
};

const GC = `ООО «Картастрой» (ИНН ${INN_A}) выбрано генподрядчиком ЖК «Картадемо».`;
const SUB = 'Субподрядчиком на ЖК «Картадемо» выступает «Картасервис».';

let companyId = 0;
let partnerId = 0;

beforeAll(async () => {
  await resetAndMigrate();
  server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  sourceId = await insertSyntheticSource({
    kind: 'telegram',
    key: 'card_demo',
    status: 'paused',
    access: 'approved',
    ai: 'approved',
  });

  await ingest(`Новости стройки. ${GC}`, fx.answer({
    companies: [fx.company('Картастрой', GC, { legal_form: 'ООО', tax_id: INN_A })],
    projects: [fx.project('Картадемо', GC)],
    relations: [
      fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Картастрой', project: 'Картадемо', quote: GC }),
    ],
  }));

  await ingest(`Новости стройки. ${SUB}`, fx.answer({
    companies: [fx.company('Картасервис', SUB)],
    projects: [fx.project('Картадемо', SUB)],
    relations: [
      fx.relation({ type: 'participation', kind: 'subcontractor', subject: 'Картасервис', project: 'Картадемо', quote: SUB }),
    ],
  }));

  const rows = await getPool().query<{ id: number; name: string }>(
    `SELECT id, name FROM companies WHERE merged_into_id IS NULL ORDER BY id`,
  );
  companyId = rows.rows.find(r => r.name.includes('Картастрой'))!.id;
  partnerId = rows.rows.find(r => r.name.includes('Картасервис'))!.id;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDb();
});

describe('лента публикаций компании', () => {
  it('отдаёт публикацию с утверждением и дословной цитатой', async () => {
    const res = await call(`/api/companies/${companyId}/publications?limit=10`);
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{
      itemId: number;
      sourceTitle: string;
      publishedAt: string | null;
      facts: Array<{ predicate: string; role: string | null; projectName: string | null; quote: string | null }>;
    }>;
    expect(items.length).toBe(1);

    const fact = items[0]!.facts.find(f => f.predicate === 'participates_in_project');
    expect(fact?.role).toBe('general_contractor');
    expect(fact?.projectName).toContain('Картадемо');
    // Цитата — из текста источника, а не пересказ.
    expect(fact?.quote).toContain('генподрядчиком');
    expect(items[0]!.publishedAt).not.toBeNull();
  });

  it('чужая публикация в ленту не попадает', async () => {
    const res = await call(`/api/companies/${partnerId}/publications?limit=10`);
    const items = res.body.items as Array<{ facts: Array<{ role: string | null }> }>;
    expect(items.length).toBe(1);
    expect(items[0]!.facts.some(f => f.role === 'subcontractor')).toBe(true);
  });
});

describe('контрагенты компании', () => {
  it('совместное участие видно и названо своим основанием, а не договором', async () => {
    const res = await call(`/api/companies/${companyId}/partners`);
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{ companyId: number; name: string; links: Array<{ kind: string; role: string | null; ownRole: string | null; projectName: string | null }> }>;
    const partner = items.find(i => i.companyId === partnerId);
    expect(partner?.name).toContain('Картасервис');

    const link = partner!.links[0]!;
    // Обе компании на одном объекте — это не договор между ними (ADR-008).
    expect(link.kind).toBe('co_participation');
    expect(link.role).toBe('subcontractor');
    expect(link.ownRole).toBe('general_contractor');
    expect(link.projectName).toContain('Картадемо');
    expect(items.every(i => i.links.every(l => l.kind !== 'contract'))).toBe(true);
  });

  it('сама компания в свои контрагенты не попадает', async () => {
    const res = await call(`/api/companies/${companyId}/partners`);
    const items = res.body.items as Array<{ companyId: number }>;
    expect(items.some(i => i.companyId === companyId)).toBe(false);
  });
});

describe('состояние обработки на экране админки', () => {
  it('считает последние редакции, а не колонку старого конвейера', async () => {
    const res = await call('/api/admin/pipeline');
    expect(res.status).toBe(200);

    const revisions = res.body.revisions as Array<{ state: string; n: number }>;
    const published = revisions.find(r => r.state === 'published');
    // Обе публикации разобраны и попали в карточки.
    expect(published?.n).toBe(2);
    expect(revisions.some(r => r.state === 'unknown')).toBe(false);
    expect(Array.isArray(res.body.failures)).toBe(true);
    expect((res.body.model as { ok: boolean }).ok).toBeDefined();
  });
});
