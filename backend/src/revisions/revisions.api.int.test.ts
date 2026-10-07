// API этапа 02: публикации legacy-документа и редакция с текстом (список редакций, diff и здоровье источника сняты 07.10.2026).

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
  await storeDocument(
    base({
      body: 'Синтетический пост: строка первая\n<b>строка вторая</b> исправлена\nстрока третья с деталями объекта',
      fetchedAt: new Date('2026-09-11T00:00:00Z'),
    }),
  );
  legacyId = first.documentId!;
  itemId = first.sourceItemId!;
  rev1 = first.revisionId!;
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('чтение публикаций и редакций', () => {
  it('без входа — 401', async () => {
    const res = await api.call('GET', `/api/revisions/${rev1}`, undefined, { cookie: '' });
    expect(res.status).toBe(401);
  });

  it('из legacy-документа карточки находится публикация', async () => {
    const res = await api.call('GET', `/api/documents/${legacyId}/items`);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: number; revisionCount: number; latestCompleteness: string }>;
    expect(items.map(i => i.id)).toEqual([itemId]);
    expect(items[0]).toMatchObject({ revisionCount: 2, latestCompleteness: 'full' });
  });

  it('конкретная редакция с текстом', async () => {
    const res = await api.call('GET', `/api/revisions/${rev1}`);
    expect((res.body.revision as { body: string }).body).toContain('строка вторая');
  });
});
