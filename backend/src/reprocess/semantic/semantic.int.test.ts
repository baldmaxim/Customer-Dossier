// Этап 06 на PostgreSQL: смысловые утверждения extract@3 от запуска до карточки, очереди проверки,
// истории состояния объекта и истории дела. Модель подменена шаблонными ответами — это проверка
// хранения и логики, а не качества модели (benchmark.ts). Тексты и компании синтетические.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../../__tests__/integration/http.js';
import { storeDocument } from '../../ingest/store.js';
import { recordReviewDecision } from '../../assertions/repository.js';
import type { ISemanticExtraction } from '../../llm/semantic/schema.js';
import { applyEntityMerge } from '../../resolve/entityMerge.js';
import { publishCandidateSet } from '../publish.js';
import { claimNextRun, enqueueRun, processRun } from '../runs.js';
import { CORPUS } from './__fixtures__/corpus.js';
import { answer, company, event, project, relation, semanticProvider } from './__fixtures__/semanticAnswers.js';

let api: ITestApi;
let sourceId = 0;
let counter = 0;
const pool = () => getPool();

const CHUNKER = { chunkSize: 4000, maxChunks: 6, overlap: 50 };

/** Сохранить текст, разобрать шаблонным ответом и опубликовать набор. */
const ingest = async (body: string, respond: ISemanticExtraction) => {
  counter += 1;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: `synthetic_semantic/${counter}`,
    url: null,
    title: null,
    body,
    publishedAt: new Date('2026-09-10T09:00:00Z'),
    forwardFrom: null,
  });
  if (!stored.revisionId || !stored.sourceItemId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = semanticProvider(() => respond);
  const queued = await enqueueRun(pool(), { revisionId: stored.revisionId, provider, chunker: CHUNKER, requestedBy: 'test' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const claim = await claimNextRun('w-semantic', { runId: queued.runId });
  const run = await processRun(provider, claim!);
  expect(run.status).toBe('completed');
  const published = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
  expect(published.outcome).toBe('published');
  return { revisionId: stored.revisionId, sourceItemId: stored.sourceItemId, setId: run.candidateSetId!, published };
};

const companyId = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>('SELECT id FROM companies WHERE name = $1 AND merged_into_id IS NULL ORDER BY id LIMIT 1', [name])).rows[0]!.id;

const projectId = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>('SELECT id FROM projects WHERE name = $1 AND merged_into_id IS NULL ORDER BY id LIMIT 1', [name])).rows[0]!.id;

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_semantic', access: 'approved', ai: 'approved' });
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('TC-052: отрицание опровергает роль, решение аналитика требует пересмотра', () => {
  const Q_POS = '«Демо-Альфа» — генподрядчик ЖК «Берег-Демо».';
  const Q_NEG = 'Компания «Демо-Альфа» не является генподрядчиком ЖК «Берег-Демо».';

  it('положительное сообщение, решение аналитика, затем отрицание из другой публикации', async () => {
    await ingest(
      `Новости стройки. ${Q_POS}`,
      answer({
        companies: [company('Демо-Альфа', Q_POS)],
        projects: [project('Берег-Демо', Q_POS)],
        relations: [relation({ type: 'participation', kind: 'general_contractor', subject: 'Демо-Альфа', project: 'Берег-Демо', quote: Q_POS })],
      }),
    );
    const positive = (
      await pool().query<{ id: number; version: number }>(
        `SELECT id, version FROM assertions WHERE predicate = 'participates_in_project' AND role = 'general_contractor' AND polarity = 'positive'`,
      )
    ).rows[0]!;
    await withTransaction(client =>
      recordReviewDecision(client, {
        assertionId: positive.id,
        decision: 'reviewed_supported',
        scope: 'reflects_source',
        reason: 'сверено с публикацией',
        reviewer: 'test',
        expectedVersion: positive.version,
        idempotencyKey: 'semantic-review-0001',
      }),
    );

    await ingest(
      `Уточнение. ${Q_NEG} Она поставляет арматуру.`,
      answer({
        companies: [company('Демо-Альфа', Q_NEG)],
        projects: [project('Берег-Демо', Q_NEG)],
        relations: [relation({ type: 'participation', kind: 'general_contractor', subject: 'Демо-Альфа', project: 'Берег-Демо', quote: Q_NEG, polarity: 'negative' })],
      }),
    );

    const negative = await pool().query(`SELECT 1 FROM assertions WHERE role = 'general_contractor' AND polarity = 'negative'`);
    expect(negative.rowCount).toBe(1);

    const state = (
      await pool().query<{ status: string; needs_revalidation: boolean; contradicts: number; decisions: number }>(
        `SELECT a.status, a.needs_revalidation,
                (SELECT count(*)::int FROM evidence e WHERE e.assertion_id = a.id AND e.stance = 'contradicts' AND e.status = 'active') AS contradicts,
                (SELECT count(*)::int FROM review_decisions r WHERE r.assertion_id = a.id) AS decisions
         FROM assertions a WHERE a.id = $1`,
        [positive.id],
      )
    ).rows[0]!;
    // Решение не удалено и не перезаписано: статус из решения, но основание изменилось.
    expect(state).toEqual({ status: 'reviewed_supported', needs_revalidation: true, contradicts: 1, decisions: 1 });

    const card = await pool().query<{ role: string }>(
      `SELECT v.role FROM card_participations_v v WHERE v.company_id = $1 AND v.origin = 'published'`,
      [await companyId('Демо-Альфа')],
    );
    expect(card.rows).toEqual([{ role: 'general_contractor' }]);

    const queue = await api.call('GET', '/api/review-queue', undefined, api.auth);
    expect(queue.status).toBe(200);
    const kinds = (queue.body.items as Array<{ kind: string; assertionId: number | null }>)
      .filter(i => i.assertionId === positive.id)
      .map(i => i.kind)
      .sort();
    expect(kinds).toEqual(['correction', 'polarity_conflict']);
  });
});

