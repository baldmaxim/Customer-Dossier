// Чтение базы для content-manifest@1. Только чтение: одна транзакция REPEATABLE READ READ ONLY, чтобы все
// разделы относились к одной точке данных; строки читаются серверным курсором (без OFFSET-пагинации).
// Значения колонок берутся как ::text при фиксированных параметрах сессии — JS-парсеры pg не участвуют.
// nextval/setval не вызываются: состояние последовательностей читается из pg_sequences.

import type { PoolClient } from 'pg';

import { TEST_DB_MARKER } from '../db/testTarget.js';
import { listMigrationFiles } from '../db/migrate.js';
import { runIntegrityChecks } from './inventory.js';
import {
  checkSnapshotRows,
  columnsDigest,
  rowDigest,
  sectionDigest,
  sequencesBehindData,
  tableDigest,
  type IContentManifest,
  type IRedactionRow,
  type ISequenceState,
  type ISnapshotRow,
  type ITableFingerprint,
  type TextRow,
} from './manifest.js';
import { MANIFEST_VERSION, NOT_FINGERPRINTED, ROW_SERIALIZATION, TABLE_SPECS } from './manifestSpec.js';

const FETCH_SIZE = 1000;

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** Все строки запроса через курсор внутри текущей транзакции. */
const forEachRow = async <T>(client: PoolClient, sql: string, params: unknown[], onRows: (rows: T[]) => void, arrayMode = false): Promise<void> => {
  await client.query(`DECLARE manifest_cursor NO SCROLL CURSOR FOR ${sql}`, params);
  try {
    for (;;) {
      const fetch = `FETCH FORWARD ${FETCH_SIZE} FROM manifest_cursor`;
      const batch = arrayMode ? await client.query({ text: fetch, rowMode: 'array' }) : await client.query(fetch);
      if (batch.rows.length === 0) break;
      onRows(batch.rows as T[]);
    }
  } finally {
    await client.query('CLOSE manifest_cursor');
  }
};

const textRows = async (client: PoolClient, sql: string): Promise<TextRow[]> =>
  (await client.query({ text: sql, rowMode: 'array' })).rows as TextRow[];

const fingerprintTable = async (client: PoolClient, table: string, cls: ITableFingerprint['class']): Promise<ITableFingerprint> => {
  const columns = (
    await client.query<{ name: string; type: string }>(
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attname`,
      [`public.${ident(table)}`],
    )
  ).rows;
  const pk = (
    await client.query<{ name: string }>(
      `SELECT a.attname AS name
       FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])
       WHERE i.indrelid = $1::regclass AND i.indisprimary
       ORDER BY array_position(i.indkey::int2[], a.attnum)`,
      [`public.${ident(table)}`],
    )
  ).rows.map(r => r.name);
  const select = columns.map(c => `${ident(c.name)}::text`).join(', ');
  // Порядок выборки нужен только для воспроизводимого чтения; fingerprint от него не зависит.
  const order = (pk.length > 0 ? pk : columns.map(c => c.name)).map(ident).join(', ');
  const digests: string[] = [];
  await forEachRow<TextRow>(client, `SELECT ${select} FROM public.${ident(table)} ORDER BY ${order}`, [], rows => {
    for (const row of rows) digests.push(rowDigest(row));
  }, true);
  const columnsHash = columnsDigest(columns.map(c => [c.name, c.type] as const));
  return { class: cls, rows: digests.length, columns: columns.length, columnsHash, digest: tableDigest(columnsHash, digests) };
};

const SCHEMA_SECTIONS: Record<string, string> = {
  columns: `SELECT c.relname::text, c.relkind::text, a.attname::text, format_type(a.atttypid, a.atttypmod), a.attnotnull::text,
                   pg_get_expr(d.adbin, d.adrelid), a.attgenerated::text, a.attidentity::text
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
            LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY 1, 3`,
  constraints: `SELECT conrelid::regclass::text, conname::text, pg_get_constraintdef(oid) FROM pg_constraint
                WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`,
  indexes: `SELECT tablename::text, indexname::text, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`,
  triggers: `SELECT t.tgrelid::regclass::text, t.tgname::text, pg_get_triggerdef(t.oid) FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace ORDER BY 1, 2`,
  functions: `SELECT p.proname::text, pg_get_function_identity_arguments(p.oid), md5(pg_get_functiondef(p.oid)) FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
                AND NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = p.oid AND dep.deptype = 'e')
              ORDER BY 1, 2`,
  views: `SELECT c.relname::text, c.relkind::text, pg_get_viewdef(c.oid, true) FROM pg_class c
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm') ORDER BY 1`,
  enums: `SELECT t.typname::text, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY 1 ORDER BY 1`,
  extensions: `SELECT extname::text, extversion FROM pg_extension ORDER BY 1`,
};

