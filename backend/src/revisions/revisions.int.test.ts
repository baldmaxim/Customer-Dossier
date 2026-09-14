// Этап 02 на PostgreSQL: TC-011…TC-017, гонка, FK, неизменяемость, мост к legacy.
// Все источники и тексты синтетические.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument, type IIncomingDocument } from '../ingest/store.js';
import { recordDeletionObserved } from './store.js';

let tg = 0;
let tg2 = 0;
let site = 0;

const TEXT_A = 'Синтетическая публикация: «Демо-Альфа» ведёт монтаж ВК корпуса 2 ЖК «Берег-Демо», срок — IV квартал.';
const TEXT_B = 'Синтетическая публикация: «Демо-Альфа» ведёт монтаж ВК корпуса 2 ЖК «Берег-Демо», срок перенесён на I квартал.';

const doc = (over: Partial<IIncomingDocument>): IIncomingDocument => ({
  sourceId: tg,
  sourceRunId: null,
  externalId: 'syn/1',
  url: 'https://t.me/syn/1',
  title: null,
  body: TEXT_A,
  publishedAt: new Date('2026-09-01T10:00:00Z'),
  forwardFrom: null,
  representation: 'telegram_web_text@1',
  completeness: 'full',
  completenessReason: 'telegram_web_message_text',
  attachments: [],
  sourceModifiedAt: null,
  fetchedAt: new Date('2026-09-10T10:00:00Z'),
  ...over,
});

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> => {
  const row = (await getPool().query<T>(sql, params)).rows[0];
  if (!row) throw new Error(`пустой результат: ${sql}`);
  return row;
};

const revisionsOf = async (itemId: number) =>
  (
    await getPool().query<{
      id: number;
      revision_no: number;
      body: string;
      same_content_as_revision_id: number | null;
      legacy_document_id: number | null;
      chronology: string;
      completeness: string;
    }>(
      `SELECT id, revision_no, body, same_content_as_revision_id, legacy_document_id, chronology, completeness
       FROM document_revisions WHERE source_item_id = $1 ORDER BY revision_no`,
      [itemId],
    )
  ).rows;

beforeAll(async () => {
  await resetAndMigrate();
  tg = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_rev_a' });
  tg2 = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_rev_b' });
  site = await insertSyntheticSource({ kind: 'website', key: 'synthetic-rev.test', baseUrl: 'https://synthetic-rev.test' });
});

afterAll(async () => {
  await closeDb();
});

