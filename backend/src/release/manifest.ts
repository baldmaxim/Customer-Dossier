// Содержательный manifest базы (content-manifest@1): fingerprint реального содержимого строк, схемы,
// реестра миграций, последовательностей и целостности снимков. Нужен, чтобы доказательство восстановления
// замечало замену цитаты, реквизита, решения или payload при прежнем числе строк.
//
// Здесь — формат и чистые функции (сериализация, хеши, сравнение). Чтение базы — manifestCollect.ts.
// В manifest попадают только имена, количества и хеши; тексты, реквизиты и значения секретов — никогда.

import { createHash } from 'node:crypto';

import { HASH_ALGORITHM, payloadHash } from '../snapshot/canonical.js';
import type { IIntegrityCheck } from './inventory.js';
import {
  BACKGROUND_FLAGS,
  CONFIG_KEYS,
  MANIFEST_VERSION,
  ROW_SERIALIZATION,
  type TableClass,
} from './manifestSpec.js';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Строка — массив текстовых представлений колонок в порядке имён колонок (pg-text-row@1).
 * Значения приходят из PostgreSQL как `::text` при фиксированных TimeZone/DateStyle/extra_float_digits/bytea_output,
 * поэтому точность int8/numeric/timestamp не теряется, NULL остаётся null и отличается от пустой строки,
 * Unicode не нормализуется (NFC и NFD — разные строки).
 */
export type TextRow = ReadonlyArray<string | null>;

export const rowDigest = (row: TextRow): string => sha256(JSON.stringify(row));

export const columnsDigest = (columns: ReadonlyArray<readonly [name: string, type: string]>): string => sha256(JSON.stringify(columns));

/** Fingerprint таблицы: не зависит от порядка выборки строк (мультимножество дайджестов). */
export const tableDigest = (columnsHash: string, rowDigests: readonly string[]): string =>
  sha256(`${columnsHash}\n${rowDigests.length}\n${[...rowDigests].sort().join('\n')}`);

/** Fingerprint раздела схемы: строки уже упорядочены запросом, но сортируем повторно ради независимости. */
export const sectionDigest = (rows: readonly TextRow[]): { count: number; digest: string } => ({
  count: rows.length,
  digest: sha256(rows.map(r => JSON.stringify(r)).sort().join('\n')),
});

export interface ITableFingerprint {
  class: TableClass;
  rows: number;
  columns: number;
  columnsHash: string;
  digest: string;
}

export interface ISequenceState {
  sequence: string;
  table: string | null;
  column: string | null;
  lastValue: string | null;
  maxValue: string | null;
}

export interface ISnapshotRow {
  id: string;
  payload: unknown;
  payloadHash: string;
  hashAlgorithm: string;
}

export interface IRedactionRow {
  snapshotId: string;
  hashBefore: string;
  hashAfter: string;
}

export interface IContentManifest {
  version: string;
  serialization: string;
  /** Метаданные прогона: законно различаются между baseline и restore и не сравниваются. */
  meta: { takenAt: string; database: string; isTestTarget: boolean; node: string };
  tables: Record<string, ITableFingerprint>;
  unclassifiedTables: string[];
  missingTables: string[];
  schema: Record<string, { count: number; digest: string }>;
  migrations: { registryExists: boolean; applied: number; digest: string; pendingInCode: string[]; unknownInDb: string[] };
  sequences: { states: ISequenceState[]; behindData: string[] };
  snapshots: { total: number; hashMismatch: string[]; unknownAlgorithm: string[]; redactionChainBroken: string[] };
  integrity: { checks: IIntegrityCheck[]; skipped: string[] };
  config: Record<string, string>;
  notFingerprinted: ReadonlyArray<{ object: string; why: string }>;
}

export const REQUIRED_SECTIONS = ['tables', 'schema', 'migrations', 'sequences', 'snapshots', 'integrity', 'config'] as const;

/** Только разрешённые не-секретные параметры; всё прочее (включая denylist) в manifest не попадает. */
export const pickConfig = (source: Readonly<Record<string, unknown>>): Record<string, string> =>
  Object.fromEntries(CONFIG_KEYS.filter(k => source[k] !== undefined).map(k => [k, String(source[k])]));

