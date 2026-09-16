// T10-01/T10-06/T10-09 (закрытие приёмки 09): содержательный manifest без базы. Строки задаются так,
// как их отдаёт PostgreSQL в режиме ::text; проверяется, что изменение содержимого при прежнем числе строк
// меняет fingerprint, а законные различия (порядок, имя restore-базы, время) — нет.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../db/migrate.js';
import { payloadHash } from '../snapshot/canonical.js';
import {
  checkSnapshotRows,
  columnsDigest,
  diffManifest,
  manifestProblems,
  pickConfig,
  rowDigest,
  sectionDigest,
  sequencesBehindData,
  tableDigest,
  type IContentManifest,
  type TextRow,
} from './manifest.js';
import { CONFIG_DENYLIST, MANIFEST_VERSION, NOT_FINGERPRINTED, ROW_SERIALIZATION, TABLE_SPECS } from './manifestSpec.js';

const fp = (columns: string[], rows: TextRow[]) => {
  const columnsHash = columnsDigest(columns.map(c => [c, 'text'] as const));
  return { class: 'domain' as const, rows: rows.length, columns: columns.length, columnsHash, digest: tableDigest(columnsHash, rows.map(rowDigest)) };
};

const REVISIONS = ['body', 'id', 'revision_no'];
const EVIDENCE = ['assertion_id', 'id', 'quote', 'span_end', 'span_start'];
const REVIEWS = ['assertion_id', 'decided_at', 'decision', 'id', 'reason', 'reviewer'];
const SOURCES = ['access_status', 'ai_processing_status', 'cursor', 'id', 'key', 'policy_basis'];

const revisions: TextRow[] = [
  ['ООО «Альфа» (ИНН 7707083893) ведёт монтаж ВК корпуса 2.', '1', '1'],
  ['Правка: монтаж ВК корпуса 2 завершён.', '2', '2'],
];
const evidence: TextRow[] = [['10', '100', 'ведёт монтаж ВК корпуса 2', '42', '17']];
const reviews: TextRow[] = [['10', '2026-09-16 10:00:00.123456+00', 'reviewed_supported', '1', 'договор субподряда', 'analyst']];
const sources: TextRow[] = [['approved', 'approved', '{"tg": {"gap": null, "lastPostId": 120}}', '1', 'demo_channel', 'синтетический тест']];

const payload = { case: { id: 1, version: 2 }, company: { name: 'Альфа' }, evidence: [{ id: 100, quote: 'ведёт монтаж ВК корпуса 2' }] };

const manifest = (overrides: {
  revisions?: TextRow[];
  evidence?: TextRow[];
  reviews?: TextRow[];
  sources?: TextRow[];
  lastValue?: string;
  snapshotPayload?: unknown;
  database?: string;
  takenAt?: string;
  config?: Record<string, string>;
} = {}): IContentManifest => ({
  version: MANIFEST_VERSION,
  serialization: ROW_SERIALIZATION,
  meta: { takenAt: overrides.takenAt ?? '2026-09-16T10:00:00.000Z', database: overrides.database ?? 'tg_info_test', isTestTarget: true, node: 'v24' },
  tables: {
    document_revisions: fp(REVISIONS, overrides.revisions ?? revisions),
    evidence: fp(EVIDENCE, overrides.evidence ?? evidence),
    review_decisions: fp(REVIEWS, overrides.reviews ?? reviews),
    sources: fp(SOURCES, overrides.sources ?? sources),
  },
  unclassifiedTables: [],
  missingTables: [],
  schema: { columns: sectionDigest([['evidence', 'r', 'quote', 'text', 'true', null, '', '']]) },
  migrations: { registryExists: true, applied: 20, digest: sectionDigest([['020_dossier_snapshots.sql']]).digest, pendingInCode: [], unknownInDb: [] },
  sequences: {
    states: [{ sequence: 'dossier_snapshots_id_seq', table: 'dossier_snapshots', column: 'id', lastValue: overrides.lastValue ?? '3', maxValue: '3' }],
    behindData: [],
  },
  snapshots: checkSnapshotRows(
    [{ id: '1', payload: overrides.snapshotPayload ?? payload, payloadHash: payloadHash(payload), hashAlgorithm: 'sha256-canonical-json@1' }],
    [],
  ),
  integrity: { checks: [{ code: 'evidence_without_revision', description: '', violations: 0 }], skipped: [] },
  config: overrides.config ?? { INGEST_ENABLED: 'false', PIPELINE_ENABLED: 'false', GRAPH_EXPORT_ENABLED: 'true' },
  notFingerprinted: NOT_FINGERPRINTED,
});

const codes = (before: IContentManifest, after: IContentManifest) => diffManifest(before, after).problems.map(p => `${p.code}:${p.subject.split(':')[0]}`);

describe('перечень таблиц manifest', () => {
  it('каждая таблица из миграций 001–020 классифицирована, лишних нет', () => {
    const created = new Set<string>(['schema_migrations']);
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(/gi)) created.add(m[1]!.toLowerCase());
    }
    expect(TABLE_SPECS.map(s => s.table).sort()).toEqual([...created].sort());
    expect(TABLE_SPECS.every(s => s.why.length > 0)).toBe(true);
  });
});

