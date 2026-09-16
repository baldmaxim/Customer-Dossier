// Контрольные числа локальной установки (этап 09): сколько чего лежит в базе, цела ли связность,
// какие источники и флаги включены. Используется до и после восстановления резервной копии и как
// быстрая проверка «не пропало ли что-то» после переустановки.
//
// Читает только метаданные и счётчики: тексты публикаций, цитаты и значения секретов не выгружаются.

import type { DbExecutor } from '../db/pool.js';
import { env } from '../config/env.js';
import { TEST_DB_MARKER } from '../db/testTarget.js';

// @2: учтены все таблицы с данными, отсутствующая таблица отличается от пустой, признак тестовой цели — по маркеру.
export const INVENTORY_VERSION = 'local-inventory@2';

/** Таблицы, по которым сверяются количества. Новая таблица с данными обязана попасть сюда. */
export const COUNTED_TABLES = [
  'sources',
  'source_runs',
  'source_items',
  'document_revisions',
  'source_observations',
  'raw_documents',
  'document_sightings',
  'extractions',
  'extraction_runs',
  'extraction_chunks',
  'extraction_chunk_responses',
  'candidate_sets',
  'candidate_assertions',
  'candidate_set_evidence',
  'item_publications',
  'publication_history',
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
  'backfill_checkpoints',
  'http_cache',
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
  /** Таблицы из COUNTED_TABLES, которых нет в базе. Отсутствие — не то же, что пустая таблица. */
  missingTables: string[];
  /** Проверки связности, которые не выполнены из-за отсутствующих таблиц. Пропуск — не PASS. */
  skippedIntegrity: string[];
  integrity: IIntegrityCheck[];
  sources: Array<{ key: string; kind: string; status: string; accessStatus: string; aiProcessingStatus: string; isSynthetic: boolean; items: number; lastRunAt: string | null }>;
  reviews: { total: number; byDecision: Record<string, number> };
  snapshots: { total: number; redacted: number; hashAlgorithms: string[] };
  flags: Record<string, boolean | string>;
}

export const INTEGRITY_CHECKS: Array<{ code: string; description: string; sql: string }> = [
  { code: 'evidence_without_revision', description: 'доказательство без своей редакции', sql: 'SELECT count(*)::int AS n FROM evidence e LEFT JOIN document_revisions r ON r.id = e.revision_id WHERE r.id IS NULL' },
  { code: 'evidence_without_assertion', description: 'доказательство без утверждения', sql: 'SELECT count(*)::int AS n FROM evidence e LEFT JOIN assertions a ON a.id = e.assertion_id WHERE a.id IS NULL' },
  { code: 'review_without_assertion', description: 'решение аналитика без утверждения', sql: 'SELECT count(*)::int AS n FROM review_decisions d LEFT JOIN assertions a ON a.id = d.assertion_id WHERE a.id IS NULL' },
  { code: 'revision_without_item', description: 'редакция без публикации', sql: 'SELECT count(*)::int AS n FROM document_revisions r LEFT JOIN source_items i ON i.id = r.source_item_id WHERE i.id IS NULL' },
  { code: 'item_without_source', description: 'публикация без источника', sql: 'SELECT count(*)::int AS n FROM source_items i LEFT JOIN sources s ON s.id = i.source_id WHERE s.id IS NULL' },
  { code: 'snapshot_without_case', description: 'снимок без обращения', sql: 'SELECT count(*)::int AS n FROM dossier_snapshots s LEFT JOIN dossier_cases c ON c.id = s.case_id WHERE c.id IS NULL' },
  { code: 'case_company_merged', description: 'обращение ссылается на слитую компанию', sql: 'SELECT count(*)::int AS n FROM dossier_cases c JOIN companies co ON co.id = c.company_id WHERE co.merged_into_id IS NOT NULL' },
  // После слияния исходное утверждение остаётся на tombstone (история + решение аналитика);
  // живое — копия на целевой сущности. Нарушение — только если у утверждения на слитой
  // компании ещё есть активные основания (перенос не завершён).
  {
    code: 'assertion_company_merged',
    description: 'утверждение с активными основаниями ссылается на слитую компанию',
    sql: `SELECT count(*)::int AS n FROM assertions a
          JOIN companies c ON c.id = a.subject_company_id
          WHERE c.merged_into_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM evidence e
              WHERE e.assertion_id = a.id AND e.status = 'active'
            )`,
  },
  { code: 'identifier_conflict', description: 'один реквизит у двух живых компаний', sql: "SELECT coalesce(sum(cnt - 1), 0)::int AS n FROM (SELECT count(DISTINCT company_id) AS cnt FROM entity_identifiers WHERE status = 'active' GROUP BY identifier_type, value HAVING count(DISTINCT company_id) > 1) t" },
  { code: 'approved_without_basis', description: 'допуск подтверждён без основания', sql: "SELECT count(*)::int AS n FROM sources WHERE (access_status = 'approved' OR ai_processing_status = 'approved') AND (policy_basis IS NULL OR policy_owner IS NULL)" },
];

/** Проверки связности; проверка, для которой нет таблицы, не выполняется и возвращается отдельно. */
export const runIntegrityChecks = async (
  exec: DbExecutor,
  known: ReadonlySet<string>,
): Promise<{ integrity: IIntegrityCheck[]; skippedIntegrity: string[] }> => {
  const integrity: IIntegrityCheck[] = [];
  const skippedIntegrity: string[] = [];
  for (const check of INTEGRITY_CHECKS) {
    const tables = [...check.sql.matchAll(/(?:FROM|JOIN)\s+([a-z_]+)/g)].map(m => m[1]!);
    if (tables.some(t => !known.has(t))) {
      skippedIntegrity.push(check.code);
      continue;
    }
    integrity.push({ code: check.code, description: check.description, violations: (await exec.query<{ n: number }>(check.sql)).rows[0]!.n });
  }
  return { integrity, skippedIntegrity };
};

