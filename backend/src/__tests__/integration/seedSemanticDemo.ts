// Синтетические смысловые утверждения extract@3 — для ручной проверки очереди, истории дела,
// состояния объекта и карточки (этап 06). Модель подменена шаблонными ответами (LM Studio не нужен).
// Только тестовая база, с той же проверкой цели, что у интеграционных тестов.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-semantic

// Общий preflight тестовой цели — до импорта env и пула (src/db/testTargetBootstrap.ts).
const { prepareTestTargetProcess } = await import('../../db/testTargetBootstrap.js');
prepareTestTargetProcess();

const { closeDb, getPool, withTransaction } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { claimNextRun, enqueueRun, processRun } = await import('../../reprocess/runs.js');
const { publishCandidateSet } = await import('../../reprocess/publish.js');
const { recordReviewDecision } = await import('../../assertions/repository.js');
const fx = await import('../../reprocess/semantic/__fixtures__/semanticAnswers.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_semantic_channel', status: 'paused', access: 'approved', ai: 'approved' });
let n = 0;

const ingest = async (body: string, answer: ReturnType<typeof fx.answer>): Promise<{ setId: number; published: string }> => {
  n += 1;
  const stored = await storeDocument({
    sourceId: source,
    sourceRunId: null,
    externalId: `demo_semantic_channel/${n}`,
    url: null,
    title: null,
    body,
    publishedAt: new Date('2026-09-10T09:00:00Z'),
    forwardFrom: null,
  });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = fx.semanticProvider(() => answer);
  const queued = await enqueueRun(getPool(), {
    revisionId: stored.revisionId,
    provider,
    chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 },
    requestedBy: 'seed',
  });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const claim = await claimNextRun('seed-semantic', { runId: queued.runId });
  const result = await processRun(provider, claim!);
  const published = await publishCandidateSet({ setId: result.candidateSetId!, expectedVersion: 0, actor: 'seed' });
  return { setId: result.candidateSetId!, published: published.outcome };
};

