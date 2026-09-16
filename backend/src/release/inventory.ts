// Контрольные числа локальной установки (этап 09): сколько чего лежит в базе, цела ли связность,
// какие источники и флаги включены. Используется до и после восстановления резервной копии и как
// быстрая проверка «не пропало ли что-то» после переустановки.
//
// Читает только метаданные и счётчики: тексты публикаций, цитаты и значения секретов не выгружаются.

import type { DbExecutor } from '../db/pool.js';
import { env } from '../config/env.js';

export const INVENTORY_VERSION = 'local-inventory@1';

/** Таблицы, по которым сверяются количества. Новая таблица с данными обязана попасть сюда. */
export const COUNTED_TABLES = [
  'sources',
  'source_items',
  'document_revisions',
  'source_observations',
  'raw_documents',
  'extraction_runs',
  'extraction_chunks',
  'extraction_chunk_responses',
  'candidate_sets',
  'candidate_assertions',
  'item_publications',
  'assertions',
  'evidence',
  'review_decisions',
  'companies',
  'entity_identifiers',
  'entity_aliases',
  'company_relations',
  'projects',
  'project_participants',
  'events',
  'mentions',
  'entity_merges',
  'entity_merge_moves',
  'resolution_ambiguities',
  'merge_queue',
  'signal_refreshes',
  'company_signal_snapshots',
  'dossier_cases',
  'dossier_case_versions',
  'dossier_snapshots',
  'dossier_snapshot_redactions',
  'bot_processed_updates',
  'source_policy_log',
  'schema_migrations',
] as const;

export interface IIntegrityCheck {
  code: string;
  description: string;
  /** Сколько строк нарушает правило; 0 — всё в порядке. */
  violations: number;
}

export interface IInventory {
  version: string;
  takenAt: string;
  database: { name: string; host: string; port: number; isTestTarget: boolean };
  migrations: { applied: number; last: string | null };
  counts: Record<string, number>;
  integrity: IIntegrityCheck[];
  sources: Array<{ key: string; kind: string; status: string; accessStatus: string; aiProcessingStatus: string; isSynthetic: boolean; items: number; lastRunAt: string | null }>;
  reviews: { total: number; byDecision: Record<string, number> };
  snapshots: { total: number; redacted: number; hashAlgorithms: string[] };
  flags: Record<string, boolean | string>;
}

const INTEGRITY_CHECKS: Array<{ code: string; description: string; sql: string }> = [
  { code: 'evidence_without_revision', description: 'доказательство без своей редакции', sql: 'SELECT count(*)::int AS n FROM evidence e LEFT JOIN document_revisions r ON r.id = e.revision_id WHERE r.id IS NULL' },
  { code: 'evidence_without_assertion', description: 'доказательство без утверждения', sql: 'SELECT count(*)::int AS n FROM evidence e LEFT JOIN assertions a ON a.id = e.assertion_id WHERE a.id IS NULL' },
  { code: 'review_without_assertion', description: 'решение аналитика без утверждения', sql: 'SELECT count(*)::int AS n FROM review_decisions d LEFT JOIN assertions a ON a.id = d.assertion_id WHERE a.id IS NULL' },
  { code: 'revision_without_item', description: 'редакция без публикации', sql: 'SELECT count(*)::int AS n FROM document_revisions r LEFT JOIN source_items i ON i.id = r.item_id WHERE i.id IS NULL' },
  { code: 'item_without_source', description: 'публикация без источника', sql: 'SELECT count(*)::int AS n FROM source_items i LEFT JOIN sources s ON s.id = i.source_id WHERE s.id IS NULL' },
  { code: 'snapshot_without_case', description: 'снимок без обращения', sql: 'SELECT count(*)::int AS n FROM dossier_snapshots s LEFT JOIN dossier_cases c ON c.id = s.case_id WHERE c.id IS NULL' },
  { code: 'case_company_merged', description: 'обращение ссылается на слитую компанию', sql: 'SELECT count(*)::int AS n FROM dossier_cases c JOIN companies co ON co.id = c.company_id WHERE co.merged_into_id IS NOT NULL' },
  { code: 'assertion_company_merged', description: 'утверждение ссылается на слитую компанию', sql: 'SELECT count(*)::int AS n FROM assertions a JOIN companies c ON c.id = a.subject_company_id WHERE c.merged_into_id IS NOT NULL' },
  { code: 'identifier_conflict', description: 'один реквизит у двух живых компаний', sql: "SELECT coalesce(sum(cnt - 1), 0)::int AS n FROM (SELECT count(DISTINCT company_id) AS cnt FROM entity_identifiers WHERE status = 'active' GROUP BY identifier_type, value HAVING count(DISTINCT company_id) > 1) t" },
  { code: 'approved_without_basis', description: 'допуск подтверждён без основания', sql: "SELECT count(*)::int AS n FROM sources WHERE (access_status = 'approved' OR ai_processing_status = 'approved') AND (policy_basis IS NULL OR policy_owner IS NULL)" },
];