/** Снимок контрольных чисел. Долгих запросов нет: только count и метаданные. */
export const collectInventory = async (exec: DbExecutor, now: Date = new Date()): Promise<IInventory> => {
  const known = new Set(
    (await exec.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map(r => r.table_name),
  );

  const counts: Record<string, number> = {};
  const missingTables: string[] = [];
  for (const table of COUNTED_TABLES) {
    if (!known.has(table)) {
      missingTables.push(table);
      continue;
    }
    counts[table] = (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  }

  const { integrity, skippedIntegrity } = await runIntegrityChecks(exec, known);

  const db = (
    await exec.query<{ name: string; host: string | null; port: number | null; marker: string | null }>(
      `SELECT current_database() AS name, inet_server_addr()::text AS host, inet_server_port() AS port,
              (SELECT shobj_description(d.oid, 'pg_database') FROM pg_database d WHERE d.datname = current_database()) AS marker`,
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
    // Признак тестовой цели — маркер базы, а не слово test в имени.
    database: { name: db.name, host: db.host ?? 'local', port: db.port ?? 0, isTestTarget: db.marker === TEST_DB_MARKER },
    migrations: { applied: migrations.applied, last: migrations.last },
    counts,
    missingTables,
    skippedIntegrity,
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
  /** Разные версии формата: сравнение не выполнялось, результат не «совпадает». */
  incompatible: string | null;
  migrations: Array<{ field: string; before: string; after: string }>;
  missingTables: Array<{ table: string; side: 'before' | 'after' }>;
  skippedIntegrity: Array<{ code: string; side: 'before' | 'after' }>;
  counts: Array<{ table: string; before: number; after: number }>;
  sources: Array<{ key: string; field: string; before: string; after: string }>;
  reviews: Array<{ decision: string; before: number; after: number }>;
  snapshots: Array<{ field: string; before: number; after: number }>;
  integrity: Array<{ code: string; side: 'before' | 'after'; violations: number }>;
  notes: string[];
}

const emptyDiff = (incompatible: string | null): IInventoryDiff => ({
  equal: false,
  incompatible,
  migrations: [],
  missingTables: [],
  skippedIntegrity: [],
  counts: [],
  sources: [],
  reviews: [],
  snapshots: [],
  integrity: [],
  notes: [],
});

/**
 * Сравнение двух снимков: восстановленная копия обязана совпасть с исходной по количествам,
 * решениям аналитика, редакциям, снимкам и состоянию допуска источников. Время съёмки не сравнивается.
 */
export const diffInventory = (before: IInventory, after: IInventory): IInventoryDiff => {
  if (before.version !== after.version) {
    return emptyDiff(`формат ${before.version ?? 'неизвестен'} несовместим с ${after.version}: снимите контрольные числа заново текущей версией`);
  }

  // Разные миграции — разная схема: это расхождение, а не примечание.
  const migrations: IInventoryDiff['migrations'] = [];
  if (before.migrations.applied !== after.migrations.applied) migrations.push({ field: 'применено', before: String(before.migrations.applied), after: String(after.migrations.applied) });
  if (before.migrations.last !== after.migrations.last) migrations.push({ field: 'последняя', before: String(before.migrations.last), after: String(after.migrations.last) });

  const missingTables = [
    ...(before.missingTables ?? []).map(table => ({ table, side: 'before' as const })),
    ...(after.missingTables ?? []).map(table => ({ table, side: 'after' as const })),
  ];
  const skippedIntegrity = [
    ...(before.skippedIntegrity ?? []).map(code => ({ code, side: 'before' as const })),
    ...(after.skippedIntegrity ?? []).map(code => ({ code, side: 'after' as const })),
  ];

  // Отсутствующая таблица не считается нулём: она уже попала в missingTables и сравнивается только существующая.
  const counts = [...new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])]
    .filter(table => table in before.counts && table in after.counts)
    .map(table => ({ table, before: before.counts[table]!, after: after.counts[table]! }))
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

  const integrity = [
    ...before.integrity.filter(c => c.violations > 0).map(c => ({ code: c.code, side: 'before' as const, violations: c.violations })),
    ...after.integrity.filter(c => c.violations > 0).map(c => ({ code: c.code, side: 'after' as const, violations: c.violations })),
  ];

  const notes: string[] = [];
  if (before.database.name === after.database.name) notes.push('сравниваются снимки одной и той же базы — для проверки восстановления нужна отдельная цель');
  notes.push('контрольные числа сравнивают количества; совпадение содержимого проверяет release:manifest');

  const equal =
    migrations.length === 0 &&
    missingTables.length === 0 &&
    skippedIntegrity.length === 0 &&
    counts.length === 0 &&
    sources.length === 0 &&
    reviews.length === 0 &&
    snapshots.length === 0 &&
    integrity.length === 0;
  return { equal, incompatible: null, migrations, missingTables, skippedIntegrity, counts, sources, reviews, snapshots, integrity, notes };
};

/** Проблемы одного снимка контрольных чисел, из-за которых release:check завершается с ошибкой. */
export const inventoryProblems = (inv: IInventory): string[] => [
  ...inv.missingTables.map(t => `нет таблицы ${t}`),
  ...inv.skippedIntegrity.map(c => `проверка связности ${c} не выполнена`),
  ...inv.integrity.filter(c => c.violations > 0).map(c => `связность ${c.code}: нарушений ${c.violations}`),
];
