// Синтетические обращения этапа 17: подтверждаемая цепочка, неизвестный прямой договор, противоречивые роли.
// Самостоятельный сценарий (свои компании и объект «Ручей-Демо»), модель подменена шаблонными ответами. Только тестовая база.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-brief

// Общий preflight тестовой цели — до импорта env и пула (src/db/testTargetBootstrap.ts).
const { prepareTestTargetProcess } = await import('../../db/testTargetBootstrap.js');
prepareTestTargetProcess();

const { closeDb, getPool } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { claimNextRun, enqueueRun, processRun } = await import('../../reprocess/runs.js');
const { publishCandidateSet } = await import('../../reprocess/publish.js');
const { createCase, createCaseSchema } = await import('../../dossier/cases.js');
const fx = await import('../../reprocess/semantic/__fixtures__/semanticAnswers.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_brief_channel', status: 'paused', access: 'approved', ai: 'approved' });
let n = 0;
const ingest = async (body: string, answer: ReturnType<typeof fx.answer>): Promise<void> => {
  n += 1;
  const stored = await storeDocument({ sourceId: source, sourceRunId: null, externalId: `demo_brief_channel/${n}`, url: null, title: null, body, publishedAt: new Date(), forwardFrom: null });
  if (!stored.revisionId) {
    // Перепечатка может быть признана дублем без новой редакции — это тоже честный исход, не ошибка сценария.
    console.log(`[seed] публикация ${n}: ${stored.outcome} — без разбора`);
    return;
  }
  const provider = fx.semanticProvider(() => answer);
  const queued = await enqueueRun(getPool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'seed' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('seed-brief', { runId: queued.runId }))!);
  await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'seed' });
};

// 1. Подтверждаемая цепочка: договор субподряда по корпусу 3 и участие исполнителя.
const CONTRACT = '«Бета-Демо» заключила договор субподряда с «Дельта-Демо» на монтаж ВК корпуса 3 ЖК «Ручей-Демо».';
await ingest(`Сводка по стройке. ${CONTRACT}`, fx.answer({
  companies: [fx.company('Бета-Демо', CONTRACT), fx.company('Дельта-Демо', CONTRACT)],
  projects: [fx.project('Ручей-Демо', CONTRACT)],
  relations: [
    fx.relation({ type: 'contract', kind: 'subcontract', subject: 'Бета-Демо', object: 'Дельта-Демо', project: 'Ручей-Демо', building: 'корпус 3', work_package: 'ВК', quote: CONTRACT }),
    fx.relation({ type: 'participation', kind: 'subcontractor', subject: 'Дельта-Демо', project: 'Ручей-Демо', building: 'корпус 3', work_package: 'ВК', quote: CONTRACT }),
  ],
}));
// Перепечатка того же текста в другой публикации — одна семья текста, не второе подтверждение.
await ingest(`Сводка по стройке. ${CONTRACT}`, fx.answer({
  companies: [fx.company('Бета-Демо', CONTRACT), fx.company('Дельта-Демо', CONTRACT)],
  projects: [fx.project('Ручей-Демо', CONTRACT)],
  relations: [fx.relation({ type: 'participation', kind: 'subcontractor', subject: 'Дельта-Демо', project: 'Ручей-Демо', building: 'корпус 3', work_package: 'ВК', quote: CONTRACT })],
}));

// 2. Участие без договора: прямой заказчик неизвестен.
const PART = '«Эпсилон-Демо» выполняет отделочные работы в корпусе 3 ЖК «Ручей-Демо».';
await ingest(`Новости застройщика. ${PART}`, fx.answer({
  companies: [fx.company('Эпсилон-Демо', PART)],
  projects: [fx.project('Ручей-Демо', PART)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Эпсилон-Демо', project: 'Ручей-Демо', building: 'корпус 3', work_package: 'отделка', quote: PART })],
}));

// 3. Противоречивые роли: участие и отрицание из разных публикаций; иск к компании как общий фон.
const ZETA = '«Зета-Демо» — генподрядчик корпуса 3 ЖК «Ручей-Демо».';
await ingest(`Обзор рынка. ${ZETA}`, fx.answer({
  companies: [fx.company('Зета-Демо', ZETA)],
  projects: [fx.project('Ручей-Демо', ZETA)],
  relations: [fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Зета-Демо', project: 'Ручей-Демо', building: 'корпус 3', quote: ZETA })],
}));
const DENY = 'Застройщик сообщил, что «Зета-Демо» не является генподрядчиком ЖК «Ручей-Демо».';
await ingest(DENY, fx.answer({
  companies: [fx.company('Зета-Демо', DENY)],
  projects: [fx.project('Ручей-Демо', DENY)],
  relations: [fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Зета-Демо', project: 'Ручей-Демо', polarity: 'negative', quote: DENY })],
}));
const SUIT = '«Омега-Демо» подала иск к «Зета-Демо» о взыскании 2 млн рублей по другому объекту.';
await ingest(`Судебная хроника. ${SUIT}`, fx.answer({
  companies: [fx.company('Омега-Демо', SUIT), fx.company('Зета-Демо', SUIT)],
  events: [fx.event({ type: 'court_case', subject: 'Омега-Демо', counterparty: 'Зета-Демо', subject_role: 'plaintiff', counterparty_role: 'defendant', stage: 'claim_filed', amount: '2000000', currency: 'RUB', amount_purpose: 'claim', quote: SUIT })],
}));

const pool = getPool();
const idOf = async (table: 'companies' | 'projects', name: string): Promise<number> => {
  const row = (await pool.query<{ id: number }>(`SELECT id FROM ${table} WHERE name = $1 AND merged_into_id IS NULL ORDER BY id LIMIT 1`, [name])).rows[0];
  if (!row) throw new Error(`не найдено: ${table} «${name}»`);
  return Number(row.id);
};
const project = await idOf('projects', 'Ручей-Демо');
const cases = [
  { key: 'chain', title: 'ВК корпуса 3 — подтверждаемая цепочка', company: 'Дельта-Демо', role: 'subcontractor', client: 'Бета-Демо', work: 'ВК' },
  { key: 'unknown-contract', title: 'Отделка корпуса 3 — прямой договор неизвестен', company: 'Эпсилон-Демо', role: 'contractor', client: null, work: 'отделка' },
  { key: 'contradicted', title: 'Генподряд корпуса 3 — противоречивые роли', company: 'Зета-Демо', role: 'general_contractor', client: null, work: null },
] as const;
for (const c of cases) {
  const input = createCaseSchema.parse({
    title: c.title,
    companyId: await idOf('companies', c.company),
    projectId: project,
    scopeBuilding: 'корпус 3',
    workPackageLabel: c.work,
    claimedRole: c.role,
    claimedClientCompanyId: c.client ? await idOf('companies', c.client) : null,
    claimedTerms: c.key === 'chain' ? 'аванс 30% со слов обратившегося' : null,
    requestDate: '2026-09-17',
    idempotencyKey: `seed-brief-${c.key}`,
  });
  const { row, replayed } = await createCase(input, 'seed');
  console.log(`[seed] обращение #${row.id} «${row.title}»${replayed ? ' (уже было)' : ''}`);
}
await closeDb();
