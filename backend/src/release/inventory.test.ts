// T10-02/T10-03/T10-08/T10-09 (закрытие приёмки 09): быстрое сравнение контрольных чисел без базы.

import { describe, expect, it } from 'vitest';

import { COUNTED_TABLES, INVENTORY_VERSION, diffInventory, inventoryProblems, type IInventory } from './inventory.js';

const base = (overrides: Partial<IInventory> = {}): IInventory => ({
  version: INVENTORY_VERSION,
  takenAt: '2026-09-16T10:00:00.000Z',
  database: { name: 'tg_info_test', host: '127.0.0.1', port: 5432, isTestTarget: true },
  migrations: { applied: 20, last: '020_dossier_snapshots.sql' },
  counts: Object.fromEntries(COUNTED_TABLES.map(t => [t, t === 'dossier_snapshots' ? 2 : 0])),
  missingTables: [],
  skippedIntegrity: [],
  integrity: [{ code: 'evidence_without_revision', description: '', violations: 0 }],
  sources: [{ key: 's1', kind: 'telegram', status: 'paused', accessStatus: 'approved', aiProcessingStatus: 'approved', isSynthetic: true, items: 3, lastRunAt: null }],
  reviews: { total: 1, byDecision: { reviewed_supported: 1 } },
  snapshots: { total: 2, redacted: 0, hashAlgorithms: ['sha256-canonical-json@1'] },
  flags: { INGEST_ENABLED: false },
  ...overrides,
});

describe('diffInventory', () => {
  it('одинаковые снимки разных баз совпадают; время и имя базы не расхождение', () => {
    const after = base({ takenAt: '2026-09-17T00:00:00.000Z', database: { name: 'tg_info_test_restore', host: '127.0.0.1', port: 5432, isTestTarget: true } });
    const diff = diffInventory(base(), after);
    expect(diff.equal).toBe(true);
    expect(diff.incompatible).toBeNull();
  });

  it('R06: другая последняя миграция при прежних количествах — не совпадение', () => {
    const diff = diffInventory(base(), base({ migrations: { applied: 19, last: '019_dossier_cases.sql' } }));
    expect(diff.equal).toBe(false);
    expect(diff.migrations.map(m => m.field)).toEqual(['применено', 'последняя']);
  });

  it('R07: отсутствующая таблица не равна пустой', () => {
    const { merge_queue: _removed, ...counts } = base().counts;
    const after = base({ counts, missingTables: ['merge_queue'] });
    expect(base().counts.merge_queue).toBe(0);
    const diff = diffInventory(base(), after);
    expect(diff.equal).toBe(false);
    expect(diff.missingTables).toEqual([{ table: 'merge_queue', side: 'after' }]);
    expect(diff.counts).toEqual([]);
  });

  it('пропущенная проверка связности — не PASS', () => {
    const diff = diffInventory(base(), base({ skippedIntegrity: ['snapshot_without_case'] }));
    expect(diff.equal).toBe(false);
  });

  it('нарушения связности в сохранённом снимке тоже видны', () => {
    const broken = base({ integrity: [{ code: 'evidence_without_revision', description: '', violations: 2 }] });
    const diff = diffInventory(broken, base());
    expect(diff.equal).toBe(false);
    expect(diff.integrity).toEqual([{ code: 'evidence_without_revision', side: 'before', violations: 2 }]);
  });

  it('T10-09: формат другой версии — несовместим, а не совпадение', () => {
    const old = { ...base(), version: 'local-inventory@1' };
    const diff = diffInventory(old, base());
    expect(diff.equal).toBe(false);
    expect(diff.incompatible).toMatch(/local-inventory@1/);
  });

  it('счётчики не доказывают содержимое: примечание указывает на release:manifest', () => {
    expect(diffInventory(base(), base()).notes.some(n => n.includes('release:manifest'))).toBe(true);
  });
});

describe('inventoryProblems', () => {
  it('здоровый снимок — проблем нет', () => {
    expect(inventoryProblems(base())).toEqual([]);
  });

  it('отсутствующая таблица, пропущенная и нарушенная проверки дают ненулевой код', () => {
    const problems = inventoryProblems(
      base({ missingTables: ['http_cache'], skippedIntegrity: ['x'], integrity: [{ code: 'identifier_conflict', description: '', violations: 1 }] }),
    );
    expect(problems).toHaveLength(3);
  });
});