describe('TC-052 / TC-053: план, слух и спорный смысл не становятся ролью или событием', () => {
  it('план публикуется планом, слух — possible, «факт» с признаком плана остаётся кандидатом на проверку', async () => {
    const qPlan = '«Демо-Бета» планирует привлечь «Демо-Вега» к монтажу инженерных систем ЖК «Ручей-Демо».';
    const qRumor = 'По неподтверждённым данным канала, «Демо-Бета» может покинуть ЖК «Ручей-Демо».';
    const body = `${qPlan} ${qRumor}`;
    const { setId } = await ingest(
      body,
      answer({
        companies: [company('Демо-Бета', qPlan), company('Демо-Вега', qPlan)],
        projects: [project('Ручей-Демо', qPlan)],
        relations: [
          relation({ type: 'contract', kind: 'subcontract', subject: 'Демо-Бета', object: 'Демо-Вега', project: 'Ручей-Демо', quote: qPlan, modality: 'planned' }),
          relation({ type: 'participation', kind: 'contractor', subject: 'Демо-Вега', project: 'Ручей-Демо', quote: qPlan, modality: 'reported_fact' }),
        ],
        events: [event({ type: 'contractor_change', subject: 'Демо-Бета', project: 'Ручей-Демо', quote: qRumor, modality: 'possible' })],
      }),
    );

    const contract = (
      await pool().query<{ modality: string; context: number | null }>(
        `SELECT modality::text, context_project_id AS context FROM assertions WHERE predicate = 'contract' AND role = 'subcontract'`,
      )
    ).rows;
    expect(contract).toEqual([{ modality: 'planned', context: await projectId('Ручей-Демо') }]);

    const review = await pool().query<{ reason: string }>(
      `SELECT rejected_reason AS reason FROM candidate_assertions WHERE set_id = $1 AND rejected_reason LIKE 'на проверку%'`,
      [setId],
    );
    expect(review.rows).toHaveLength(1);
    expect(await pool().query(`SELECT 1 FROM assertions WHERE predicate = 'participates_in_project' AND role = 'contractor'`)).toMatchObject({ rowCount: 0 });

    const vega = await companyId('Демо-Вега');
    expect((await pool().query('SELECT 1 FROM card_participations_v WHERE company_id = $1', [vega])).rowCount).toBe(0);
    const beta = await companyId('Демо-Бета');
    expect((await pool().query(`SELECT 1 FROM card_events_v WHERE company_id = $1 AND origin = 'published'`, [beta])).rowCount).toBe(0);
    expect((await pool().query(`SELECT 1 FROM assertions WHERE event_type = 'contractor_change' AND modality = 'possible'`)).rowCount).toBe(1);
  });
});