export const collectManifest = async (
  client: PoolClient,
  options: { config: Record<string, string>; now?: Date },
): Promise<IContentManifest> => {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query(`SET LOCAL TimeZone = 'UTC'`);
    await client.query(`SET LOCAL DateStyle = 'ISO, YMD'`);
    await client.query(`SET LOCAL IntervalStyle = 'postgres'`);
    await client.query('SET LOCAL extra_float_digits = 3');
    await client.query(`SET LOCAL bytea_output = 'hex'`);

    const db = (
      await client.query<{ name: string; marker: string | null }>(
        `SELECT current_database() AS name, shobj_description(d.oid, 'pg_database') AS marker FROM pg_database d WHERE d.datname = current_database()`,
      )
    ).rows[0]!;

    const present = new Set(
      (
        await client.query<{ name: string }>(
          `SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')`,
        )
      ).rows.map(r => r.name),
    );
    const specified = new Set(TABLE_SPECS.map(s => s.table));

    const tables: Record<string, ITableFingerprint> = {};
    for (const spec of TABLE_SPECS) {
      if (present.has(spec.table)) tables[spec.table] = await fingerprintTable(client, spec.table, spec.class);
    }

    const schema: IContentManifest['schema'] = {};
    for (const [section, sql] of Object.entries(SCHEMA_SECTIONS)) schema[section] = sectionDigest(await textRows(client, sql));

    const registryExists = present.has('schema_migrations');
    const applied = registryExists ? (await client.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(r => r.filename) : [];
    const files = listMigrationFiles();
    const migrations: IContentManifest['migrations'] = {
      registryExists,
      applied: applied.length,
      digest: sectionDigest(applied.map(f => [f])).digest,
      pendingInCode: files.filter(f => !applied.includes(f)),
      unknownInDb: applied.filter(f => !files.includes(f)),
    };

    const owned = (
      await client.query<{ sequence: string; table: string | null; column: string | null }>(
        `SELECT s.relname AS sequence, t.relname AS "table", a.attname AS "column"
         FROM pg_class s
         LEFT JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
         LEFT JOIN pg_class t ON t.oid = d.refobjid
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
         WHERE s.relkind = 'S' AND s.relnamespace = 'public'::regnamespace
         ORDER BY s.relname`,
      )
    ).rows;
    const states: ISequenceState[] = [];
    for (const o of owned) {
      const lastValue = (
        await client.query<{ v: string | null }>(`SELECT last_value::text AS v FROM pg_sequences WHERE schemaname = 'public' AND sequencename = $1`, [o.sequence])
      ).rows[0]?.v ?? null;
      const maxValue = o.table && o.column
        ? (await client.query<{ v: string | null }>(`SELECT max(${ident(o.column)})::text AS v FROM public.${ident(o.table)}`)).rows[0]?.v ?? null
        : null;
      states.push({ sequence: o.sequence, table: o.table, column: o.column, lastValue, maxValue });
    }

    const snapshotRows: ISnapshotRow[] = [];
    const redactions: IRedactionRow[] = [];
    if (present.has('dossier_snapshots')) {
      await forEachRow<{ id: string; payload: unknown; payload_hash: string; hash_algorithm: string }>(
        client,
        'SELECT id::text AS id, payload, payload_hash, hash_algorithm FROM dossier_snapshots ORDER BY id',
        [],
        rows => {
          for (const r of rows) snapshotRows.push({ id: r.id, payload: r.payload, payloadHash: r.payload_hash, hashAlgorithm: r.hash_algorithm });
        },
      );
    }
    if (present.has('dossier_snapshot_redactions')) {
      redactions.push(
        ...(
          await client.query<{ snapshotId: string; hashBefore: string; hashAfter: string }>(
            `SELECT snapshot_id::text AS "snapshotId", hash_before AS "hashBefore", hash_after AS "hashAfter"
             FROM dossier_snapshot_redactions ORDER BY snapshot_id, id`,
          )
        ).rows,
      );
    }

    const { integrity, skippedIntegrity } = await runIntegrityChecks(client, present);

    await client.query('COMMIT');
    return {
      version: MANIFEST_VERSION,
      serialization: ROW_SERIALIZATION,
      meta: { takenAt: (options.now ?? new Date()).toISOString(), database: db.name, isTestTarget: db.marker === TEST_DB_MARKER, node: process.version },
      tables,
      unclassifiedTables: [...present].filter(t => !specified.has(t)).sort(),
      missingTables: TABLE_SPECS.map(s => s.table).filter(t => !present.has(t)),
      schema,
      migrations,
      sequences: { states, behindData: sequencesBehindData(states) },
      snapshots: checkSnapshotRows(snapshotRows, redactions),
      integrity: { checks: integrity, skipped: skippedIntegrity },
      config: options.config,
      notFingerprinted: NOT_FINGERPRINTED,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
};