// 1. Роль, решение аналитика, затем отрицание из другой публикации.
const POS = '«Демо-Зенит» — генподрядчик ЖК «Демо-Причал».';
await ingest(`Новости стройки. ${POS}`, fx.answer({
  companies: [fx.company('Демо-Зенит', POS)],
  projects: [fx.project('Демо-Причал', POS)],
  relations: [fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Демо-Зенит', project: 'Демо-Причал', quote: POS })],
}));
const positive = (await getPool().query<{ id: number; version: number }>(
  `SELECT id, version FROM assertions WHERE predicate = 'participates_in_project' AND polarity = 'positive' ORDER BY id DESC LIMIT 1`,
)).rows[0]!;
await withTransaction(client => recordReviewDecision(client, {
  assertionId: positive.id, decision: 'reviewed_supported', scope: 'reflects_source', reason: 'демо-проверка',
  reviewer: 'seed', expectedVersion: positive.version, idempotencyKey: 'seed-semantic-review-1',
}));
const NEG = 'Компания «Демо-Зенит» не является генподрядчиком ЖК «Демо-Причал».';
await ingest(`Уточнение редакции. ${NEG}`, fx.answer({
  companies: [fx.company('Демо-Зенит', NEG)],
  projects: [fx.project('Демо-Причал', NEG)],
  relations: [fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Демо-Зенит', project: 'Демо-Причал', quote: NEG, polarity: 'negative' })],
}));

// 2. Цепочка договоров и план: два ребра, план отдельно, «факт» с признаком плана — на проверку.
const C1 = 'Заказчик «Демо-Порт» заключил договор генподряда с «Демо-Зенит» на корпус 2 ЖК «Демо-Причал».';
const C2 = '«Демо-Зенит» заключила договор субподряда с «Демо-Вектор» на системы ВК этого корпуса.';
const PLAN = '«Демо-Зенит» планирует привлечь «Демо-Кварц» к монтажу инженерных систем.';
const chain = await ingest(`${C1} ${C2} ${PLAN}`, fx.answer({
  companies: [fx.company('Демо-Порт', C1), fx.company('Демо-Зенит', C1), fx.company('Демо-Вектор', C2), fx.company('Демо-Кварц', PLAN)],
  projects: [fx.project('Демо-Причал', C1)],
  relations: [
    fx.relation({ type: 'contract', kind: 'general_contract', subject: 'Демо-Порт', object: 'Демо-Зенит', project: 'Демо-Причал', building: 'корпус 2', quote: C1 }),
    fx.relation({ type: 'contract', kind: 'subcontract', subject: 'Демо-Зенит', object: 'Демо-Вектор', work_package: 'ВК', quote: C2 }),
    fx.relation({ type: 'contract', kind: 'subcontract', subject: 'Демо-Зенит', object: 'Демо-Кварц', quote: PLAN, modality: 'reported_fact' }),
  ],
}));

// 3. Дело с номером: иск, решение, обжалование.
const CASE = 'А40-555/2026';
const FILED = `«Демо-Вектор» подала иск к «Демо-Зенит» о взыскании 12 млн рублей, дело № ${CASE}.`;
const DECISION = `Суд удовлетворил иск «Демо-Вектор» к «Демо-Зенит» по делу № ${CASE} и взыскал 9 млн рублей.`;
const APPEAL = `«Демо-Зенит» обжаловала решение по иску «Демо-Вектор», дело № ${CASE}.`;
const court = (quote: string, over: Parameters<typeof fx.event>[0]) =>
  fx.answer({ companies: [fx.company('Демо-Вектор', quote), fx.company('Демо-Зенит', quote)], events: [fx.event(over)] });
await ingest(FILED, court(FILED, { type: 'court_case', subject: 'Демо-Вектор', counterparty: 'Демо-Зенит', subject_role: 'plaintiff', counterparty_role: 'defendant', case_number: CASE, stage: 'claim_filed', amount: '12000000', currency: 'RUB', amount_purpose: 'claim', quote: FILED }));
await ingest(DECISION, court(DECISION, { type: 'court_case', subject: 'Демо-Вектор', counterparty: 'Демо-Зенит', subject_role: 'plaintiff', counterparty_role: 'defendant', case_number: CASE, stage: 'decision', outcome: 'satisfied', amount: '9000000', currency: 'RUB', amount_purpose: 'award', quote: DECISION }));
await ingest(APPEAL, court(APPEAL, { type: 'court_case', subject: 'Демо-Зенит', counterparty: 'Демо-Вектор', subject_role: 'defendant', counterparty_role: 'plaintiff', case_number: CASE, stage: 'appeal_filed', quote: APPEAL }));

// 4. Состояние объекта: приостановка и возобновление, затем поздняя мартовская статья.
const STATE = 'Работы на ЖК «Демо-Причал», приостановленные в марте 2026 года, возобновлены в июле 2026 года.';
await ingest(STATE, fx.answer({
  projects: [fx.project('Демо-Причал', STATE)],
  events: [
    fx.event({ type: 'suspension', project: 'Демо-Причал', date_from: '2026-03', date_precision: 'month', quote: STATE }),
    fx.event({ type: 'resumption', project: 'Демо-Причал', date_from: '2026-07', date_precision: 'month', quote: STATE }),
  ],
}));
const LATE = 'В марте 2026 года работы на ЖК «Демо-Причал» приостановлены.';
await ingest(LATE, fx.answer({
  projects: [fx.project('Демо-Причал', LATE)],
  events: [fx.event({ type: 'suspension', project: 'Демо-Причал', date_from: '2026-03-15', date_precision: 'day', quote: LATE })],
}));

const pool = getPool();
const show = async (label: string, sql: string): Promise<void> => {
  const rows = (await pool.query(sql)).rows;
  console.log(`[seed] ${label}:`);
  for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
};
console.log(`[seed] набор цепочки договоров #${chain.setId} (${chain.published})`);
await show('договоры', `SELECT sc.name AS subject, oc.name AS object, a.role, a.modality, a.scope_building AS building, a.work_package AS wp
  FROM assertions a JOIN companies sc ON sc.id = a.subject_company_id JOIN companies oc ON oc.id = a.object_company_id
  WHERE a.predicate = 'contract' ORDER BY a.id`);
await show('на проверку', `SELECT rejected_reason FROM candidate_assertions WHERE rejected_reason LIKE 'на проверку%'`);
await show('очередь', 'SELECT priority, kind, ref_id FROM review_queue_v ORDER BY priority, ref_id');
await show('дело', `SELECT case_key, event_stage, event_outcome, value_type, value_numeric::text FROM legal_case_events_v WHERE case_number IS NOT NULL ORDER BY valid_from NULLS FIRST, assertion_id`);
await show('состояние объекта', `SELECT state, valid_from::text, period_precision FROM project_current_state_v`);

await closeDb();