describe('TC-054: цепочка договоров — два ребра, транзитивного нет', () => {
  it('SYN-05: у каждого договора своё основание в своём предложении', async () => {
    const t = CORPUS.find(c => c.id === 'SYN-05')!.text;
    const [q1, q2] = t.split(/(?<=\.)\s/) as [string, string];
    await ingest(
      t,
      answer({
        companies: [company('Демо-Заказчик', q1), company('Демо-Бета', q1), company('Демо-Альфа', q2)],
        projects: [project('Берег-Демо', q1)],
        relations: [
          relation({ type: 'contract', kind: 'general_contract', subject: 'Демо-Заказчик', object: 'Демо-Бета', project: 'Берег-Демо', building: 'корпус 2', quote: q1 }),
          relation({ type: 'contract', kind: 'subcontract', subject: 'Демо-Бета', object: 'Демо-Альфа', work_package: 'ВК', quote: q2 }),
          relation({ type: 'contract', kind: 'contract', subject: 'Демо-Заказчик', object: 'Демо-Альфа', quote: t }),
        ],
      }),
    );
    const rows = (
      await pool().query<{ subject: string; object: string; role: string; quote: string; building: string | null; wp: string | null }>(
        `SELECT sc.name AS subject, oc.name AS object, a.role, e.quote, a.scope_building AS building, a.work_package AS wp
         FROM assertions a
         JOIN companies sc ON sc.id = a.subject_company_id
         JOIN companies oc ON oc.id = a.object_company_id
         JOIN evidence e ON e.assertion_id = a.id AND e.stance = 'supports' AND e.status = 'active'
         WHERE a.predicate = 'contract' AND a.polarity = 'positive' AND a.modality = 'reported_fact'
         ORDER BY a.role`,
      )
    ).rows;
    expect(rows).toEqual([
      { subject: 'Демо-Заказчик', object: 'Демо-Бета', role: 'general_contract', quote: q1, building: 'корпус 2', wp: null },
      { subject: 'Демо-Бета', object: 'Демо-Альфа', role: 'subcontract', quote: q2, building: null, wp: 'ВК' },
    ]);
  });
});

