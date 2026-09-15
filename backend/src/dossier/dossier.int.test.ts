// Этап 08A на PostgreSQL: сквозной сценарий досье — два одноимённых юрлица → выбор нужного → объект и корпус →
// обращение → роль и цитата → противоречие → решение аналитика → повторное открытие. Модель подменена шаблонными
// ответами extract@3 только для наполнения базы; досье строится без модели и без сети.

import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import type { ISemanticExtraction } from '../llm/semantic/schema.js';
import { applyEntityMerge } from '../resolve/entityMerge.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { answer, company, project, relation, semanticProvider } from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { INN_A, INN_B } from '../reprocess/__fixtures__/extraction.js';
import type { ICaseDossier } from './caseDossier.js';

let api: ITestApi;
let sourceId = 0;
let counter = 0;
const pool = () => getPool();

const ingest = async (body: string, respond: ISemanticExtraction): Promise<void> => {
  counter += 1;
  const stored = await storeDocument({ sourceId, sourceRunId: null, externalId: `synthetic_dossier/${counter}`, url: null, title: null, body, publishedAt: new Date(), forwardFrom: null });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = semanticProvider(() => respond);
  const queued = await enqueueRun(pool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'test' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('w-dossier', { runId: queued.runId }))!);
  expect((await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' })).outcome).toBe('published');
};

const Q_PART = `ООО «Альфа-Демо» (ИНН ${INN_A}) выполняет монтаж систем ВК корпуса 2 ЖК «Берег-Демо».`;
const Q_OTHER = `АО «Альфа-Демо» (ИНН ${INN_B}) строит склад в промзоне.`;
const Q_DENY = `Компания «Альфа-Демо» (ИНН ${INN_A}) не является подрядчиком ЖК «Берег-Демо».`;

let alfaA = 0;
let alfaB = 0;
let projectId = 0;
let caseId = 0;
let caseVersion = 0;

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_dossier', access: 'approved', ai: 'approved' });
  api = await startTestApi();

  await ingest(`Новости стройки. ${Q_PART}`, answer({
    companies: [company('Альфа-Демо', Q_PART, { legal_form: 'ООО', tax_id: INN_A })],
    projects: [project('Берег-Демо', Q_PART)],
    relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', building: 'корпус 2', work_package: 'монтаж систем ВК', quote: Q_PART })],
  }));
  await ingest(`Промышленность. ${Q_OTHER}`, answer({ companies: [company('Альфа-Демо', Q_OTHER, { legal_form: 'АО', tax_id: INN_B })] }));

  const ids = (
    await pool().query<{ id: number; value: string }>(
      `SELECT c.id, i.value FROM companies c JOIN entity_identifiers i ON i.company_id = c.id AND i.status = 'active'
       WHERE c.name = 'Альфа-Демо' AND c.merged_into_id IS NULL`,
    )
  ).rows;
  alfaA = ids.find(r => r.value === INN_A)!.id;
  alfaB = ids.find(r => r.value === INN_B)!.id;
  projectId = (await pool().query<{ id: number }>(`SELECT id FROM projects WHERE name = 'Берег-Демо'`)).rows[0]!.id;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await api.close();
  await closeDb();
});

const dossierOf = async (id: number): Promise<ICaseDossier> => (await api.call('GET', `/api/cases/${id}/dossier`, undefined, api.auth)).body as unknown as ICaseDossier;