/** Сверка хранимого hash снимка с пересчитанным по контракту; хранимому значению не доверяем. */
export const checkSnapshotRows = (
  rows: readonly ISnapshotRow[],
  redactions: readonly IRedactionRow[],
): IContentManifest['snapshots'] => {
  const hashMismatch: string[] = [];
  const unknownAlgorithm: string[] = [];
  const current = new Map<string, string>();
  for (const row of rows) {
    current.set(row.id, row.payloadHash);
    if (row.hashAlgorithm !== HASH_ALGORITHM) {
      unknownAlgorithm.push(row.id);
      continue;
    }
    if (payloadHash(row.payload) !== row.payloadHash) hashMismatch.push(row.id);
  }
  // Цепочка вымарываний: каждое следующее начинается с hash предыдущего, последнее даёт текущий hash.
  const bySnapshot = new Map<string, IRedactionRow[]>();
  for (const r of redactions) bySnapshot.set(r.snapshotId, [...(bySnapshot.get(r.snapshotId) ?? []), r]);
  const redactionChainBroken: string[] = [];
  for (const [id, chain] of bySnapshot) {
    const ok =
      current.has(id) &&
      chain.every((r, i) => i === 0 || r.hashBefore === chain[i - 1]!.hashAfter) &&
      chain[chain.length - 1]!.hashAfter === current.get(id);
    if (!ok) redactionChainBroken.push(id);
  }
  return { total: rows.length, hashMismatch, unknownAlgorithm, redactionChainBroken };
};

/** Последовательность отстала от данных: следующая вставка упадёт на уникальности. Сравнение как BigInt. */
export const sequencesBehindData = (states: readonly ISequenceState[]): string[] =>
  states
    .filter(s => s.maxValue !== null && (s.lastValue === null || BigInt(s.maxValue) > BigInt(s.lastValue)))
    .map(s => s.sequence);

export interface IManifestProblem {
  section: string;
  code: string;
  subject: string;
}

/** Проблемы одного manifest (без сравнения): пропуски, расхождение с кодом, нарушения целостности. */
export const manifestProblems = (m: IContentManifest, side = ''): IManifestProblem[] => {
  const p: IManifestProblem[] = [];
  const at = (s: string) => (side ? `${s} (${side})` : s);
  for (const t of m.unclassifiedTables) p.push({ section: 'tables', code: 'UNCLASSIFIED_TABLE', subject: at(t) });
  for (const t of m.missingTables) p.push({ section: 'tables', code: 'MISSING_TABLE', subject: at(t) });
  if (!m.migrations.registryExists) p.push({ section: 'migrations', code: 'REGISTRY_MISSING', subject: at('schema_migrations') });
  for (const f of m.migrations.pendingInCode) p.push({ section: 'migrations', code: 'PENDING_MIGRATION', subject: at(f) });
  for (const f of m.migrations.unknownInDb) p.push({ section: 'migrations', code: 'UNKNOWN_MIGRATION', subject: at(f) });
  for (const s of m.sequences.behindData) p.push({ section: 'sequences', code: 'SEQUENCE_BEHIND_DATA', subject: at(s) });
  for (const id of m.snapshots.hashMismatch) p.push({ section: 'snapshots', code: 'SNAPSHOT_HASH_MISMATCH', subject: at(`снимок ${id}`) });
  for (const id of m.snapshots.unknownAlgorithm) p.push({ section: 'snapshots', code: 'SNAPSHOT_UNKNOWN_ALGORITHM', subject: at(`снимок ${id}`) });
  for (const id of m.snapshots.redactionChainBroken) p.push({ section: 'snapshots', code: 'REDACTION_CHAIN_BROKEN', subject: at(`снимок ${id}`) });
  for (const c of m.integrity.checks.filter(c => c.violations > 0)) p.push({ section: 'integrity', code: 'INTEGRITY_VIOLATION', subject: at(`${c.code}=${c.violations}`) });
  for (const c of m.integrity.skipped) p.push({ section: 'integrity', code: 'INTEGRITY_SKIPPED', subject: at(c) });
  return p;
};

export type ManifestVerdict = 'MATCH' | 'MISMATCH' | 'INCOMPLETE' | 'INCOMPATIBLE';

export interface IManifestDiff {
  verdict: ManifestVerdict;
  problems: IManifestProblem[];
}

const missingSections = (m: Partial<IContentManifest>): string[] => REQUIRED_SECTIONS.filter(s => m[s] === undefined || m[s] === null);

