// Снятие разбора моделью со снимков реестра (ADR-012 п. 34) на PostgreSQL: поставленный и брошенный запуск
// (running с истёкшей арендой — исполнитель упал) отменяются; запуск с живой арендой не трогается.
// 06.10.2026: брошенный запуск № 16260 по снимку наш.дом.рф висел «выполняется» с 02.10 — взять его нельзя.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument } from '../ingest/store.js';
import { withdrawModelExtractionOnRegistry } from './modelArtifacts.js';

let revisionId = 0;

const run = async (fingerprint: string, status: 'queued' | 'running', leaseExpires: string | null): Promise<number> =>
  (
    await getPool().query<{ id: number }>(
      `INSERT INTO extraction_runs (revision_id, fingerprint, fingerprint_json, status, lease_owner, lease_expires_at, requested_by)
       VALUES ($1, $2, '{}', $3, $4, $5::timestamptz, 'test') RETURNING id`,
      [revisionId, fingerprint, status, status === 'running' ? 'worker-test' : null, leaseExpires],
    )
  ).rows[0]!.id;

const statusOf = async (id: number): Promise<string> =>
  (await getPool().query<{ status: string }>('SELECT status FROM extraction_runs WHERE id = $1', [id])).rows[0]!.status;

beforeAll(async () => {
  await resetAndMigrate();
  const sourceId = await insertSyntheticSource({ kind: 'website', key: 'registry-runs-demo.test', access: 'approved', ai: 'approved' });
  await getPool().query(`UPDATE sources SET config = '{"mode": "registry_api"}' WHERE id = $1`, [sourceId]);
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: 'object:12452',
    url: 'https://registry-runs-demo.test/object/12452',
    title: null,
    body: 'Застройщик: «ООО СЗ ДЕМО 7» (ID 12452 в реестре). Реквизиты застройщика: ОГРН и ИНН из проектной декларации.',
    publishedAt: null,
    forwardFrom: null,
  });
  revisionId = stored.revisionId!;
});

afterAll(async () => {
  await closeDb();
});

describe('запуски разбора по снимкам реестра', () => {
  it('поставленный и брошенный — отменены, с живой арендой — не тронут', async () => {
    const queued = await run('fp-queued', 'queued', null);
    const abandoned = await run('fp-abandoned', 'running', new Date(Date.now() - 3_600_000).toISOString());
    const live = await run('fp-live', 'running', new Date(Date.now() + 3_600_000).toISOString());

    expect((await withdrawModelExtractionOnRegistry()).runs).toBe(2);
    expect([await statusOf(queued), await statusOf(abandoned), await statusOf(live)]).toEqual(['cancelled', 'cancelled', 'running']);
    expect((await withdrawModelExtractionOnRegistry()).runs).toBe(0);
  });
});