describe('TC-065: два одноимённых юрлица и осознанный выбор', () => {
  it('поиск отдаёт обоих кандидатов с реквизитами и признаком одноимённости, объект — с уровнем и городом', async () => {
    expect(alfaA).not.toBe(alfaB);
    const res = await api.call('GET', `/api/companies?q=${encodeURIComponent('Альфа-Демо')}`, undefined, api.auth);
    const items = res.body.items as Array<{ id: number; identifiers: string[]; homonyms: number; entityType: string }>;
    const found = items.filter(i => i.id === alfaA || i.id === alfaB);
    expect(found).toHaveLength(2);
    expect(found.every(i => i.homonyms >= 1 && i.identifiers.length === 1)).toBe(true);
    expect(new Set(found.map(i => i.identifiers[0]))).toEqual(new Set([`inn ${INN_A}`, `inn ${INN_B}`]));

    const projects = await api.call('GET', `/api/projects/search?q=${encodeURIComponent('Берег-Демо')}`, undefined, api.auth);
    expect((projects.body.items as Array<Record<string, unknown>>)[0]).toMatchObject({ id: projectId, level: 'complex' });
  });

  it('обращение по выбранному юрлицу: заявленное — запись оператора, канон не меняется', async () => {
    const before = (await pool().query<{ n: number }>('SELECT (SELECT count(*) FROM assertions) + (SELECT count(*) FROM evidence) AS n')).rows[0]!.n;
    const res = await api.call('POST', '/api/cases', {
      title: 'ВК корпуса 2',
      companyId: alfaA,
      projectId,
      scopeBuilding: 'корпус 2',
      workPackageLabel: 'монтаж систем водоснабжения и канализации',
      claimedRole: 'contractor',
      claimedClientName: 'Бета-Демо',
      claimedTerms: 'аванс 30 % со слов',
      requestDate: '2026-09-15',
      idempotencyKey: 'dossier-case-00001',
    }, api.auth);
    expect(res.status).toBe(201);
    const created = res.body.case as { id: number; version: number; provenance: string; workPackage: string; companyStatus: string };
    expect(created).toMatchObject({ provenance: 'operator_recorded_claim', workPackage: 'ВК', companyStatus: 'identified' });
    caseId = created.id;
    caseVersion = created.version;
    const after = (await pool().query<{ n: number }>('SELECT (SELECT count(*) FROM assertions) + (SELECT count(*) FROM evidence) AS n')).rows[0]!.n;
    expect(after).toBe(before);

    const replay = await api.call('POST', '/api/cases', { title: 'другое', companyId: alfaA, requestDate: '2026-09-15', idempotencyKey: 'dossier-case-00001' }, api.auth);
    expect(replay.status).toBe(200);
    expect((replay.body.case as { id: number }).id).toBe(caseId);
  });

  it('досье: установленная роль с цитатой и id, одноимённая компания не смешана, условия — только со слов', async () => {
    const d = await dossierOf(caseId);
    expect(d.role.status).toBe('reported');
    expect(d.role.established[0]).toMatchObject({ attribution: 'source_reported' });
    expect(d.role.established[0]!.assertionIds).toHaveLength(1);
    expect(d.role.established[0]!.quotes[0]!.quote).toBe(Q_PART);
    expect(d.subject.find(s => s.code === 'homonyms')!.text).toContain(INN_B);
    expect(d.terms.claimed).toMatchObject({ attribution: 'operator_claim' });
    expect(d.terms.fromSources).toEqual([]);
    expect(d.questions.map(q => q.code)).toEqual(expect.arrayContaining(['ask_chain_not_documented']));
  });

  it('юрлицо не установлено: одноимённые предлагаются для выбора, сведения ни одного не подставлены', async () => {
    const res = await api.call('POST', '/api/cases', { title: 'Неизвестная Альфа', companyNameClaimed: 'Альфа-Демо', requestDate: '2026-09-15' }, api.auth);
    expect(res.status).toBe(201);
    const d = await dossierOf((res.body.case as { id: number }).id);
    expect(d.subject[0]).toMatchObject({ code: 'company_unidentified' });
    expect(d.subject.find(s => s.code === 'homonyms')!.text).toMatch(/\(2\)/);
    expect(d.role.status).toBe('no_company');
    expect(d.companyEvents).toEqual([]);
  });
});