/**
 * Сравнение baseline и восстановленной копии. Метаданные (время, имя базы, машина) не сравниваются;
 * содержимое строк, схема, миграции, последовательности, снимки, связность и параметры — сравниваются.
 */
export const diffManifest = (before: Partial<IContentManifest>, after: Partial<IContentManifest>): IManifestDiff => {
  if (before.version !== MANIFEST_VERSION || after.version !== MANIFEST_VERSION || before.serialization !== ROW_SERIALIZATION || after.serialization !== ROW_SERIALIZATION) {
    return {
      verdict: 'INCOMPATIBLE',
      problems: [{ section: 'version', code: 'INCOMPATIBLE', subject: `${before.version}/${before.serialization} ↔ ${after.version}/${after.serialization}, ожидается ${MANIFEST_VERSION}/${ROW_SERIALIZATION}` }],
    };
  }
  const absent = [...missingSections(before).map(s => `${s} (сохранённый)`), ...missingSections(after).map(s => `${s} (текущий)`)];
  if (absent.length > 0) {
    return { verdict: 'INCOMPLETE', problems: absent.map(subject => ({ section: 'sections', code: 'SECTION_MISSING', subject })) };
  }
  const b = before as IContentManifest;
  const a = after as IContentManifest;
  const problems: IManifestProblem[] = [...manifestProblems(b, 'сохранённый'), ...manifestProblems(a, 'текущий')];

  for (const table of [...new Set([...Object.keys(b.tables), ...Object.keys(a.tables)])].sort()) {
    const x = b.tables[table];
    const y = a.tables[table];
    if (!x || !y) {
      problems.push({ section: 'tables', code: 'TABLE_PRESENCE', subject: `${table}: ${x ? 'нет в текущем' : 'нет в сохранённом'}` });
      continue;
    }
    if (x.columnsHash !== y.columnsHash) problems.push({ section: 'tables', code: 'TABLE_COLUMNS', subject: table });
    if (x.rows !== y.rows) problems.push({ section: 'tables', code: 'TABLE_ROWS', subject: `${table}: было ${x.rows}, стало ${y.rows}` });
    else if (x.digest !== y.digest) problems.push({ section: 'tables', code: 'TABLE_CONTENT', subject: `${table}: строк ${y.rows}, содержимое отличается` });
  }

  for (const section of [...new Set([...Object.keys(b.schema), ...Object.keys(a.schema)])].sort()) {
    if (b.schema[section]?.digest !== a.schema[section]?.digest) problems.push({ section: 'schema', code: 'SCHEMA_DIFFERS', subject: section });
  }

  if (b.migrations.digest !== a.migrations.digest || b.migrations.applied !== a.migrations.applied) {
    problems.push({ section: 'migrations', code: 'MIGRATIONS_DIFFER', subject: `применено ${b.migrations.applied} → ${a.migrations.applied}` });
  }

  const seqAfter = new Map(a.sequences.states.map(s => [s.sequence, s]));
  const seqNames = new Set([...b.sequences.states.map(s => s.sequence), ...a.sequences.states.map(s => s.sequence)]);
  for (const name of [...seqNames].sort()) {
    const x = b.sequences.states.find(s => s.sequence === name);
    const y = seqAfter.get(name);
    if (!x || !y || x.lastValue !== y.lastValue) {
      problems.push({ section: 'sequences', code: 'SEQUENCE_DIFFERS', subject: `${name}: ${x?.lastValue ?? 'нет'} → ${y?.lastValue ?? 'нет'}` });
    }
  }

  if (b.snapshots.total !== a.snapshots.total) problems.push({ section: 'snapshots', code: 'SNAPSHOT_COUNT', subject: `${b.snapshots.total} → ${a.snapshots.total}` });

  for (const key of [...new Set([...Object.keys(b.config), ...Object.keys(a.config)])].sort()) {
    if (b.config[key] !== a.config[key]) problems.push({ section: 'config', code: 'CONFIG_MISMATCH', subject: `${key}: ${b.config[key] ?? 'нет'} → ${a.config[key] ?? 'нет'}` });
  }
  for (const flag of BACKGROUND_FLAGS) {
    if (a.config[flag] === 'true') problems.push({ section: 'config', code: 'BACKGROUND_ENABLED', subject: `${flag}=true при проверке восстановления` });
  }

  return { verdict: problems.length === 0 ? 'MATCH' : 'MISMATCH', problems };
};
