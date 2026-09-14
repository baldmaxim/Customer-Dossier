// Backfill идентичности (этап 04): отдельные явные команды, не из миграции и не при старте.
//
//  identifiers — companies.tax_id → entity_identifiers (тип по длине, статус контрольной суммы,
//                origin legacy_import); тип сущности legal_entity для компаний с реквизитом.
//  renormalize — пересчёт name_norm/name_latin и алиасов текущей версией нормализатора
//                (NORMALIZER_VERSION) для строк другой версии; совпавшие ключи — пары в очередь
//                слияний, не слияние.
//
// Dry-run по умолчанию (транзакции откатываются), пакеты с checkpoint, advisory lock,
// повтор идемпотентен. На рабочей базе — только на копии после backup: запись требует --confirm-copy.

import type { Pool, PoolClient } from 'pg';

import { addIdentifier, classifyTaxId } from './identifiers.js';
import { NORMALIZER_VERSION, normalizeName } from './normalize.js';

class DryRunRollback extends Error {}

export interface IBackfillOptions {
  dryRun: boolean;
  batchSize: number;
  fromStart: boolean;
}

const checkpointOf = async (client: PoolClient, name: string, fromStart: boolean): Promise<number> =>
  fromStart
    ? 0
    : ((await client.query<{ last_id: number }>('SELECT last_id FROM backfill_checkpoints WHERE name = $1', [name])).rows[0]?.last_id ?? 0);

const saveCheckpoint = async (client: PoolClient, name: string, lastId: number): Promise<void> => {
  await client.query(
    `INSERT INTO backfill_checkpoints (name, last_id) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET last_id = EXCLUDED.last_id, updated_at = now()`,
    [name, lastId],
  );
};

/** Пакетный проход: каждая пачка — своя транзакция; в dry-run все откатываются. */
const runBatches = async (
  pool: Pool,
  name: string,
  options: IBackfillOptions,
  select: (client: PoolClient, afterId: number, limit: number) => Promise<Array<{ id: number }>>,
  handle: (client: PoolClient, ids: number[]) => Promise<void>,
): Promise<{ scanned: number; checkpoint: number }> => {
  const batch = Math.min(5000, Math.max(1, options.batchSize));
  let cursor = -1;
  let scanned = 0;
  for (;;) {
    const client = await pool.connect();
    let rows: Array<{ id: number }> = [];
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]);
      if (cursor < 0) cursor = await checkpointOf(client, name, options.fromStart);
      rows = await select(client, cursor, batch);
      if (rows.length > 0) {
        await handle(
          client,
          rows.map(r => r.id),
        );
        cursor = rows[rows.length - 1]!.id;
        scanned += rows.length;
        if (!options.dryRun) await saveCheckpoint(client, name, cursor);
      }
      if (options.dryRun) throw new DryRunRollback();
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!(err instanceof DryRunRollback)) throw err;
    } finally {
      client.release();
    }
    if (rows.length < batch) break;
  }
  return { scanned, checkpoint: cursor };
};

export interface IIdentifierBackfillReport {
  rowsScanned: number;
  identifiersCreated: number;
  identifiersExisting: number;
  unrecognized: number;
  checksumInvalid: number;
  entityTypeSet: number;
  checkpoint: number;
}

export const runIdentifierBackfill = async (pool: Pool, options: IBackfillOptions): Promise<IIdentifierBackfillReport> => {
  const report: IIdentifierBackfillReport = {
    rowsScanned: 0,
    identifiersCreated: 0,
    identifiersExisting: 0,
    unrecognized: 0,
    checksumInvalid: 0,
    entityTypeSet: 0,
    checkpoint: 0,
  };
  const result = await runBatches(
    pool,
    'identity_identifiers_from_tax_id',
    options,
    async (client, afterId, limit) =>
      (
        await client.query<{ id: number }>(
          `SELECT id FROM companies WHERE id > $1 AND tax_id IS NOT NULL AND merged_into_id IS NULL ORDER BY id LIMIT $2`,
          [afterId, limit],
        )
      ).rows,
    async (client, ids) => {
      const rows = (
        await client.query<{ id: number; tax_id: string; entity_type: string }>(
          'SELECT id, tax_id, entity_type FROM companies WHERE id = ANY($1::bigint[]) ORDER BY id',
          [ids],
        )
      ).rows;
      for (const row of rows) {
        const typed = classifyTaxId(row.tax_id);
        if (!typed) {
          report.unrecognized += 1;
          continue;
        }
        if (typed.validationStatus !== 'checksum_valid') report.checksumInvalid += 1;
        const existing = (
          await client.query<{ company_id: number }>(
            `SELECT company_id FROM entity_identifiers
             WHERE jurisdiction = $1 AND identifier_type = $2 AND value = $3 AND status = 'active'`,
            [typed.jurisdiction, typed.identifierType, typed.value],
          )
        ).rows[0];
        if (existing) {
          report.identifiersExisting += 1;
        } else {
          await addIdentifier(client, { ...typed, companyId: row.id, origin: 'legacy_import', createdBy: 'backfill' });
          report.identifiersCreated += 1;
        }
        if (row.entity_type === 'unknown') {
          await client.query(
            `UPDATE companies SET entity_type = 'legal_entity', version = version + 1, updated_at = now() WHERE id = $1`,
            [row.id],
          );
          report.entityTypeSet += 1;
        }
      }
    },
  );
  report.rowsScanned = result.scanned;
  report.checkpoint = result.checkpoint;
  return report;
};