describe('редакции одной публикации', () => {
  let itemId = 0;
  let firstRevisionId = 0;
  let legacyId = 0;

  it('первое наблюдение: публикация, редакция 1 и legacy-документ', async () => {
    const result = await storeDocument(doc({}));
    expect(result.outcome).toBe('inserted');
    expect(result.revisionNo).toBe(1);
    itemId = result.sourceItemId!;
    firstRevisionId = result.revisionId!;
    legacyId = result.documentId!;
    const revisions = await revisionsOf(itemId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.legacy_document_id).toBe(legacyId);
  });

  it('TC-011: новый текст при том же external_id — новая редакция, старый текст и legacy-ссылка целы', async () => {
    const result = await storeDocument(doc({ body: TEXT_B, fetchedAt: new Date('2026-09-11T10:00:00Z') }));
    expect(result.outcome).toBe('new_revision');
    expect(result.revisionNo).toBe(2);
    // Ссылка на legacy-документ с цитатами сохраняется за публикацией.
    expect(result.documentId).toBe(legacyId);

    const revisions = await revisionsOf(itemId);
    expect(revisions.map(r => r.body)).toEqual([TEXT_A, TEXT_B]);

    const legacy = await one<{ body: string; n: number }>(
      `SELECT body, (SELECT count(*)::int FROM raw_documents WHERE source_id = $2) AS n FROM raw_documents WHERE id = $1`,
      [legacyId, tg],
    );
    expect(legacy.body).toBe(TEXT_A);
    expect(legacy.n).toBe(1);

    const item = await one<{ latest_revision_id: number }>('SELECT latest_revision_id FROM source_items WHERE id = $1', [itemId]);
    expect(item.latest_revision_id).toBe(result.revisionId);
  });

  it('TC-012: повтор текущей редакции — только наблюдение', async () => {
    const before = await one<{ n: number }>('SELECT count(*)::int AS n FROM source_observations WHERE source_item_id = $1', [itemId]);
    const result = await storeDocument(doc({ body: `${TEXT_B}  \n`, fetchedAt: new Date('2026-09-12T10:00:00Z') }));
    expect(result.outcome).toBe('unchanged');
    expect(await revisionsOf(itemId)).toHaveLength(2);
    const after = await one<{ n: number }>('SELECT count(*)::int AS n FROM source_observations WHERE source_item_id = $1', [itemId]);
    expect(after.n).toBe(before.n + 1);
  });

  it('TC-013: A → B → A — три редакции по порядку, третья помечена как совпадающая с первой', async () => {
    const result = await storeDocument(doc({ body: TEXT_A, fetchedAt: new Date('2026-09-13T10:00:00Z') }));
    expect(result.outcome).toBe('new_revision');
    const revisions = await revisionsOf(itemId);
    expect(revisions.map(r => r.revision_no)).toEqual([1, 2, 3]);
    expect(revisions[2]!.same_content_as_revision_id).toBe(firstRevisionId);
  });

  it('исправление без даты: порядок по наблюдению, дата изменения не выдумана', async () => {
    const revisions = await revisionsOf(itemId);
    expect(revisions[1]!.chronology).toBe('observed_order');
    const modified = await one<{ n: number }>(
      'SELECT count(*)::int AS n FROM document_revisions WHERE source_item_id = $1 AND source_modified_at IS NOT NULL',
      [itemId],
    );
    expect(modified.n).toBe(0);
  });

  it('запоздалое наблюдение старого состояния сохраняется, но текущим не становится', async () => {
    const latestBefore = await one<{ latest_revision_id: number }>('SELECT latest_revision_id FROM source_items WHERE id = $1', [itemId]);
    const result = await storeDocument(
      doc({ body: `${TEXT_B} Промежуточная правка.`, fetchedAt: new Date('2026-09-12T12:00:00Z') }),
    );
    expect(result.outcome).toBe('stale');
    const latestAfter = await one<{ latest_revision_id: number }>('SELECT latest_revision_id FROM source_items WHERE id = $1', [itemId]);
    expect(latestAfter.latest_revision_id).toBe(latestBefore.latest_revision_id);
    const stale = (await revisionsOf(itemId)).at(-1)!;
    expect(stale.chronology).toBe('unknown');
  });

  it('«пропал со страницы» ничего не удаляет; наблюдённое удаление — tombstone без потери редакций', async () => {
    // Сохранение других публикаций того же источника не трогает эту.
    await storeDocument(doc({ externalId: 'syn/2', url: 'https://t.me/syn/2', body: `${TEXT_A} Другая публикация.` }));
    const present = await one<{ state: string }>('SELECT state FROM source_items WHERE id = $1', [itemId]);
    expect(present.state).toBe('present');

    await withTransaction(client =>
      recordDeletionObserved(client, itemId, { observedAt: new Date('2026-09-14T10:00:00Z'), url: null, sourceRunId: null }),
    );
    const deleted = await one<{ state: string; n: number; legacy: number }>(
      `SELECT i.state,
              (SELECT count(*)::int FROM document_revisions WHERE source_item_id = i.id) AS n,
              (SELECT count(*)::int FROM raw_documents WHERE id = $2) AS legacy
       FROM source_items i WHERE i.id = $1`,
      [itemId, legacyId],
    );
    expect(deleted).toEqual({ state: 'deleted_observed', n: 4, legacy: 1 });
  });
});