describe('TC-066: противоречие, решение и повторное открытие', () => {
  it('отрицание из другой публикации — противоречие в досье; спор без причины не принимается; решение видно при повторном открытии', async () => {
    await ingest(`Уточнение. ${Q_DENY}`, answer({
      companies: [company('Альфа-Демо', Q_DENY, { tax_id: INN_A })],
      projects: [project('Берег-Демо', Q_DENY)],
      relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', polarity: 'negative', quote: Q_DENY })],
    }));
    const d = await dossierOf(caseId);
    expect(d.role.status).toBe('contradicted');
    expect(d.observations[0]!.code).toMatch(/role_denied|role_contradicted/);

    const positiveId = d.role.established[0]!.assertionIds[0]!;
    // Отрицание без корпуса противоречит роли на корпусе 2 — видно и в очереди проверки.
    const queue = await api.call('GET', '/api/review-queue?kind=polarity_conflict', undefined, api.auth);
    expect((queue.body.items as Array<{ assertionId: number }>).map(i => i.assertionId)).toContain(positiveId);
    const detail = await api.call('GET', `/api/assertions/${positiveId}`, undefined, api.auth);
    const version = (detail.body.assertion as { version: number }).version;

    const noReason = await api.call('POST', `/api/assertions/${positiveId}/reviews`, { decision: 'disputed', expectedVersion: version, idempotencyKey: 'dossier-review-0001' }, api.auth);
    expect(noReason.status).toBe(400);
    expect(noReason.body.code).toBe('reason_required');

    const disputed = await api.call('POST', `/api/assertions/${positiveId}/reviews`, { decision: 'disputed', reason: 'есть опровержение заказчика', expectedVersion: version, idempotencyKey: 'dossier-review-0002' }, api.auth);
    expect(disputed.status).toBe(201);

    const reopened = await dossierOf(caseId);
    expect(reopened.role.established[0]).toMatchObject({ attribution: 'analyst_disputed', assertionIds: [positiveId] });
    const history = await api.call('GET', `/api/assertions/${positiveId}`, undefined, api.auth);
    expect(history.body.reviews).toEqual([expect.objectContaining({ decision: 'disputed', reason: 'есть опровержение заказчика' })]);
  });

  it('обращение: вторая вкладка со старой версией — 409; история версий сохраняется', async () => {
    const body = { title: 'ВК корпуса 2 (уточнено)', companyId: alfaA, projectId, scopeBuilding: 'корпус 2', claimedRole: 'subcontractor', requestDate: '2026-09-15' };
    const first = await api.call('PUT', `/api/cases/${caseId}`, { ...body, expectedVersion: caseVersion }, api.auth);
    expect(first.status).toBe(200);
    const stale = await api.call('PUT', `/api/cases/${caseId}`, { ...body, title: 'затереть', expectedVersion: caseVersion }, api.auth);
    expect(stale.status).toBe(409);
    const read = await api.call('GET', `/api/cases/${caseId}`, undefined, api.auth);
    expect(read.body.case).toMatchObject({ title: 'ВК корпуса 2 (уточнено)', version: caseVersion + 1, claimedRole: 'subcontractor' });
    expect((read.body.history as unknown[]).length).toBe(2);
  });

  it('список обращений с пагинацией', async () => {
    const page = await api.call('GET', '/api/cases?limit=1', undefined, api.auth);
    expect((page.body.items as unknown[]).length).toBe(1);
    expect(page.body.nextBefore).not.toBeNull();
    const next = await api.call('GET', `/api/cases?limit=1&before=${page.body.nextBefore}`, undefined, api.auth);
    expect((next.body.items as Array<{ id: number }>)[0]!.id).toBeLessThan(page.body.nextBefore as number);
  });
});

describe('TC-067 / TC-068: без модели и сети; без сессии', () => {
  it('досье обращения, объекта и резюме компании строятся без сетевых вызовов', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('сеть недоступна');
    });
    const d = await api.call('GET', `/api/cases/${caseId}/dossier`, undefined, api.auth);
    expect(d.status).toBe(200);
    const p = await api.call('GET', `/api/projects/${projectId}/dossier?from=2026-01-01&to=2026-12-31`, undefined, api.auth);
    expect(p.status).toBe(200);
    expect((p.body.participants as Array<{ companyId: number }>).map(x => x.companyId)).toContain(alfaA);
    expect(p.body.coParticipationNote).toContain('не означает договора');
    const s = await api.call('GET', `/api/companies/${alfaA}/dossier-summary`, undefined, api.auth);
    expect(s.status).toBe(200);
    expect(s.body.limits).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'no_snapshot' })]));
  });

  it('без входа и без CSRF — отказ, данные не отдаются', async () => {
    const anonymous = await api.call('GET', `/api/cases/${caseId}/dossier`, undefined, { cookie: '' });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).not.toHaveProperty('role');
    const noCsrf = await api.call('PUT', `/api/cases/${caseId}`, { title: 'x', companyId: alfaA, requestDate: '2026-09-15', expectedVersion: 99 }, { 'x-csrf-token': '' });
    expect(noCsrf.status).toBe(403);
  });
});

describe('слияние переносит ссылку обращения', () => {
  it('обращение по дубликату после слияния указывает на целевую компанию', async () => {
    const dup = (
      await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ('Альфа Демо Дубль', 'альфа демо дубль', 'alfa demo dubl') RETURNING id`)
    ).rows[0]!.id;
    const created = await api.call('POST', '/api/cases', { title: 'по дублю', companyId: dup, requestDate: '2026-09-15' }, api.auth);
    const dupCase = (created.body.case as { id: number }).id;
    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[dup, alfaA]])).rows;
    await applyEntityMerge({
      kind: 'company',
      sourceId: dup,
      targetId: alfaA,
      expectedSourceVersion: versions.find(v => v.id === dup)!.version,
      expectedTargetVersion: versions.find(v => v.id === alfaA)!.version,
      idempotencyKey: 'dossier-merge-0001',
      actor: 'test',
    });
    const moved = await pool().query<{ company_id: number }>('SELECT company_id FROM dossier_cases WHERE id = $1', [dupCase]);
    expect(moved.rows[0]!.company_id).toBe(alfaA);
  });
});