describe('сериализация строк (pg-text-row@1)', () => {
  it('порядок строк не влияет на fingerprint таблицы', () => {
    expect(fp(REVISIONS, [...revisions].reverse()).digest).toBe(fp(REVISIONS, revisions).digest);
  });

  it('NULL отличается от пустой строки', () => {
    expect(rowDigest([null, '1'])).not.toBe(rowDigest(['', '1']));
  });

  it('большие int8/numeric сравниваются как текст без потери точности', () => {
    expect(rowDigest(['9007199254740993'])).not.toBe(rowDigest(['9007199254740992']));
    expect(rowDigest(['0.30000000000000004'])).not.toBe(rowDigest(['0.3']));
  });

  it('timestamp различается до микросекунды', () => {
    expect(rowDigest(['2026-09-16 10:00:00.123456+00'])).not.toBe(rowDigest(['2026-09-16 10:00:00.123457+00']));
  });

  it('Unicode не нормализуется: NFC и NFD — разные цитаты', () => {
    const nfc = 'корпус й'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(rowDigest([nfc])).not.toBe(rowDigest([nfd]));
  });

  it('границы колонок сохраняются: перенос текста между колонками меняет fingerprint', () => {
    expect(rowDigest(['ab', 'c'])).not.toBe(rowDigest(['a', 'bc']));
  });

  it('раздел схемы не зависит от порядка строк', () => {
    expect(sectionDigest([['a'], ['b']]).digest).toBe(sectionDigest([['b'], ['a']]).digest);
  });
});

describe('diffManifest: изменение содержимого при прежнем числе строк', () => {
  it('одинаковые данные в другой базе и в другое время — MATCH', () => {
    const diff = diffManifest(manifest(), manifest({ database: 'tg_info_test_restore', takenAt: '2026-09-17T08:00:00.000Z' }));
    expect(diff).toEqual({ verdict: 'MATCH', problems: [] });
  });

  it('текст редакции', () => {
    const changed = [revisions[0]!, ['Правка: монтаж ВК корпуса 3 завершён.', '2', '2'] as TextRow];
    expect(codes(manifest(), manifest({ revisions: changed }))).toEqual(['TABLE_CONTENT:document_revisions']);
  });

  it('реквизит внутри текста', () => {
    const changed = [['ООО «Альфа» (ИНН 7707083894) ведёт монтаж ВК корпуса 2.', '1', '1'] as TextRow, revisions[1]!];
    expect(diffManifest(manifest(), manifest({ revisions: changed })).verdict).toBe('MISMATCH');
  });

  it('цитата evidence', () => {
    expect(codes(manifest(), manifest({ evidence: [['10', '100', 'не ведёт монтаж ВК корпуса 2', '42', '17']] }))).toEqual(['TABLE_CONTENT:evidence']);
  });

  it('решение аналитика и его атрибуция', () => {
    expect(codes(manifest(), manifest({ reviews: [['10', '2026-09-16 10:00:00.123456+00', 'reviewed_rejected', '1', 'договор субподряда', 'analyst']] }))).toEqual(['TABLE_CONTENT:review_decisions']);
    expect(codes(manifest(), manifest({ reviews: [['10', '2026-09-16 10:00:00.123456+00', 'reviewed_supported', '1', 'договор субподряда', 'someone-else']] }))).toEqual(['TABLE_CONTENT:review_decisions']);
  });

  it('допуск источника', () => {
    expect(codes(manifest(), manifest({ sources: [['approved', 'revoked', sources[0]![2]!, '1', 'demo_channel', 'синтетический тест']] }))).toEqual(['TABLE_CONTENT:sources']);
  });

  it('состояние последовательности', () => {
    expect(codes(manifest(), manifest({ lastValue: '7' }))).toEqual(['SEQUENCE_DIFFERS:dossier_snapshots_id_seq']);
  });

  it('payload снимка изменён при прежнем хранимом hash — ошибка целостности', () => {
    const tampered = { ...payload, company: { name: 'Бета' } };
    const diff = diffManifest(manifest(), manifest({ snapshotPayload: tampered }));
    expect(diff.verdict).toBe('MISMATCH');
    expect(diff.problems.map(p => p.code)).toContain('SNAPSHOT_HASH_MISMATCH');
  });

  it('разные параметры окружения и включённый фон после восстановления видны отдельно', () => {
    const diff = diffManifest(manifest(), manifest({ config: { INGEST_ENABLED: 'true', PIPELINE_ENABLED: 'false', GRAPH_EXPORT_ENABLED: 'true' } }));
    expect(diff.problems.map(p => p.code).sort()).toEqual(['BACKGROUND_ENABLED', 'CONFIG_MISMATCH']);
  });
});

