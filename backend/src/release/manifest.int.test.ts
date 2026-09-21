// T10-01/T10-07/T10-08 (закрытие приёмки 09) на PostgreSQL: content-manifest замечает изменение содержимого при
// прежнем числе строк. Только размеченная тестовая база. Для обхода append-only триггеров в отдельной транзакции
// используется session_replication_role = replica (роль тестового контейнера — суперпользователь); после каждой
// мутации значение возвращается и повторное сравнение снова даёт MATCH.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { assertIsolatedTarget, insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import { recordReviewDecision } from '../assertions/repository.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import { answer, company, project, relation, semanticProvider } from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { INN_A } from '../reprocess/__fixtures__/extraction.js';
import { diffManifest, type IContentManifest } from './manifest.js';
import { collectManifest } from './manifestCollect.js';

const pool = () => getPool();
let api: ITestApi;
let baseline: IContentManifest;

const collect = async (config: Record<string, string> = { INGEST_ENABLED: 'false' }): Promise<IContentManifest> => {
  const client = await pool().connect();
  try {
    return await collectManifest(client, { config });
  } finally {
    client.release();
  }
};

/** Мутация в обход триггеров неизменяемости и возврат прежнего значения. */
const tamper = async (sql: string, params: unknown[] = []): Promise<void> => {
  await assertIsolatedTarget();
  await withTransaction(async client => {
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(sql, params);
  });
};

const codes = async (): Promise<string[]> => diffManifest(baseline, await collect()).problems.map(p => `${p.code}:${p.subject.split(':')[0]}`);