describe('TC-055 / TC-056: разные дела и стадии одного дела', () => {
  it('два спора без номера — два дела; стадии дела с номером — одна история; требование ≠ присуждено', async () => {
    const q1 = '«Демо-Омега» судится с «Демо-Сигма» об оплате монтажа ВК на корпусе 2.';
    const q2 = 'В другом споре «Демо-Омега» требует от «Демо-Тау» возврата оборудования.';
    await ingest(
      `${q1} ${q2}`,
      answer({
        companies: [company('Демо-Омега', q1), company('Демо-Сигма', q1), company('Демо-Тау', q2)],
        events: [
          event({ type: 'court_case', subject: 'Демо-Омега', counterparty: 'Демо-Сигма', subject_role: 'plaintiff', counterparty_role: 'defendant', quote: q1 }),
          event({ type: 'court_case', subject: 'Демо-Омега', counterparty: 'Демо-Тау', subject_role: 'plaintiff', quote: q2 }),
        ],
      }),
    );

    const CASE = 'А40-777/2026';
    const qFiled = `«Демо-Омега» подала иск к «Демо-Сигма» о взыскании 12 млн рублей, дело № ${CASE}.`;
    const qDecision = `Арбитражный суд удовлетворил иск «Демо-Омега» к «Демо-Сигма» по делу № ${CASE} и взыскал 9 млн рублей.`;
    const qAppeal = `«Демо-Сигма» обжаловала решение по иску «Демо-Омега», дело № ${CASE}.`;
    const parties = (q: string) => [company('Демо-Омега', q), company('Демо-Сигма', q)];
    await ingest(qFiled, answer({
      companies: parties(qFiled),
      events: [event({ type: 'court_case', subject: 'Демо-Омега', counterparty: 'Демо-Сигма', subject_role: 'plaintiff', counterparty_role: 'defendant', case_number: CASE, stage: 'claim_filed', amount: '12000000', currency: 'RUB', amount_purpose: 'claim', quote: qFiled })],
    }));
    await ingest(qDecision, answer({
      companies: parties(qDecision),
      events: [event({ type: 'court_case', subject: 'Демо-Омега', counterparty: 'Демо-Сигма', subject_role: 'plaintiff', counterparty_role: 'defendant', case_number: CASE, stage: 'decision', outcome: 'satisfied', amount: '9000000', currency: 'RUB', amount_purpose: 'award', quote: qDecision })],
    }));
    await ingest(qAppeal, answer({
      companies: parties(qAppeal),
      events: [event({ type: 'court_case', subject: 'Демо-Сигма', counterparty: 'Демо-Омега', subject_role: 'defendant', counterparty_role: 'plaintiff', case_number: CASE, stage: 'appeal_filed', quote: qAppeal })],
    }));

    const omega = await companyId('Демо-Омега');
    const res = await api.call('GET', `/api/companies/${omega}/legal-cases`, undefined, api.auth);
    expect(res.status).toBe(200);
    const cases = res.body.cases as Array<{ caseKey: string; stages: Array<Record<string, unknown>> }>;
    expect(cases.filter(c => c.caseKey.startsWith('assertion:'))).toHaveLength(2);
    const numbered = cases.find(c => c.caseKey === 'case:А40-777/2026');
    expect(numbered?.stages.map(s => s.eventStage).sort()).toEqual(['appeal_filed', 'claim_filed', 'decision']);
    expect(numbered?.stages.find(s => s.eventStage === 'claim_filed')).toMatchObject({ valueType: 'claim', valueNumeric: '12000000.00', eventOutcome: null });
    expect(numbered?.stages.find(s => s.eventStage === 'decision')).toMatchObject({ valueType: 'award', valueNumeric: '9000000.00', eventOutcome: 'satisfied' });
  });
});

describe('TC-057: состояние объекта в действительном времени', () => {
  it('приостановка → возобновление; поздняя мартовская статья не возвращает «приостановлен»; дата неизвестна — не событие состояния', async () => {
    const t = 'Работы на ЖК «Заря-Демо», приостановленные в марте 2026 года, возобновлены в июле 2026 года.';
    await ingest(t, answer({
      projects: [project('Заря-Демо', t)],
      events: [
        event({ type: 'suspension', project: 'Заря-Демо', date_from: '2026-03', date_precision: 'month', quote: t }),
        event({ type: 'resumption', project: 'Заря-Демо', date_from: '2026-07', date_precision: 'month', quote: t }),
      ],
    }));
    const late = 'В марте 2026 года работы на ЖК «Заря-Демо» приостановлены из-за проверки.';
    await ingest(late, answer({
      projects: [project('Заря-Демо', late)],
      events: [event({ type: 'suspension', project: 'Заря-Демо', date_from: '2026-03-15', date_precision: 'day', quote: late })],
    }));
    const undated = 'Несколько лет назад на ЖК «Заря-Демо» работы уже останавливали.';
    await ingest(undated, answer({
      projects: [project('Заря-Демо', undated)],
      events: [event({ type: 'suspension', project: 'Заря-Демо', date_from: '2026-09-10', date_precision: 'day', quote: undated })],
    }));

    const id = await projectId('Заря-Демо');
    const res = await api.call('GET', `/api/projects/${id}/state-history`, undefined, api.auth);
    expect(res.status).toBe(200);
    const history = res.body.history as Array<{ state: string; validFrom: string; periodPrecision: string }>;
    expect(history.map(h => [h.state, h.validFrom, h.periodPrecision])).toEqual([
      ['suspended', '2026-03-01', 'month'],
      ['construction', '2026-07-01', 'month'],
    ]);
    expect(res.body.current).toEqual([expect.objectContaining({ state: 'construction', validFrom: '2026-07-01' })]);

    const undatedEvent = await pool().query<{ occurred_on: string | null }>(
      `SELECT v.occurred_on FROM card_events_v v WHERE v.project_id = $1 AND v.type = 'suspension' AND v.occurred_on IS NULL`,
      [id],
    );
    expect(undatedEvent.rowCount).toBe(1);
  });
});

