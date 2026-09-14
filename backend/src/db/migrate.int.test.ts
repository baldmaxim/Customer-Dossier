// TC-003: dry-run миграций не меняет ни схему, ни строки.
// Плюс: destructive-миграция не применяется без флага; повторный запуск — no-op.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from './pool.js';
import { DestructiveMigrationError, listMigrationFiles, runMigrations } from './migrate.js';
import { resetSchema } from '../__tests__/integration/db.js';

const catalogSnapshot = async (): Promise<string> => {
  const res = await getPool().query<{ items: string }>(
    `SELECT coalesce(string_agg(kind || ':' || name, ',' ORDER BY kind, name), '') AS items FROM (
       SELECT 'rel' AS kind, c.relname AS name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT 'type', t.typname FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
       UNION ALL
       SELECT 'ext', e.extname FROM pg_extension e WHERE e.extname <> 'plpgsql'
     ) x`,
  );
  return res.rows[0]?.items ?? '';
};

beforeAll(async () => {
  await resetSchema();
});

afterAll(async () => {
  await closeDb();
});

describe('runMigrations на пустой базе', () => {
  it('dry-run без schema_migrations не выполняет DDL и DML (TC-003)', async () => {
    const before = await catalogSnapshot();
    const lines: string[] = [];
    const plan = await runMigrations({ dryRun: true, log: l => lines.push(l) });
    const after = await catalogSnapshot();

    expect(after).toBe(before);
    expect(plan.registryExists).toBe(false);
    expect(plan.pending).toEqual(listMigrationFiles());
    expect(lines.join('\n')).toContain('009_switch_to_russia.sql');
    expect(lines.join('\n')).toContain('ВНИМАНИЕ');
  });

  it('без --allow-destructive применение отказывает до первой миграции', async () => {
    const before = await catalogSnapshot();
    await expect(runMigrations({ log: () => undefined })).rejects.toBeInstanceOf(DestructiveMigrationError);
    expect(await catalogSnapshot()).toBe(before);
  });

  it('с флагом применяются все миграции, включая 010', async () => {
    const plan = await runMigrations({ allowDestructive: true, log: () => undefined });
    expect(plan.pending).toContain('010_source_policy.sql');
    const applied = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(applied.rows[0]?.n).toBe(listMigrationFiles().length);
  });

  it('повторный запуск и dry-run — no-op', async () => {
    const before = await catalogSnapshot();
    const plan = await runMigrations({ dryRun: true, log: () => undefined });
    expect(plan.pending).toEqual([]);
    await runMigrations({ log: () => undefined });
    expect(await catalogSnapshot()).toBe(before);
  });

  it('существующие источники после 010 не получают допуска', async () => {
    const res = await getPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sources
       WHERE access_status <> 'unknown' OR ai_processing_status <> 'unknown'`,
    );
    expect(res.rows[0]?.n).toBe(0);
  });

  it('схема не принимает разрешение без основания и ответственного', async () => {
    await expect(
      getPool().query(`UPDATE sources SET access_status = 'approved' WHERE kind = 'manual' AND key = 'form'`),
    ).rejects.toThrow(/sources_policy_basis_required/);
  });
});