export interface IRenormalizeBackfillReport {
  normalizerVersion: string;
  companiesScanned: number;
  projectsScanned: number;
  keysChanged: number;
  aliasesChanged: number;
  aliasesMerged: number;
  collisionPairs: Array<{ kind: string; a: number; b: number; key: string }>;
  queuedPairs: number;
}

const renormalizeAliases = async (
  client: PoolClient,
  kind: 'company' | 'project',
  entityId: number,
  report: IRenormalizeBackfillReport,
): Promise<void> => {
  const aliases = (
    await client.query<{ id: number; alias: string; alias_norm: string; alias_latin: string; hits: number }>(
      `SELECT id, alias, alias_norm, alias_latin, hits FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2 ORDER BY id`,
      [kind, entityId],
    )
  ).rows;
  const groups = new Map<string, Array<(typeof aliases)[number] & { norm: string; latin: string }>>();
  for (const a of aliases) {
    const next = normalizeName(a.alias, kind);
    const group = groups.get(next.norm) ?? [];
    group.push({ ...a, norm: next.norm, latin: next.latin });
    groups.set(next.norm, group);
  }
  // Сначала временные ключи (уникальность внутри сущности), затем итоговые.
  const updates: Array<{ id: number; norm: string; latin: string; hits: number }> = [];
  const deletes: number[] = [];
  for (const group of groups.values()) {
    const [keep, ...dups] = group as [(typeof group)[number], ...(typeof group)[number][]];
    if (keep.norm !== keep.alias_norm || keep.latin !== keep.alias_latin || dups.length > 0) {
      updates.push({ id: keep.id, norm: keep.norm, latin: keep.latin, hits: group.reduce((s, x) => s + x.hits, 0) });
      if (keep.norm !== keep.alias_norm || keep.latin !== keep.alias_latin) report.aliasesChanged += 1;
    }
    deletes.push(...dups.map(d => d.id));
    report.aliasesMerged += dups.length;
  }
  if (deletes.length > 0) await client.query('DELETE FROM entity_aliases WHERE id = ANY($1::bigint[])', [deletes]);
  if (updates.length === 0) return;
  await client.query(`UPDATE entity_aliases SET alias_norm = '~renorm~' || id::text WHERE id = ANY($1::bigint[])`, [updates.map(u => u.id)]);
  for (const u of updates) {
    await client.query('UPDATE entity_aliases SET alias_norm = $2, alias_latin = $3, hits = $4 WHERE id = $1', [u.id, u.norm, u.latin, u.hits]);
  }
};

export const runRenormalizeBackfill = async (pool: Pool, options: IBackfillOptions): Promise<IRenormalizeBackfillReport> => {
  const report: IRenormalizeBackfillReport = {
    normalizerVersion: NORMALIZER_VERSION,
    companiesScanned: 0,
    projectsScanned: 0,
    keysChanged: 0,
    aliasesChanged: 0,
    aliasesMerged: 0,
    collisionPairs: [],
    queuedPairs: 0,
  };

  for (const kind of ['company', 'project'] as const) {
    const table = kind === 'company' ? 'companies' : 'projects';
    const result = await runBatches(
      pool,
      `identity_renormalize_${NORMALIZER_VERSION}_${kind}`,
      options,
      async (client, afterId, limit) =>
        (
          await client.query<{ id: number }>(
            `SELECT id FROM ${table}
             WHERE id > $1 AND merged_into_id IS NULL AND normalizer_version IS DISTINCT FROM $2
             ORDER BY id LIMIT $3`,
            [afterId, NORMALIZER_VERSION, limit],
          )
        ).rows,
      async (client, ids) => {
        const rows = (
          await client.query<{ id: number; name: string; name_norm: string; name_latin: string; name_key: string }>(
            `SELECT id, name, name_norm, name_latin, name_key FROM ${table} WHERE id = ANY($1::bigint[]) ORDER BY id`,
            [ids],
          )
        ).rows;
        for (const row of rows) {
          const next = normalizeName(row.name, kind);
          if (next.norm !== row.name_norm || next.latin !== row.name_latin) report.keysChanged += 1;
          await client.query(
            `UPDATE ${table} SET name_norm = $2, name_latin = $3, normalizer_version = $4, updated_at = now() WHERE id = $1`,
            [row.id, next.norm, next.latin, NORMALIZER_VERSION],
          );
          await renormalizeAliases(client, kind, row.id, report);
          // Совпавший после пересчёта ключ — кандидат на слияние, решение за оператором.
          // Только для изменившихся ключей: прежние совпадения резолвер уже разбирал.
          if (next.key === row.name_key) continue;
          const same = (
            await client.query<{ id: number }>(
              `SELECT id FROM ${table} WHERE name_key = $1 AND id <> $2 AND merged_into_id IS NULL ORDER BY id`,
              [next.key, row.id],
            )
          ).rows;
          for (const other of same) {
            const pair = { kind, a: Math.min(row.id, other.id), b: Math.max(row.id, other.id), key: next.key };
            if (!report.collisionPairs.some(p => p.kind === pair.kind && p.a === pair.a && p.b === pair.b)) {
              report.collisionPairs.push(pair);
              const inserted = await client.query(
                `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons, status)
                 VALUES ($1, $2, $3, 0.9, $4, 'pending')
                 ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
                 DO NOTHING`,
                [kind, pair.b, pair.a, JSON.stringify({ key: 'exact_after_renormalize', normalizer: NORMALIZER_VERSION })],
              );
              report.queuedPairs += inserted.rowCount ?? 0;
            }
          }
        }
      },
    );
    if (kind === 'company') report.companiesScanned = result.scanned;
    else report.projectsScanned = result.scanned;
  }
  return report;
};