describe('гонка и личность публикаций', () => {
  it('TC-014: два одновременных наблюдения одного состояния — одна редакция, один legacy-документ', async () => {
    const body = `${TEXT_A} Гонка двух воркеров.`;
    const results = await Promise.all([
      storeDocument(doc({ externalId: 'race/1', url: null, body })),
      storeDocument(doc({ externalId: 'race/1', url: null, body })),
    ]);
    expect(results.map(r => r.outcome).sort()).toEqual(['inserted', 'unchanged']);
    const counts = await one<{ items: number; revisions: number; observations: number; legacy: number }>(
      `SELECT (SELECT count(*)::int FROM source_items WHERE source_id = $1 AND item_key = 'ext:race/1') AS items,
              (SELECT count(*)::int FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id
                 WHERE i.source_id = $1 AND i.item_key = 'ext:race/1') AS revisions,
              (SELECT count(*)::int FROM source_observations o JOIN source_items i ON i.id = o.source_item_id
                 WHERE i.source_id = $1 AND i.item_key = 'ext:race/1') AS observations,
              (SELECT count(*)::int FROM raw_documents WHERE source_id = $1 AND external_id = 'race/1') AS legacy`,
      [tg],
    );
    expect(counts).toEqual({ items: 1, revisions: 1, observations: 2, legacy: 1 });
  });

  it('TC-015: одинаковый текст в двух каналах — две публикации, общий legacy-текст отдельно', async () => {
    const body = `${TEXT_A} Перепечатка в двух каналах.`;
    const first = await storeDocument(doc({ sourceId: tg, externalId: 'syn/50', url: null, body }));
    const second = await storeDocument(doc({ sourceId: tg2, externalId: 'other/9', url: null, body, forwardFrom: 'synthetic_rev_a' }));
    expect(first.outcome).toBe('inserted');
    expect(second.outcome).toBe('duplicate');
    expect(second.sourceItemId).not.toBe(first.sourceItemId);
    expect(second.documentId).toBe(first.documentId);
    const sightings = await one<{ n: number }>('SELECT count(*)::int AS n FROM document_sightings WHERE document_id = $1', [
      first.documentId,
    ]);
    expect(sightings.n).toBe(2);
  });

  it('TC-016: подпись к медиа остаётся caption_only, вложение — неподдержанным', async () => {
    const result = await storeDocument(
      doc({
        externalId: 'syn/60',
        url: null,
        body: `${TEXT_A} Подпись к фото.`,
        completeness: 'caption_only',
        completenessReason: 'telegram_web_media_caption',
        attachments: [{ kind: 'photo', status: 'unsupported' }],
      }),
    );
    const rev = await one<{ completeness: string; attachments: unknown }>(
      'SELECT completeness, attachments FROM document_revisions WHERE id = $1',
      [result.revisionId],
    );
    expect(rev.completeness).toBe('caption_only');
    expect(rev.attachments).toEqual([{ kind: 'photo', status: 'unsupported' }]);
  });

  it('TC-017: содержательный query-параметр различает статьи, tracking-параметр — нет', async () => {
    const page = (url: string, body: string) =>
      doc({ sourceId: site, externalId: null, url, body, representation: 'rss_text@1+title', completeness: 'excerpt' });
    const a = await storeDocument(page('https://synthetic-rev.test/article.php?id=100', `${TEXT_A} Статья 100.`));
    const b = await storeDocument(page('https://synthetic-rev.test/article.php?id=101', `${TEXT_A} Статья 101.`));
    const a2 = await storeDocument(page('https://synthetic-rev.test/article.php?id=100&utm_source=tg', `${TEXT_A} Статья 100.`));
    expect(b.sourceItemId).not.toBe(a.sourceItemId);
    expect(a2.sourceItemId).toBe(a.sourceItemId);
    expect(a2.outcome).toBe('unchanged');
  });
});

describe('ограничения схемы', () => {
  it('редакцию нельзя изменить или удалить', async () => {
    const rev = await one<{ id: number }>('SELECT id FROM document_revisions ORDER BY id LIMIT 1');
    await expect(getPool().query(`UPDATE document_revisions SET body = 'подмена' WHERE id = $1`, [rev.id])).rejects.toThrow(
      /неизменяемы/,
    );
    await expect(getPool().query('DELETE FROM document_revisions WHERE id = $1', [rev.id])).rejects.toThrow(/неизменяемы/);
  });

  it('висячие ссылки невозможны (FK)', async () => {
    await expect(
      getPool().query(
        `INSERT INTO document_revisions (source_item_id, revision_no, body, body_representation, body_hash, dedup_hash,
                                          first_observed_at, chronology)
         VALUES (999999999, 1, 'x', 'test@1', '\\x00', '\\x00', now(), 'unknown')`,
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('наблюдение без редакции допустимо только для удаления', async () => {
    const item = await one<{ id: number; source_id: number }>('SELECT id, source_id FROM source_items ORDER BY id LIMIT 1');
    await expect(
      getPool().query(
        `INSERT INTO source_observations (source_id, source_item_id, revision_id, outcome) VALUES ($1, $2, NULL, 'unchanged')`,
        [item.source_id, item.id],
      ),
    ).rejects.toThrow(/source_observations_revision_required/);
  });
});
