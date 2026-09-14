// API этапа 02: публикация, список редакций, редакция, diff, здоровье источника.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument, type IIncomingDocument } from '../ingest/store.js';

let api: ITestApi;
let sourceId = 0;
let legacyId = 0;
let itemId = 0;
let rev1 = 0;
let rev2 = 0;
let otherRevision = 0;

const base = (over: Partial<IIncomingDocument>): IIncomingDocument => ({
  sourceId,
  sourceRunId: null,
  externalId: 'api/1',
  url: null,
  title: null,
  body: 'Синтетический пост: строка первая\nстрока вторая\nстрока третья с деталями объекта',
  publishedAt: null,
  forwardFrom: null,
  representation: 'telegram_web_text@1',
  completeness: 'full',
  completenessReason: 'telegram_web_message_text',
  fetchedAt: new Date('2026-09-10T00:00:00Z'),
  ...over,
});

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_rev_api' });
  const first = await storeDocument(base({}));
  const second = await storeDocument(
    base({
      body: 'Синтетический пост: строка первая\n<b>строка вторая</b> исправлена\nстрока третья с деталями объекта',
      fetchedAt: new Date('2026-09-11T00:00:00Z'),
    }),
  );
  const other = await storeDocument(base({ externalId: 'api/2', body: 'Другая синтетическая публикация того же канала.' }));
  legacyId = first.documentId!;
  itemId = first.sourceItemId!;
  rev1 = first.revisionId!;
  rev2 = second.revisionId!;
  otherRevision = other.revisionId!;
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('чтение публикаций и редакций', () => {
  it('без входа — 401', async () => {
    const res = await api.call('GET', `/api/items/${itemId}`, undefined, { cookie: '' });
    expect(res.status).toBe(401);
  });

  it('из legacy-документа карточки находится публикация', async () => {
    const res = await api.call('GET', `/api/documents/${legacyId}/items`);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: number; revisionCount: number; latestCompleteness: string }>;
    expect(items.map(i => i.id)).toEqual([itemId]);
    expect(items[0]).toMatchObject({ revisionCount: 2, latestCompleteness: 'full' });
  });

  it('публикация с наблюдениями', async () => {
    const res = await api.call('GET', `/api/items/${itemId}`);
    expect(res.status).toBe(200);
    expect((res.body.item as { latestRevisionId: number }).latestRevisionId).toBe(rev2);
    expect((res.body.observations as unknown[]).length).toBe(2);
  });

  it('список редакций без текстов, по порядку', async () => {
    const res = await api.call('GET', `/api/items/${itemId}/revisions`);
    const items = res.body.items as Array<{ id: number; revisionNo: number; body?: string }>;
    expect(items.map(r => r.revisionNo)).toEqual([1, 2]);
    expect(items[0]!.body).toBeUndefined();
  });

  it('конкретная редакция с текстом', async () => {
    const res = await api.call('GET', `/api/revisions/${rev1}`);
    expect((res.body.revision as { body: string }).body).toContain('строка вторая');
  });

  it('diff двух редакций — строки как текст, HTML не интерпретируется', async () => {
    const res = await api.call('GET', `/api/revisions/${rev2}/diff?against=${rev1}`);
    expect(res.status).toBe(200);
    const diff = res.body.diff as { ok: boolean; ops: Array<{ op: string; lines?: string[] }> };
    expect(diff.ok).toBe(true);
    expect(diff.ops.find(o => o.op === 'insert')?.lines).toEqual(['<b>строка вторая</b> исправлена']);
  });

  it('diff редакций разных публикаций — 400', async () => {
    const res = await api.call('GET', `/api/revisions/${rev2}/diff?against=${otherRevision}`);
    expect(res.status).toBe(400);
  });

  it('здоровье источника: публикации, редакции, полнота', async () => {
    const res = await api.call('GET', `/api/admin/sources/${sourceId}/health`);
    expect(res.status).toBe(200);
    expect(res.body.items).toMatchObject({ items: 2, withSeveralRevisions: 1, deletedObserved: 0 });
    expect(res.body.latestCompleteness).toEqual([{ completeness: 'full', n: 2 }]);
  });
});