beforeAll(async () => {
  await resetAndMigrate();
  const source = await insertSyntheticSource({ kind: 'telegram', key: 'manifest_channel', access: 'approved', ai: 'approved' });
  const Q = `ООО «Манифест-Альфа» (ИНН ${INN_A}) ведёт монтаж систем ВК корпуса 2 ЖК «Манифест-Причал».`;
  const stored = await storeDocument({ sourceId: source, sourceRunId: null, externalId: 'manifest/1', url: null, title: null, body: Q, publishedAt: new Date('2026-09-01T10:00:00Z'), forwardFrom: null });
  const provider = semanticProvider(() =>
    answer({
      companies: [company('Манифест-Альфа', Q, { legal_form: 'ООО', tax_id: INN_A })],
      projects: [project('Манифест-Причал', Q)],
      relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Манифест-Альфа', project: 'Манифест-Причал', building: 'корпус 2', quote: Q })],
    }),
  );
  const queued = await enqueueRun(pool(), { revisionId: stored.revisionId!, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'manifest-test' });
  if (queued.outcome !== 'queued') throw new Error('запуск не поставлен');
  const run = await processRun(provider, (await claimNextRun('w-manifest', { runId: queued.runId }))!);
  await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'manifest-test' });

  const assertion = (await pool().query<{ id: number; version: number }>(`SELECT id, version FROM assertions WHERE predicate = 'participates_in_project' LIMIT 1`)).rows[0]!;
  await withTransaction(client =>
    recordReviewDecision(client, { assertionId: assertion.id, decision: 'reviewed_supported', scope: 'reflects_source', reason: 'синтетика', reviewer: 'analyst', expectedVersion: assertion.version, idempotencyKey: 'manifest-review-1' }),
  );

  api = await startTestApi();
  const companyId = (await pool().query<{ company_id: number }>(`SELECT company_id FROM entity_identifiers WHERE value = $1`, [INN_A])).rows[0]!.company_id;
  const created = await api.call('POST', '/api/cases', { title: 'Манифест', companyId, requestDate: '2026-09-16' });
  expect(created.status).toBe(201);
  expect((await api.call('POST', `/api/cases/${(created.body.case as { id: number }).id}/snapshots`, {})).status).toBe(201);

  baseline = await collect();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('content-manifest на базе', () => {
  it('исходный manifest без проблем; повторный сбор той же базы — MATCH', async () => {
    expect(baseline.missingTables).toEqual([]);
    expect(baseline.unclassifiedTables).toEqual([]);
    expect(baseline.migrations.pendingInCode).toEqual([]);
    expect(baseline.sequences.behindData).toEqual([]);
    expect(baseline.snapshots.total).toBe(1);
    expect(baseline.snapshots.hashMismatch).toEqual([]);
    expect(baseline.tables.document_revisions!.rows).toBeGreaterThan(0);
    expect(baseline.tables.evidence!.rows).toBeGreaterThan(0);
    expect(baseline.tables.review_decisions!.rows).toBe(1);
    expect(diffManifest(baseline, await collect())).toEqual({ verdict: 'MATCH', problems: [] });
    // В manifest нет текстов и реквизитов.
    const json = JSON.stringify(baseline);
    expect(json).not.toContain('Манифест-Альфа');
    expect(json).not.toContain(INN_A);
  });

  it('текст редакции при том же числе строк', async () => {
    const row = (await pool().query<{ id: number; body: string }>('SELECT id, body FROM document_revisions ORDER BY id LIMIT 1')).rows[0]!;
    await tamper('UPDATE document_revisions SET body = $2 WHERE id = $1', [row.id, row.body.replace('корпуса 2', 'корпуса 3')]);
    expect(await codes()).toContain('TABLE_CONTENT:document_revisions');
    await tamper('UPDATE document_revisions SET body = $2 WHERE id = $1', [row.id, row.body]);
    expect((await collect()).tables.document_revisions!.digest).toBe(baseline.tables.document_revisions!.digest);
  });

  it('цитата evidence', async () => {
    const row = (await pool().query<{ id: number; quote: string }>('SELECT id, quote FROM evidence ORDER BY id LIMIT 1')).rows[0]!;
    await tamper('UPDATE evidence SET quote = $2 WHERE id = $1', [row.id, `${row.quote} `]);
    expect(await codes()).toContain('TABLE_CONTENT:evidence');
    await tamper('UPDATE evidence SET quote = $2 WHERE id = $1', [row.id, row.quote]);
  });

  it('реквизит (ИНН)', async () => {
    await tamper(`UPDATE entity_identifiers SET value = '7707083893' WHERE value = $1`, [INN_A]);
    expect(await codes()).toContain('TABLE_CONTENT:entity_identifiers');
    await tamper(`UPDATE entity_identifiers SET value = $1 WHERE value = '7707083893'`, [INN_A]);
  });

  it('решение аналитика и его автор', async () => {
    await tamper(`UPDATE review_decisions SET reviewer = 'someone-else'`);
    expect(await codes()).toContain('TABLE_CONTENT:review_decisions');
    await tamper(`UPDATE review_decisions SET reviewer = 'analyst'`);
  });

  it('payload снимка при прежнем хранимом hash — ошибка целостности', async () => {
    const row = (await pool().query<{ id: number; payload: Record<string, unknown> }>('SELECT id, payload FROM dossier_snapshots LIMIT 1')).rows[0]!;
    await tamper('UPDATE dossier_snapshots SET payload = $2 WHERE id = $1', [row.id, JSON.stringify({ ...row.payload, limitations: ['подменено'] })]);
    const current = await collect();
    expect(current.snapshots.hashMismatch).toEqual([String(row.id)]);
    expect(diffManifest(baseline, current).problems.map(p => p.code)).toEqual(expect.arrayContaining(['SNAPSHOT_HASH_MISMATCH', 'TABLE_CONTENT']));
    await tamper('UPDATE dossier_snapshots SET payload = $2 WHERE id = $1', [row.id, JSON.stringify(row.payload)]);
    expect((await collect()).snapshots.hashMismatch).toEqual([]);
  });

  it('допуск источника', async () => {
    await tamper(`UPDATE sources SET ai_processing_status = 'revoked' WHERE key = 'manifest_channel'`);
    expect(await codes()).toContain('TABLE_CONTENT:sources');
    await tamper(`UPDATE sources SET ai_processing_status = 'approved' WHERE key = 'manifest_channel'`);
  });

  it('состояние последовательности и последовательность, отставшая от данных', async () => {
    const last = (await pool().query<{ v: string }>(`SELECT last_value::text AS v FROM pg_sequences WHERE sequencename = 'dossier_snapshots_id_seq'`)).rows[0]!.v;
    await assertIsolatedTarget();
    await pool().query(`SELECT setval('dossier_snapshots_id_seq', $1::bigint + 5)`, [last]);
    expect(await codes()).toContain('SEQUENCE_DIFFERS:dossier_snapshots_id_seq');
    await pool().query(`SELECT setval('dossier_snapshots_id_seq', $1::bigint)`, [last]);
    expect(diffManifest(baseline, await collect()).verdict).toBe('MATCH');
  });

  it('отсутствующая обязательная таблица и неклассифицированная таблица — не MATCH', async () => {
    await assertIsolatedTarget();
    await pool().query('CREATE TABLE manifest_unclassified_probe (id int PRIMARY KEY)');
    try {
      expect((await codes())).toContain('UNCLASSIFIED_TABLE:manifest_unclassified_probe (текущий)');
    } finally {
      await pool().query('DROP TABLE manifest_unclassified_probe');
    }
    await pool().query('ALTER TABLE http_cache RENAME TO http_cache_renamed_probe');
    try {
      const current = await collect();
      expect(current.missingTables).toEqual(['http_cache']);
      expect(diffManifest(baseline, current).verdict).toBe('MISMATCH');
    } finally {
      await pool().query('ALTER TABLE http_cache_renamed_probe RENAME TO http_cache');
    }
    expect(diffManifest(baseline, await collect()).verdict).toBe('MATCH');
  });

  it('включённый фон при проверке восстановления виден отдельно от данных', async () => {
    const diff = diffManifest(baseline, await collect({ INGEST_ENABLED: 'true' }));
    expect(diff.problems.map(p => p.code).sort()).toEqual(['BACKGROUND_ENABLED', 'CONFIG_MISMATCH']);
  });
});
