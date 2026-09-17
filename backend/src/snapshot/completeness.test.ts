// Этап 13 без БД: идентичность запроса снимка (R08), покрытие выборок, чтение состояния сигналов через переданный
// исполнитель, различие усечения загрузки схемы и лимита узлов. Гонки на PostgreSQL — snapshot.int.test.ts (пользователь).

import { describe, expect, it } from 'vitest';

import type { DbExecutor } from '../db/pool.js';
import { buildCaseDossier } from '../dossier/caseDossier.js';
import { coverageOf } from '../dossier/facts.js';
import { buildGraph, type IGraphEdge, type IGraphLoader, type NodeKey } from '../graph/graph.js';
import { refreshState } from '../signals/refresh.js';
import { SnapshotKeyConflictError, sameSnapshotRequest, snapshotRequestHash } from './requestIdentity.js';

describe('snapshot-request@1 (R08, T13-01)', () => {
  const a = { caseId: 1, effectiveFrom: null, effectiveTo: null };

  it('тот же запрос — тот же hash; другое обращение или период — другой', () => {
    expect(snapshotRequestHash(a)).toBe(snapshotRequestHash({ ...a }));
    expect(snapshotRequestHash({ ...a, caseId: 2 })).not.toBe(snapshotRequestHash(a));
    expect(snapshotRequestHash({ ...a, effectiveFrom: '2026-01-01' })).not.toBe(snapshotRequestHash(a));
  });

  it('R08: ключ снимка обращения A при запросе B — не совпадение', () => {
    const stored = { requestHash: snapshotRequestHash(a), caseId: 1, effectiveFrom: null, effectiveTo: null };
    expect(sameSnapshotRequest(stored, a)).toBe(true);
    expect(sameSnapshotRequest(stored, { ...a, caseId: 2 })).toBe(false);
    expect(new SnapshotKeyConflictError().message).toMatch(/новый ключ/);
  });

  it('T13-11: снимок до этапа 13 без request_hash сверяется только по сохранённым параметрам', () => {
    const legacy = { requestHash: null, caseId: 1, effectiveFrom: '2026-01-01', effectiveTo: null };
    expect(sameSnapshotRequest(legacy, { caseId: 1, effectiveFrom: '2026-01-01', effectiveTo: null })).toBe(true);
    expect(sameSnapshotRequest(legacy, { caseId: 1, effectiveFrom: null, effectiveTo: null })).toBe(false);
    expect(sameSnapshotRequest(legacy, { caseId: 3, effectiveFrom: '2026-01-01', effectiveTo: null })).toBe(false);
  });
});

describe('coverage@1 (T13-08)', () => {
  it('в пределах лимита — полная выборка с известным total', () => {
    expect(coverageOf('company_facts', 1000, 12, null)).toEqual({ source: 'company_facts', limit: 1000, loaded: 12, total: 12, truncated: false });
  });

  it('1001 из лимита 1000 — усечено, total известен только если посчитан', () => {
    expect(coverageOf('company_facts', 1000, 1001, 1500)).toEqual({ source: 'company_facts', limit: 1000, loaded: 1000, total: 1500, truncated: true });
    expect(coverageOf('company_facts', 1000, 1001, null).total).toBeNull();
  });

  it('усечённая выборка не формулирует «сведений не найдено» как полный вывод', () => {
    const base = {
      caseRow: {
        id: 1, title: 't', companyStatus: 'identified', companyId: 10, companyName: 'А', companyNameClaimed: null, projectId: 20, projectName: 'Б',
        projectNameClaimed: null, scopeBuilding: null, workPackage: null, workPackageLabel: null, claimedRole: null, claimedClientCompanyId: null,
        claimedClientCompanyName: null, claimedClientName: null, claimedTerms: null, requestDate: '2026-09-15', operatorNote: null, status: 'open',
        provenance: 'operator_recorded_claim', version: 1, createdBy: 'op', createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z',
      },
      generatedAt: '2026-09-15T00:00:00Z',
      refresh: { active: null, lastFailure: null, running: false, stale: false, staleReasons: [] },
      identityStatus: null, homonyms: [], companyFacts: [], projectFacts: [], projectState: [], openQueue: [],
    } as Parameters<typeof buildCaseDossier>[0];
    const truncated = buildCaseDossier({ ...base, coverage: [coverageOf('company_facts', 1000, 1001, null)] });
    expect(truncated.observations[0]!.code).toBe('nothing_found_in_loaded');
    expect(truncated.uncertainties.map(u => u.code)).toContain('selection_truncated_company_facts');
    expect(truncated.coverage![0]!.truncated).toBe(true);
    const full = buildCaseDossier({ ...base, coverage: [coverageOf('company_facts', 1000, 3, null)] });
    expect(full.observations[0]!.code).toBe('nothing_found');
    expect(buildCaseDossier(base)).not.toHaveProperty('coverage');
  });
});

describe('T13-04: состояние сигналов читается переданным исполнителем транзакции', () => {
  it('все запросы refreshState идут в переданный executor', async () => {
    const seen: string[] = [];
    const exec = {
      query: async (sql: string) => {
        seen.push(sql);
        if (sql.includes('signal_active_refresh_v')) return { rows: [{ id: 5, rules_version: 'signals@1', cutoff_at: new Date('2026-09-15T00:00:00Z'), finished_at: new Date('2026-09-15T00:00:01Z') }], rowCount: 1 };
        if (sql.includes('AS changed')) return { rows: [{ changed: false }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    } as unknown as DbExecutor;
    const state = await refreshState(exec);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(state.active?.id).toBe(5);
  });
});

describe('T13-09: усечение загрузки связей отличается от лимита узлов', () => {
  const edge = (i: number): IGraphEdge => ({
    key: `a:${i}`, type: 'participation', from: 'c:1', to: `p:${i}` as NodeKey, assertionId: i, role: 'contractor', building: null, workPackage: null,
    validFrom: null, validTo: null, periodPrecision: 'unknown', status: 'text_grounded', polarity: 'positive', modality: 'reported_fact',
    supports: 1, contradicts: 0, contextProjectId: null, details: [],
  });
  const loader = (edges: IGraphEdge[], truncations: string[]): IGraphLoader => ({
    truncations: new Set(truncations),
    nodes: async keys => keys.map(k => ({ key: k, kind: k.startsWith('c:') ? 'company' : 'project', id: Number(k.slice(2)), label: k, subtype: null, details: [], depth: 0, seed: false }) as never),
    edges: async () => edges,
  });

  it('предел загрузки отмечен отдельно и не выдаётся за лимит узлов', async () => {
    const g = await buildGraph(['c:1'], { depth: 1, limit: 150 }, loader([edge(2)], ['assertions']));
    expect(g.truncated).toBe(false);
    expect(g.loaderTruncated).toEqual(['assertions']);
    expect(g.notes.join(' ')).toMatch(/Загрузка связей ограничена \(assertions\)/);
  });

  it('лимит узлов без усечения загрузки', async () => {
    const g = await buildGraph(['c:1'], { depth: 1, limit: 2 }, loader([edge(2), edge(3), edge(4)], []));
    expect(g.truncated).toBe(true);
    expect(g.loaderTruncated).toEqual([]);
  });
});