describe('diffManifest: форма и полнота', () => {
  it('другая версия формата — INCOMPATIBLE', () => {
    expect(diffManifest({ ...manifest(), version: 'content-manifest@0' }, manifest()).verdict).toBe('INCOMPATIBLE');
    expect(diffManifest({ ...manifest(), serialization: 'pg-text-row@0' }, manifest()).verdict).toBe('INCOMPATIBLE');
    // Старый local-inventory@2 — не manifest.
    expect(diffManifest({ version: 'local-inventory@2' } as Partial<IContentManifest>, manifest()).verdict).toBe('INCOMPATIBLE');
  });

  it('пропущенный раздел — INCOMPLETE, а не MATCH', () => {
    const { sequences: _s, ...partial } = manifest();
    const diff = diffManifest(partial, manifest());
    expect(diff.verdict).toBe('INCOMPLETE');
    expect(diff.problems[0]!.subject).toMatch(/sequences/);
  });

  it('отсутствующая и неклассифицированная таблицы — проблемы', () => {
    const m = { ...manifest(), missingTables: ['http_cache'], unclassifiedTables: ['new_table'] };
    expect(manifestProblems(m).map(p => p.code).sort()).toEqual(['MISSING_TABLE', 'UNCLASSIFIED_TABLE']);
    expect(diffManifest(manifest(), m).verdict).toBe('MISMATCH');
  });

  it('таблица есть только с одной стороны', () => {
    const { evidence: _e, ...tables } = manifest().tables;
    expect(codes(manifest(), { ...manifest(), tables })).toEqual(['TABLE_PRESENCE:evidence']);
  });

  it('неприменённая миграция и пропущенная проверка связности — не PASS', () => {
    const m = manifest();
    const broken = { ...m, migrations: { ...m.migrations, pendingInCode: ['021_x.sql'] }, integrity: { checks: m.integrity.checks, skipped: ['snapshot_without_case'] } };
    expect(manifestProblems(broken).map(p => p.code)).toEqual(['PENDING_MIGRATION', 'INTEGRITY_SKIPPED']);
  });
});

describe('снимки и последовательности', () => {
  it('цепочка вымарываний: последний hash_after равен текущему hash', () => {
    const h = payloadHash(payload);
    const ok = checkSnapshotRows([{ id: '1', payload, payloadHash: h, hashAlgorithm: 'sha256-canonical-json@1' }], [
      { snapshotId: '1', hashBefore: 'a', hashAfter: 'b' },
      { snapshotId: '1', hashBefore: 'b', hashAfter: h },
    ]);
    expect(ok.redactionChainBroken).toEqual([]);
    const broken = checkSnapshotRows([{ id: '1', payload, payloadHash: h, hashAlgorithm: 'sha256-canonical-json@1' }], [
      { snapshotId: '1', hashBefore: 'a', hashAfter: 'b' },
      { snapshotId: '1', hashBefore: 'c', hashAfter: h },
    ]);
    expect(broken.redactionChainBroken).toEqual(['1']);
  });

  it('неизвестный алгоритм hash не считается проверенным', () => {
    expect(checkSnapshotRows([{ id: '5', payload, payloadHash: 'x', hashAlgorithm: 'md5' }], []).unknownAlgorithm).toEqual(['5']);
  });

  it('последовательность, отставшая от данных, видна (BigInt за пределами 2^53)', () => {
    expect(
      sequencesBehindData([
        { sequence: 'a', table: 't', column: 'id', lastValue: '9007199254740993', maxValue: '9007199254740994' },
        { sequence: 'b', table: 't', column: 'id', lastValue: null, maxValue: '1' },
        { sequence: 'c', table: 't', column: 'id', lastValue: null, maxValue: null },
        { sequence: 'd', table: 't', column: 'id', lastValue: '10', maxValue: '10' },
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('manifest не содержит секретов и текстов', () => {
  it('pickConfig берёт только разрешённые ключи; секреты-маркеры не попадают в JSON', () => {
    const source: Record<string, unknown> = {
      INGEST_ENABLED: false,
      LMSTUDIO_MODEL: 'qwen3-8b',
      DATABASE_URL: 'postgresql://u:MarkerDbPw-5521@127.0.0.1:5432/x',
      OPERATOR_TOKEN: 'marker-operator-token-8812',
      TG_BOT_TOKEN: 'marker-bot-token-3391',
      LMSTUDIO_BASE_URL: 'http://marker-llm-host:1234/v1',
    };
    const config = pickConfig(source);
    expect(config).toEqual({ INGEST_ENABLED: 'false', LMSTUDIO_MODEL: 'qwen3-8b' });
    for (const key of CONFIG_DENYLIST) expect(config).not.toHaveProperty(key);
    const json = JSON.stringify({ ...manifest(), config });
    for (const marker of ['MarkerDbPw-5521', 'marker-operator-token-8812', 'marker-bot-token-3391', 'marker-llm-host']) expect(json).not.toContain(marker);
    // Тексты редакций и цитаты в manifest не попадают — только хеши.
    expect(json).not.toContain('монтаж');
    expect(json).not.toContain('7707083893');
  });
});
