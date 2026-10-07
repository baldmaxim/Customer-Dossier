// Карточка компании на настоящей базе (этап 22): лента публикаций, контрагенты,
// состояние обработки на экране админки и «кто строит для компании» (24D).
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
import { invalidateReadCaches } from '../utils/readCaches.js';
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
const CUSTOMER = 'Заказчиком ЖК «Картадемо» выступает «Картазаказ».';

let companyId = 0;
let partnerId = 0;
let customerId = 0;

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
  it('совместное участие не создаёт контрагента без прямого основания', async () => {
    const res = await call(`/api/companies/${companyId}/partners`);
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{ companyId: number; name: string; links: Array<{ kind: string; role: string | null; ownRole: string | null; projectName: string | null }> }>;
    expect(items.find(i => i.companyId === partnerId)).toBeUndefined();
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

describe('объекты компании из событий', () => {
  it('показывает объект события без утверждения об участии и без роли', async () => {
    const body = 'Капиталдемо завершила строительство ЖК «Бадаевский-Демо».';
    await ingest(body, fx.answer({
      companies: [fx.company('Капиталдемо', body)],
      projects: [fx.project('Бадаевский-Демо', body)],
      events: [fx.event({ type: 'construction_start', subject: 'Капиталдемо', project: 'Бадаевский-Демо', quote: body })],
    }));
    const company = await getPool().query<{ id: number }>(`SELECT id FROM companies WHERE name = 'Капиталдемо'`);
    const id = company.rows[0]!.id;
    const events = await call(`/api/companies/${id}/events`);
    expect((events.body.items as Array<{ projectName: string; sourceTitle: string; sourceKey: string }>).some(e =>
      e.projectName === 'Бадаевский-Демо' && e.sourceTitle === 'card_demo' && e.sourceKey === 'card_demo')).toBe(true);
    // Общее число — отдельно от списка (список урезан до 100); служебный столбец total в строки не попадает.
    expect(events.body).toMatchObject({ total: (events.body.items as unknown[]).length, truncated: false });
    expect((events.body.items as unknown[])[0]).not.toHaveProperty('total');

    const projects = await call(`/api/companies/${id}/projects`);
    expect(projects.status).toBe(200);
    const rows = projects.body.items as Array<{ id: number; name: string; role: string | null; basis: string }>;
    expect(rows.filter(p => p.name === 'Бадаевский-Демо')).toEqual([
      expect.objectContaining({ role: null, basis: 'event' }),
    ]);
    const project = rows.find(p => p.name === 'Бадаевский-Демо')!;
    const dossier = await call(`/api/projects/${project.id}/dossier`);
    const eventStatements = dossier.body.events as Array<{ quotes: Array<{ sourceTitle: string; sourceKey: string; revisionId: number; observedAt: string }> }>;
    expect(eventStatements[0]?.quotes[0]).toMatchObject({ sourceTitle: 'card_demo', sourceKey: 'card_demo', revisionId: expect.any(Number), observedAt: expect.any(String) });
  });
});

// Каталог от юрлица (ADR-016, этап 23B): юрлицо с ИНН — в «Юрлицах» со своими числами, имя без реквизита —
// в «Без ИНН», группа — в «Группах»; «на контроле» поднимает компанию наверх и даёт фильтр.
describe('каталог компаний от юрлица', () => {
  type Row = { companyId: number; name: string; inn: string | null; objects: number; publications: number; roles: string[]; watched: boolean };

  it('виды: юрлица, «Без ИНН», группы; числа — из тех же источников, что карточка', async () => {
    const group = (await getPool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ('Картагруппа', 'картагруппа', 'kartagruppa', 'group') RETURNING id`,
    )).rows[0]!.id;

    const legal = await call('/api/catalog/companies');
    expect(legal.status).toBe(200);
    const legalRows = legal.body.items as Row[];
    expect(legalRows.find(r => r.companyId === companyId)).toMatchObject({ inn: INN_A, objects: 1, publications: 1, roles: ['general_contractor'] });
    expect(legalRows.some(r => r.companyId === partnerId)).toBe(false);

    const unidentified = await call('/api/catalog/companies?view=unidentified');
    expect((unidentified.body.items as Row[]).find(r => r.companyId === partnerId)).toMatchObject({ inn: null, publications: 1 });

    const groups = await call('/api/catalog/companies?view=groups');
    expect((groups.body.items as Row[]).map(r => r.companyId)).toContain(group);

    const counts = legal.body.counts as Record<string, number>;
    expect(counts.legal).toBeGreaterThanOrEqual(1);
    expect(counts.unidentified).toBeGreaterThanOrEqual(1);
    expect(counts.groups).toBeGreaterThanOrEqual(1);
  });

  it('«на контроле»: имя без ИНН переходит в юрлица, фильтр оставляет только отмеченные', async () => {
    await getPool().query(`INSERT INTO company_watch (company_id, added_by) VALUES ($1, 'test')`, [partnerId]);
    // Запись мимо API: кэши чтения сбрасываются явно (через API их сбрасывает app.ts).
    invalidateReadCaches();
    const watched = await call('/api/catalog/companies?watch=1');
    expect((watched.body.items as Row[]).map(r => r.companyId)).toEqual([partnerId]);
    const all = await call('/api/catalog/companies');
    expect((all.body.items as Row[])[0]).toMatchObject({ companyId: partnerId, watched: true });
    await getPool().query(`UPDATE company_watch SET removed_at = now(), removed_by = 'test' WHERE company_id = $1`, [partnerId]);
    invalidateReadCaches();
  });

  it('фильтр роли и неверный вид', async () => {
    const gc = await call('/api/catalog/companies?role=general_contractor');
    expect((gc.body.items as Row[]).map(r => r.companyId)).toEqual([companyId]);
    expect((await call('/api/catalog/companies?view=everything')).status).toBe(400);
  });
});

// Публикации объекта (ADR-016, этап 23C): общей ленты нет — объект показывает свои публикации сам.
describe('публикации объекта', () => {
  it('объект отдаёт обе публикации, где он назван, в форме ленты компании', async () => {
    const project = (await getPool().query<{ id: number }>(`SELECT id FROM projects WHERE name ILIKE '%Картадемо%' AND merged_into_id IS NULL ORDER BY id LIMIT 1`)).rows[0]!;
    const res = await call(`/api/projects/${project.id}/publications?limit=10`);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ itemId: number; snippet: string; facts: unknown[] }>;
    expect(items).toHaveLength(2);
    expect(items.every(i => i.facts.length === 0)).toBe(true);
    expect(items.map(i => i.snippet).join(' ')).toContain('Картасервис');
    expect((await call('/api/projects/abc/publications')).status).toBe(400);
  });

  it('карточка компании отдаёт отметку «на контроле» и наименование ЕГРЮЛ (нет снимка Фокуса — null)', async () => {
    const res = await call(`/api/companies/${companyId}`);
    expect(res.body).toMatchObject({ watch: null, egrul: null });
  });
});

describe('кто строит для компании (этап 24D)', () => {
  // Своя публикация — в последнем блоке: иначе счётчики публикаций и разборов выше выросли бы.
  beforeAll(async () => {
    await ingest(`Новости стройки. ${CUSTOMER}`, fx.answer({
      companies: [fx.company('Картазаказ', CUSTOMER)],
      projects: [fx.project('Картадемо', CUSTOMER)],
      relations: [
        fx.relation({ type: 'participation', kind: 'customer', subject: 'Картазаказ', project: 'Картадемо', quote: CUSTOMER }),
      ],
    }));
    customerId = (await getPool().query<{ id: number }>(
      `SELECT id FROM companies WHERE name LIKE '%Картазаказ%' AND merged_into_id IS NULL ORDER BY id LIMIT 1`,
    )).rows[0]!.id;
  });

  it('генподрядчик из публикаций на объекте заказчика — с ИНН и числом записей; субподрядчик не входит', async () => {
    const res = await call(`/api/companies/${customerId}/builders`);
    expect(res.status).toBe(200);
    const body = res.body as {
      items: Array<{ company: { id: number } | null; inn: string | null; roles: string[]; sources: string[]; objects: Array<{ mentions: number | null; lastPublication: string | null }> }>;
      objects: { customerSide: number; withRegistry: number };
    };
    expect(body.objects).toMatchObject({ customerSide: 1, withRegistry: 0 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ company: { id: companyId }, inn: INN_A, roles: ['general_contractor'], sources: ['publications'] });
    expect(body.items[0]!.objects[0]).toMatchObject({ mentions: 1, lastPublication: '2026-09-18T07:00:00.000Z' });
  });

  it('у генподрядчика своих объектов заказчика нет — список пуст, customerSide = 0', async () => {
    const res = await call(`/api/companies/${companyId}/builders`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], objects: { customerSide: 0 } });
  });
});