describe('TC-058: чужая сумма', () => {
  it('SYN-13: сумма у стороны, названной рядом с числом; у соседней компании суммы нет', async () => {
    const t = CORPUS.find(c => c.id === 'SYN-13')!.text.replace(/Демо-Альфа/g, 'Демо-Лямбда').replace(/Демо-Гамма/g, 'Демо-Каппа');
    const qK = 'На соседней площадке «Демо-Каппа» заключила договор на 70 млн рублей.';
    await ingest(t, answer({
      companies: [company('Демо-Лямбда', '«Демо-Лямбда» выполняет монтаж систем ВК.'), company('Демо-Каппа', qK)],
      events: [
        event({ type: 'other', subject: 'Демо-Лямбда', amount: '70000000', currency: 'RUB', amount_purpose: 'contract', quote: t }),
        event({ type: 'tender_award', subject: 'Демо-Каппа', amount: '70000000', currency: 'RUB', amount_purpose: 'contract', quote: qK }),
      ],
    }));
    const rows = (
      await pool().query<{ name: string; amount: string | null }>(
        `SELECT c.name, v.amount_rub::text AS amount FROM card_events_v v JOIN companies c ON c.id = v.company_id
         WHERE c.name IN ('Демо-Лямбда', 'Демо-Каппа') ORDER BY c.name`,
      )
    ).rows;
    expect(rows).toEqual([
      { name: 'Демо-Каппа', amount: '70000000.00' },
      { name: 'Демо-Лямбда', amount: null },
    ]);
  });
});

describe('слияние объектов переносит объект договора', () => {
  it('context_project_id исходного объекта переходит на целевой', async () => {
    const q = '«Демо-Ро» заключила договор подряда с «Демо-Пси» на ЖК «Утёс-Демо».';
    await ingest(q, answer({
      companies: [company('Демо-Ро', q), company('Демо-Пси', q)],
      projects: [project('Утёс-Демо', q)],
      relations: [relation({ type: 'contract', kind: 'contract', subject: 'Демо-Ро', object: 'Демо-Пси', project: 'Утёс-Демо', quote: q })],
    }));
    const source = await projectId('Утёс-Демо');
    const target = (
      await pool().query<{ id: number }>(
        `INSERT INTO projects (name, name_norm, name_latin, kind, stage, city, address, project_level, normalizer_version)
         SELECT name, name_norm, name_latin, kind, stage, city, address, project_level, normalizer_version FROM projects WHERE id = $1
         RETURNING id`,
        [source],
      )
    ).rows[0]!.id;
    const versions = (
      await pool().query<{ id: number; version: number }>('SELECT id, version FROM projects WHERE id = ANY($1::bigint[])', [[source, target]])
    ).rows;
    await applyEntityMerge({
      kind: 'project',
      sourceId: source,
      targetId: target,
      expectedSourceVersion: versions.find(v => v.id === source)!.version,
      expectedTargetVersion: versions.find(v => v.id === target)!.version,
      idempotencyKey: 'semantic-merge-context-0001',
      actor: 'test',
    });
    const moved = await pool().query(
      `SELECT 1 FROM assertions a
       WHERE a.predicate = 'contract' AND a.context_project_id = $1
         AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active')`,
      [target],
    );
    expect(moved.rowCount).toBe(1);
  });
});