/** Снимок контрольных чисел. Долгих запросов нет: только count и метаданные. */
export const collectInventory = async (exec: DbExecutor, now: Date = new Date()): Promise<IInventory> => {
  const known = new Set(
    (await exec.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map(r => r.table_name),
  );

  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    if (!known.has(table)) continue;
    counts[table] = (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  }

  const integrity: IIntegrityCheck[] = [];
  for (const check of INTEGRITY_CHECKS) {
    const tables = [...check.sql.matchAll(/(?:FROM|JOIN)\s+([a-z_]+)/g)].map(m => m[1]!);
    if (tables.some(t => !known.has(t))) continue;
    integrity.push({ code: check.code, description: check.description, violations: (await exec.query<{ n: number }>(check.sql)).rows[0]!.n });
  }

  const db = (
    await exec.query<{ name: string; host: string | null; port: number | null }>(
      `SELECT current_database() AS name, inet_server_addr()::text AS host, inet_server_port() AS port`,
    )
  ).rows[0]!;

  const migrations = known.has('schema_migrations')
    ? (await exec.query<{ applied: number; last: string | null }>('SELECT count(*)::int AS applied, max(filename) AS last FROM schema_migrations')).rows[0]!
    : { applied: 0, last: null };

  const sources = known.has('sources')
    ? (
        await exec.query<IInventory['sources'][number]>(
          `SELECT s.key, s.kind, s.status, s.access_status AS "accessStatus", s.ai_processing_status AS "aiProcessingStatus",
                  coalesce(s.is_synthetic, false) AS "isSynthetic",
                  (SELECT count(*)::int FROM source_items i WHERE i.source_id = s.id) AS items,
                  (SELECT max(r.finished_at)::text FROM source_runs r WHERE r.source_id = s.id) AS "lastRunAt"
           FROM sources s ORDER BY s.key`,
        )
      ).rows
    : [];

  const reviews = known.has('review_decisions')
    ? (await exec.query<{ decision: string; n: number }>('SELECT decision, count(*)::int AS n FROM review_decisions GROUP BY decision ORDER BY decision')).rows
    : [];

  const snapshots = known.has('dossier_snapshots')
    ? (
        await exec.query<{ total: number; redacted: number; algorithms: string[] }>(
          `SELECT count(*)::int AS total,
                  (SELECT count(DISTINCT snapshot_id)::int FROM dossier_snapshot_redactions) AS redacted,
                  coalesce(array_agg(DISTINCT hash_algorithm), '{}') AS algorithms
           FROM dossier_snapshots`,
        )
      ).rows[0]!
    : { total: 0, redacted: 0, algorithms: [] };

  return {
    version: INVENTORY_VERSION,
    takenAt: now.toISOString(),
    database: { name: db.name, host: db.host ?? 'local', port: db.port ?? 0, isTestTarget: /test/i.test(db.name) },
    migrations: { applied: migrations.applied, last: migrations.last },
    counts,
    integrity,
    sources,
    reviews: { total: reviews.reduce((s, r) => s + r.n, 0), byDecision: Object.fromEntries(reviews.map(r => [r.decision, r.n])) },
    snapshots: { total: snapshots.total, redacted: snapshots.redacted, hashAlgorithms: snapshots.algorithms },
    flags: {
      INGEST_ENABLED: env.INGEST_ENABLED,
      PIPELINE_ENABLED: env.PIPELINE_ENABLED,
      METRICS_AUTO_REFRESH: env.METRICS_AUTO_REFRESH,
      BOT_ENABLED: env.BOT_ENABLED,
      REPROCESS_AUTO_PUBLISH: env.REPROCESS_AUTO_PUBLISH,
      MERGE_APPLY_ENABLED: env.MERGE_APPLY_ENABLED,
      REVISION_WRITE_ENABLED: env.REVISION_WRITE_ENABLED,
      GRAPH_EXPORT_ENABLED: env.GRAPH_EXPORT_ENABLED,
      HOST: env.HOST,
    },
  };
};

export interface IInventoryDiff {
  equal: boolean;
  counts: Array<{ table: string; before: number; after: number }>;
  sources: Array<{ key: string; field: string; before: string; after: string }>;
  reviews: Array<{ decision: string; before: number; after: number }>;
  snapshots: Array<{ field: string; before: number; after: number }>;
  integrity: Array<{ code: string; violations: number }>;
  notes: string[];
}

/**
 * Сравнение двух снимков: восстановленная копия обязана совпасть с исходной по количествам,
 * решениям аналитика, редакциям, снимкам и состоянию допуска источников. Время съёмки не сравнивается.
 */
export const diffInventory = (before: IInventory, after: IInventory): IInventoryDiff => {
  const counts = [...new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])]
    .map(table => ({ table, before: before.counts[table] ?? 0, after: after.counts[table] ?? 0 }))
    .filter(r => r.before !== r.after);

  const byKey = new Map(before.sources.map(s => [s.key, s]));
  const sources: IInventoryDiff['sources'] = [];
  for (const a of after.sources) {
    const b = byKey.get(a.key);
    if (!b) {
      sources.push({ key: a.key, field: 'наличие', before: 'нет', after: 'есть' });
      continue;
    }
    for (const field of ['status', 'accessStatus', 'aiProcessingStatus', 'items'] as const) {
      if (String(b[field]) !== String(a[field])) sources.push({ key: a.key, field, before: String(b[field]), after: String(a[field]) });
    }
  }
  for (const b of before.sources) if (!after.sources.some(a => a.key === b.key)) sources.push({ key: b.key, field: 'наличие', before: 'есть', after: 'нет' });

  const reviews = [...new Set([...Object.keys(before.reviews.byDecision), ...Object.keys(after.reviews.byDecision)])]
    .map(decision => ({ decision, before: before.reviews.byDecision[decision] ?? 0, after: after.reviews.byDecision[decision] ?? 0 }))
    .filter(r => r.before !== r.after);

  const snapshots = (['total', 'redacted'] as const)
    .map(field => ({ field, before: before.snapshots[field], after: after.snapshots[field] }))
    .filter(r => r.before !== r.after);

  const integrity = after.integrity.filter(c => c.violations > 0).map(c => ({ code: c.code, violations: c.violations }));

  const notes: string[] = [];
  if (before.migrations.last !== after.migrations.last) notes.push(`последняя миграция отличается: ${before.migrations.last} → ${after.migrations.last}`);
  if (before.database.name === after.database.name) notes.push('сравниваются снимки одной и той же базы — для проверки восстановления нужна отдельная цель');

  return { equal: counts.length === 0 && sources.length === 0 && reviews.length === 0 && snapshots.length === 0 && integrity.length === 0, counts, sources, reviews, snapshots, integrity, notes };
};
