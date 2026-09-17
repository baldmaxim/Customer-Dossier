// Этап 08B на PostgreSQL: схема связей, неизменяемые снимки досье, срез знаний и фильтр дат, экспорт без сети,
// отзыв допуска источника и вымарывание. Модель подменена шаблонными ответами только для наполнения базы.

import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import { updateSourcePolicy } from '../ingest/sources.js';
import type { ISemanticExtraction } from '../llm/semantic/schema.js';
import { applyEntityMerge } from '../resolve/entityMerge.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { answer, company, event, project, relation, semanticProvider } from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { INN_A } from '../reprocess/__fixtures__/extraction.js';
import { refreshSignals } from '../signals/refresh.js';
import type { IGraph } from '../graph/graph.js';
import type { ISnapshotView } from './repository.js';

let api: ITestApi;
let mainSource = 0;
let revocableSource = 0;
let counter = 0;
const pool = () => getPool();

const ingest = async (sourceId: number, body: string, respond: ISemanticExtraction): Promise<void> => {
  counter += 1;
  const stored = await storeDocument({ sourceId, sourceRunId: null, externalId: `synthetic_snapshot/${counter}`, url: `https://t.me/synthetic_snapshot/${counter}`, title: null, body, publishedAt: new Date(), forwardFrom: null });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = semanticProvider(() => respond);
  const queued = await enqueueRun(pool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'test' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('w-snapshot', { runId: queued.runId }))!);
  expect((await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' })).outcome).toBe('published');
};

const Q_PART = `ООО «Альфа-Демо» (ИНН ${INN_A}) выполняет монтаж систем ВК корпуса 2 ЖК «Берег-Демо».`;
const Q_EVIL = `«Альфа-Демо» (ИНН ${INN_A}) выполняет монтаж ВК корпуса 2 ЖК «Берег-Демо» <script>alert(1)</script>`;
const Q_GC = 'Заказчик «Порт-Демо» заключил договор генподряда с «Бета-Демо» на ЖК «Берег-Демо».';
const Q_SUB = `«Бета-Демо» заключила договор субподряда с «Альфа-Демо» (ИНН ${INN_A}) на системы ВК.`;
const Q_COURT = `В 2024 году ООО «Альфа-Демо» (ИНН ${INN_A}) подало иск к «Бета-Демо».`;
const Q_DENY = `Компания «Альфа-Демо» (ИНН ${INN_A}) не является подрядчиком ЖК «Берег-Демо».`;

let alfa = 0;
let projectId = 0;
let caseId = 0;
let s1 = 0;
let s1View: ISnapshotView;

const snapshotOf = async (id: number): Promise<ISnapshotView> => (await api.call('GET', `/api/snapshots/${id}`, undefined, api.auth)).body as unknown as ISnapshotView;

beforeAll(async () => {
  await resetAndMigrate();
  mainSource = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_snapshot', access: 'approved', ai: 'approved' });
  revocableSource = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_snapshot_revocable', access: 'approved', ai: 'approved' });
  api = await startTestApi();

  await ingest(mainSource, `Новости стройки. ${Q_PART}`, answer({
    companies: [company('Альфа-Демо', Q_PART, { legal_form: 'ООО', tax_id: INN_A })],
    projects: [project('Берег-Демо', Q_PART)],
    relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', building: 'корпус 2', work_package: 'ВК', quote: Q_PART })],
  }));
  await ingest(revocableSource, `Перепечатка. ${Q_EVIL}`, answer({
    companies: [company('Альфа-Демо', Q_EVIL, { tax_id: INN_A })],
    projects: [project('Берег-Демо', Q_EVIL)],
    relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', building: 'корпус 2', work_package: 'ВК', quote: Q_EVIL })],
  }));
  await ingest(mainSource, `${Q_GC} ${Q_SUB}`, answer({
    companies: [company('Порт-Демо', Q_GC), company('Бета-Демо', Q_GC), company('Альфа-Демо', Q_SUB, { tax_id: INN_A })],
    projects: [project('Берег-Демо', Q_GC)],
    relations: [
      relation({ type: 'contract', kind: 'general_contract', subject: 'Порт-Демо', object: 'Бета-Демо', project: 'Берег-Демо', quote: Q_GC }),
      relation({ type: 'contract', kind: 'subcontract', subject: 'Бета-Демо', object: 'Альфа-Демо', work_package: 'ВК', quote: Q_SUB }),
    ],
  }));
  await ingest(mainSource, `Суды. ${Q_COURT}`, answer({
    companies: [company('Альфа-Демо', Q_COURT, { legal_form: 'ООО', tax_id: INN_A }), company('Бета-Демо', Q_COURT)],
    events: [event({ type: 'court_case', subject: 'Альфа-Демо', counterparty: 'Бета-Демо', subject_role: 'plaintiff', counterparty_role: 'defendant', date_from: '2024', date_precision: 'year', quote: Q_COURT })],
  }));

  alfa = (await pool().query<{ company_id: number }>(`SELECT company_id FROM entity_identifiers WHERE value = $1 AND status = 'active'`, [INN_A])).rows[0]!.company_id;
  projectId = (await pool().query<{ id: number }>(`SELECT id FROM projects WHERE name = 'Берег-Демо'`)).rows[0]!.id;
  const created = await api.call('POST', '/api/cases', { title: 'ВК корпуса 2', companyId: alfa, projectId, scopeBuilding: 'корпус 2', claimedRole: 'contractor', requestDate: '2026-09-15' }, api.auth);
  caseId = (created.body.case as { id: number }).id;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('TC-069: схема связей', () => {
  it('цепочка договоров без транзитивного ребра; ребро участия с корпусом и работами открывает своё основание', async () => {
    const res = await api.call('GET', `/api/graph?companyId=${alfa}&depth=2`, undefined, api.auth);
    expect(res.status).toBe(200);
    const g = res.body as unknown as IGraph;
    const port = g.nodes.find(n => n.label === 'Порт-Демо');
    const beta = g.nodes.find(n => n.label === 'Бета-Демо');
    expect(port && beta).toBeTruthy();
    const contracts = g.edges.filter(e => e.type === 'contract');
    expect(contracts.map(e => `${e.from}->${e.to}`).sort()).toEqual([`${beta!.key}->c:${alfa}`, `${port!.key}->${beta!.key}`].sort());
    expect(g.edges.some(e => e.from === port!.key && e.to === `c:${alfa}`)).toBe(false);

    const participation = g.edges.find(e => e.type === 'participation' && e.from === `c:${alfa}`)!;
    expect(participation).toMatchObject({ building: 'корпус 2', workPackage: 'ВК', to: `p:${projectId}` });
    const detail = await api.call('GET', `/api/assertions/${participation.assertionId}`, undefined, api.auth);
    const evidence = detail.body.evidence as Array<{ quote: string; revisionId: number }>;
    expect(evidence.map(e => e.quote)).toContain(Q_PART);
    expect(evidence.every(e => e.revisionId > 0)).toBe(true);
  });
});

describe('TC-070 / TC-071: снимок неизменен, срез знаний только текущий', () => {
  it('S1 создан: целостность подтверждена, цитаты с точной редакцией, решения и схема внутри', async () => {
    const res = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: 'snapshot-s1-000001' }, api.auth);
    expect(res.status).toBe(201);
    s1 = res.body.id as number;
    s1View = await snapshotOf(s1);
    expect(s1View.integrity.verified).toBe(true);
    expect(s1View.meta.knowledgeCutoff).toBe(s1View.meta.generatedAt);
    expect(s1View.payload.company).toMatchObject({ name: 'Альфа-Демо', identifiers: [`inn ${INN_A}`] });
    expect(s1View.payload.sources.find(s => s.quote === Q_PART)).toMatchObject({ revisionNo: 1, sourceKey: 'synthetic_snapshot' });
    expect(s1View.payload.graph.edges.length).toBeGreaterThan(0);
    expect(s1View.payload.dossier.role.status).toBe('reported');
    const replay = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: 'snapshot-s1-000001' }, api.auth);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(s1);
  });

  it('новая публикация, переименование, слияние, решение аналитика и пересчёт не меняют S1; S2 их учитывает', async () => {
    await ingest(mainSource, `Уточнение. ${Q_DENY}`, answer({
      companies: [company('Альфа-Демо', Q_DENY, { tax_id: INN_A })],
      projects: [project('Берег-Демо', Q_DENY)],
      relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', polarity: 'negative', quote: Q_DENY })],
    }));
    await pool().query(`UPDATE companies SET name = 'Альфа-Демо Переименованная' WHERE id = $1`, [alfa]);
    const dup = (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ('Альфа Дубль Снимка', 'альфа дубль снимка', 'alfa dubl snimka') RETURNING id`)).rows[0]!.id;
    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[dup, alfa]])).rows;
    await applyEntityMerge({ kind: 'company', sourceId: dup, targetId: alfa, expectedSourceVersion: versions.find(v => v.id === dup)!.version, expectedTargetVersion: versions.find(v => v.id === alfa)!.version, idempotencyKey: 'snapshot-merge-0001', actor: 'test' });
    const participationId = s1View.payload.dossier.role.established[0]!.assertionIds[0]!;
    const version = ((await api.call('GET', `/api/assertions/${participationId}`, undefined, api.auth)).body.assertion as { version: number }).version;
    const review = await api.call('POST', `/api/assertions/${participationId}/reviews`, { decision: 'disputed', reason: 'опровергнуто заказчиком', expectedVersion: version, idempotencyKey: 'snapshot-review-0001' }, api.auth);
    expect(review.status).toBe(201);
    expect((await refreshSignals({ requestedBy: 'test' })).outcome).toBe('succeeded');

    const again = await snapshotOf(s1);
    expect(again.integrity).toMatchObject({ verified: true, storedHash: s1View.integrity.storedHash });
    expect(again.payload).toEqual(s1View.payload);
    expect(again.payload.company!.name).toBe('Альфа-Демо');

    const s2 = await api.call('POST', `/api/cases/${caseId}/snapshots`, {}, api.auth);
    expect(s2.status).toBe(201);
    const s2View = await snapshotOf(s2.body.id as number);
    expect(s2View.integrity.storedHash).not.toBe(s1View.integrity.storedHash);
    expect(s2View.payload.company!.name).toBe('Альфа-Демо Переименованная');
    expect(s2View.payload.dossier.role.status).toBe('contradicted');
    expect(s2View.payload.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ decision: 'disputed', reason: 'опровергнуто заказчиком' })]));
    expect(s2View.payload.openQueue.length).toBeGreaterThan(0);
  });

  it('хранимый снимок нельзя изменить или удалить в обход процедуры', async () => {
    await expect(pool().query(`UPDATE dossier_snapshots SET payload = '{}'::jsonb WHERE id = $1`, [s1])).rejects.toThrow(/неизменяем/);
    await expect(pool().query('DELETE FROM dossier_snapshots WHERE id = $1', [s1])).rejects.toThrow(/запрещено/);
  });

  it('срез знаний на прошлую дату не создаётся; фильтр дат исключает события вне периода и помечает это', async () => {
    const past = await api.call('POST', `/api/cases/${caseId}/snapshots`, { knowledgeCutoff: '2020-01-01T00:00:00Z' }, api.auth);
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('historical_cutoff_unsupported');

    const filtered = await api.call('POST', `/api/cases/${caseId}/snapshots`, { effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }, api.auth);
    expect(filtered.status).toBe(201);
    const view = await snapshotOf(filtered.body.id as number);
    expect(view.meta).toMatchObject({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    expect(view.payload.effective.excluded).toBeGreaterThanOrEqual(1);
    expect(view.payload.dossier.companyEvents.some(s => s.text.includes('судебное дело'))).toBe(false);
    expect(view.payload.limitations.join(' ')).toContain('не документ, существовавший в прошлом');
    expect(s1View.payload.dossier.companyEvents.some(s => s.text.includes('судебное дело'))).toBe(true);
  });
});

describe('TC-072 / TC-073: экспорт, отзыв допуска, выход, вымарывание', () => {
  it('HTML, Markdown и JSON из снимка без сети: опасный текст не исполняется, содержание согласовано', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('сеть недоступна');
    });
    const html = await api.call('GET', `/api/snapshots/${s1}/export.html`, undefined, api.auth);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(String(html.headers['content-security-policy'])).toContain("default-src 'none'");
    const htmlBody = String(html.body.raw);
    expect(htmlBody).not.toMatch(/<script/i);
    expect(htmlBody).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    const md = await api.call('GET', `/api/snapshots/${s1}/export.md`, undefined, api.auth);
    expect(String(md.headers['content-disposition'])).toContain('attachment');
    const json = await api.call('GET', `/api/snapshots/${s1}/export.json`, undefined, api.auth);
    expect(json.body.exportSchema).toBe('dossier-snapshot-export@1');
    for (const text of ['ВК корпуса 2', 'Альфа-Демо', s1View.integrity.storedHash]) {
      expect(htmlBody).toContain(text);
      expect(String(md.body.raw).replace(/\\/g, '')).toContain(text);
      expect(JSON.stringify(json.body)).toContain(text);
    }
  });

  it('отзыв допуска источника после снимка: цитаты скрыты при выдаче и в экспорте, целостность хранимого сохранена', async () => {
    await updateSourcePolicy(
      revocableSource,
      { accessStatus: 'revoked', aiProcessingStatus: 'revoked', scope: null, basis: 'отзыв правообладателем', reference: null, owner: 'test', expiresAt: null },
      'test',
    );
    const view = await snapshotOf(s1);
    expect(view.integrity.verified).toBe(true);
    expect(view.availability.withheldSources.map(s => s.sourceKey)).toContain('synthetic_snapshot_revocable');
    const revoked = view.payload.sources.filter(s => s.sourceKey === 'synthetic_snapshot_revocable');
    expect(revoked.length).toBeGreaterThan(0);
    expect(revoked.every(s => s.quote === null && (s.withheldReason ?? '').startsWith('Скрыто при выдаче'))).toBe(true);
    const html = await api.call('GET', `/api/snapshots/${s1}/export.html`, undefined, api.auth);
    expect(String(html.body.raw)).not.toContain('alert(1)');
  });

  it('после выхода и без CSRF снимок и выгрузки не отдаются', async () => {
    expect((await api.call('GET', `/api/snapshots/${s1}/export.html`, undefined, { cookie: '' })).status).toBe(401);
    expect((await api.call('GET', `/api/snapshots/${s1}`, undefined, { cookie: '' })).status).toBe(401);
    expect((await api.call('POST', `/api/cases/${caseId}/snapshots`, {}, { 'x-csrf-token': '' })).status).toBe(403);
  });

  it('вымарывание фрагмента: tombstone, новый hash в журнале, повтор идемпотентен', async () => {
    const target = s1View.payload.sources.find(s => s.quote === Q_PART)!;
    const res = await api.call('POST', `/api/snapshots/${s1}/redactions`, { evidenceId: target.evidenceId, reason: 'требование правообладателя' }, api.auth);
    expect(res.status).toBe(201);
    expect(res.body.hashBefore).toBe(s1View.integrity.storedHash);
    const view = await snapshotOf(s1);
    expect(view.integrity).toMatchObject({ verified: true, storedHash: res.body.hashAfter });
    expect(view.payload.sources.find(s => s.evidenceId === target.evidenceId)!.quote).toBe('[фрагмент вымаран по решению оператора]');
    expect(view.redactions).toEqual([expect.objectContaining({ evidenceId: target.evidenceId, reason: 'требование правообладателя' })]);
    const replay = await api.call('POST', `/api/snapshots/${s1}/redactions`, { evidenceId: target.evidenceId, reason: 'требование правообладателя' }, api.auth);
    expect(replay.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('этап 13: идентичность запроса снимка, согласованное чтение, редакция основания', () => {
  it('R08 / T13-01: ключ снимка обращения A при запросе по обращению B — 409; повтор A — тот же снимок', async () => {
    const other = await api.call('POST', '/api/cases', { title: 'Другое обращение', companyId: alfa, requestDate: '2026-09-15' }, api.auth);
    const caseB = (other.body.case as { id: number }).id;
    const key = 'stage13-key-case-a-0001';
    const first = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth);
    expect(first.status).toBe(201);
    const conflict = await api.call('POST', `/api/cases/${caseB}/snapshots`, { idempotencyKey: key }, api.auth);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('idempotency_key_conflict');
    const periodConflict = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key, effectiveFrom: '2025-01-01' }, api.auth);
    expect(periodConflict.status).toBe(409);
    const replay = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('T13-02: настоящий повтор после изменения живого досье возвращает прежний снимок; новый ключ — новое состояние', async () => {
    const key = 'stage13-key-replay-0002';
    const first = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth);
    await pool().query(`UPDATE companies SET name = name || ' (повтор)' WHERE id = $1`, [alfa]);
    const replay = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ id: first.body.id, payloadHash: first.body.payloadHash });
    const fresh = await api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: 'stage13-key-replay-0003' }, api.auth);
    expect(fresh.status).toBe(201);
    expect(fresh.body.payloadHash).not.toBe(first.body.payloadHash);
    await pool().query(`UPDATE companies SET name = replace(name, ' (повтор)', '') WHERE id = $1`, [alfa]);
  });

  it('T13-03: два одновременных запроса с одним ключом — один снимок, без 500', async () => {
    const key = 'stage13-key-concurrent-0004';
    const [a, b] = await Promise.all([
      api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth),
      api.call('POST', `/api/cases/${caseId}/snapshots`, { idempotencyKey: key }, api.auth),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect((await pool().query('SELECT count(*)::int AS n FROM dossier_snapshots WHERE idempotency_key = $1', [key])).rows[0]!.n).toBe(1);
  });

  it('T13-05: переименование, закоммиченное во время построения, не создаёт гибридный снимок', async () => {
    const { createSnapshot, readSnapshot } = await import('./repository.js');
    const before = (await pool().query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [alfa])).rows[0]!.name;
    const renamed = `${before} (гонка)`;
    const result = await createSnapshot({
      caseId,
      effectiveFrom: null,
      effectiveTo: null,
      knowledgeCutoff: null,
      idempotencyKey: null,
      actor: 'test',
      // Барьер: другое соединение коммитит переименование после того, как транзакция снимка зафиксировала точку чтения.
      afterFirstRead: async () => {
        await pool().query('UPDATE companies SET name = $2 WHERE id = $1', [alfa, renamed]);
      },
    });
    const view = (await readSnapshot(result.id))!;
    expect(view.payload.company!.name).toBe(before);
    expect(JSON.stringify(view.payload.dossier)).not.toContain('(гонка)');
    expect(JSON.stringify(view.payload.graph)).not.toContain('(гонка)');
    await pool().query('UPDATE companies SET name = $2 WHERE id = $1', [alfa, before]);
  });

  it('T13-07: правка без разбора — основание остаётся на редакции 1, новая редакция отмечена отдельно', async () => {
    const Q_REV = `ООО «Альфа-Демо» (ИНН ${INN_A}) выполняет отделку корпуса 3 ЖК «Берег-Демо».`;
    await ingest(mainSource, `Полный текст. ${Q_REV}`, answer({
      companies: [company('Альфа-Демо', Q_REV, { legal_form: 'ООО', tax_id: INN_A })],
      projects: [project('Берег-Демо', Q_REV)],
      relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', building: 'корпус 3', quote: Q_REV })],
    }));
    const externalId = `synthetic_snapshot/${counter}`;
    const edited = await storeDocument({ sourceId: mainSource, sourceRunId: null, externalId, url: `https://t.me/${externalId}`, title: null, body: 'Анонс исправлен без подробностей.', publishedAt: new Date(), forwardFrom: null });
    expect(edited.outcome).toBe('new_revision');

    const { loadCompanyInputs } = await import('../signals/load.js');
    const [input] = await loadCompanyInputs(pool(), [alfa], new Date(Date.now() + 1000));
    const pub = input!.publications.find(p => p.sourceItemId === edited.sourceItemId)!;
    expect(pub).toMatchObject({ evidenceRevisionNo: 1, latestRevisionNo: 2, pendingRevision: true });
  });

  it('T13-08 / T13-10: новый снимок несёт покрытие выборок; прежние снимки открываются без него', async () => {
    const res = await api.call('POST', `/api/cases/${caseId}/snapshots`, {}, api.auth);
    const view = await snapshotOf(res.body.id as number);
    expect(view.payload.schemaVersion).toBe('dossier-snapshot@2');
    expect(view.payload.coverage!.map(c => c.source)).toEqual(expect.arrayContaining(['company_facts', 'project_facts']));
    expect(view.payload.coverage!.every(c => c.truncated === false)).toBe(true);
    const s1Again = await snapshotOf(s1);
    expect(s1Again.integrity.verified).toBe(true);
  });
});
