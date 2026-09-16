// Синтетический корпус сквозной приёмки (этап 09). Только тестовая база, только выдуманные компании,
// объекты и тексты; реальных источников, ссылок и реквизитов действующих организаций здесь нет.
//
// Что в наборе: два одноимённых юрлица с разными ИНН; заказчик, генподрядчик и подрядчик на двух корпусах;
// положительное участие и отрицание из другой публикации; два разных судебных дела; три перепечатки одного
// текста в разных каналах; смена подрядчика на корпусе 1; правка новости (вторая редакция той же публикации).
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-release

// Общий preflight тестовой цели — до импорта env и пула (src/db/testTargetBootstrap.ts).
const { prepareTestTargetProcess } = await import('../../db/testTargetBootstrap.js');
prepareTestTargetProcess();

const { closeDb, getPool } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { claimNextRun, enqueueRun, processRun } = await import('../../reprocess/runs.js');
const { publishCandidateSet } = await import('../../reprocess/publish.js');
const { refreshSignals } = await import('../../signals/refresh.js');
const fx = await import('../../reprocess/semantic/__fixtures__/semanticAnswers.js');
const { INN_A, INN_B } = await import('../../reprocess/__fixtures__/extraction.js');

await assertIsolatedTarget();

const channel = await insertSyntheticSource({ kind: 'telegram', key: 'demo_release_channel', status: 'paused', access: 'approved', ai: 'approved' });
const digest = await insertSyntheticSource({ kind: 'telegram', key: 'demo_release_digest', status: 'paused', access: 'approved', ai: 'approved' });
const site = await insertSyntheticSource({ kind: 'website', key: 'demo_release_site', status: 'paused', access: 'approved', ai: 'approved' });

let seq = 0;
const ingest = async (
  sourceId: number,
  body: string,
  answer: ReturnType<typeof fx.answer>,
  options: { externalId?: string; publishedAt?: Date } = {},
): Promise<{ outcome: string; revisionId: number | null }> => {
  seq += 1;
  const externalId = options.externalId ?? `release/${seq}`;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId,
    url: null,
    title: null,
    body,
    publishedAt: options.publishedAt ?? new Date(),
    forwardFrom: null,
  });
  if (!stored.revisionId) return { outcome: stored.outcome, revisionId: null };
  if (stored.outcome === 'unchanged') return { outcome: stored.outcome, revisionId: stored.revisionId };
  const provider = fx.semanticProvider(() => answer);
  const queued = await enqueueRun(getPool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'seed' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('seed-release', { runId: queued.runId }))!);
  // Повторная публикация той же публикации (правка новости) ждёт текущую версию указателя, а не 0.
  const expectedVersion = (await getPool().query<{ version: number }>(
      `SELECT p.version FROM item_publications p JOIN candidate_sets s ON s.source_item_id = p.source_item_id WHERE s.id = $1`,
      [run.candidateSetId],
    )).rows[0]?.version ?? 0;
  await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion, actor: 'seed' });
  return { outcome: stored.outcome, revisionId: stored.revisionId };
};

// 1. Цепочка: заказчик «Порт-Релиз» → генподрядчик «Бета-Релиз» → подрядчик «Альфа-Релиз» (корпус 2).
const GC = 'Заказчик «Порт-Релиз» заключил договор генподряда с «Бета-Релиз» на ЖК «Причал-Релиз».';
await ingest(channel, `Новости стройки. ${GC}`, fx.answer({
  companies: [fx.company('Порт-Релиз', GC), fx.company('Бета-Релиз', GC)],
  projects: [fx.project('Причал-Релиз', GC)],
  relations: [fx.relation({ type: 'contract', kind: 'general_contract', subject: 'Порт-Релиз', object: 'Бета-Релиз', project: 'Причал-Релиз', quote: GC })],
}));

const SUB = `«Бета-Релиз» заключила договор субподряда с ООО «Альфа-Релиз» (ИНН ${INN_A}) на монтаж систем ВК корпуса 2.`;
await ingest(channel, `Новости стройки. ${SUB}`, fx.answer({
  companies: [fx.company('Бета-Релиз', SUB), fx.company('Альфа-Релиз', SUB, { legal_form: 'ООО', tax_id: INN_A })],
  relations: [fx.relation({ type: 'contract', kind: 'subcontract', subject: 'Бета-Релиз', object: 'Альфа-Релиз', building: 'корпус 2', work_package: 'монтаж систем ВК', quote: SUB })],
}));

const PART = `ООО «Альфа-Релиз» (ИНН ${INN_A}) ведёт монтаж систем ВК корпуса 2 ЖК «Причал-Релиз» с июня 2026 года.`;
await ingest(channel, PART, fx.answer({
  companies: [fx.company('Альфа-Релиз', PART, { legal_form: 'ООО', tax_id: INN_A })],
  projects: [fx.project('Причал-Релиз', PART)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Релиз', project: 'Причал-Релиз', building: 'корпус 2', work_package: 'монтаж систем ВК', date_from: '2026-06', date_precision: 'month', quote: PART })],
}));

// 2. Одноимённое юрлицо с другим ИНН — в досье не смешивается.
const OTHER = `АО «Альфа-Релиз» (ИНН ${INN_B}) строит складской комплекс в промзоне и к ЖК отношения не имеет.`;
await ingest(site, OTHER, fx.answer({ companies: [fx.company('Альфа-Релиз', OTHER, { legal_form: 'АО', tax_id: INN_B })] }));

// 3. Отрицание участия из другой публикации — противоречие, а не молчаливая замена.
const DENY = `Компания «Альфа-Релиз» (ИНН ${INN_A}) не является подрядчиком корпуса 2 ЖК «Причал-Релиз», сообщил заказчик.`;
await ingest(digest, DENY, fx.answer({
  companies: [fx.company('Альфа-Релиз', DENY, { tax_id: INN_A })],
  projects: [fx.project('Причал-Релиз', DENY)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Релиз', project: 'Причал-Релиз', building: 'корпус 2', polarity: 'negative', quote: DENY })],
}));

// 4. Смена подрядчика на корпусе 1: сначала «Гамма-Релиз», затем «Дельта-Релиз».
const OLD = 'ООО «Гамма-Релиз» выполняло отделку корпуса 1 ЖК «Причал-Релиз» с марта 2025 по март 2026 года.';
await ingest(channel, OLD, fx.answer({
  companies: [fx.company('Гамма-Релиз', OLD, { legal_form: 'ООО' })],
  projects: [fx.project('Причал-Релиз', OLD)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Гамма-Релиз', project: 'Причал-Релиз', building: 'корпус 1', work_package: 'отделка', date_from: '2025-03', date_to: '2026-03', date_precision: 'month', quote: OLD })],
}));

const NEW = 'С апреля 2026 года отделку корпуса 1 ЖК «Причал-Релиз» ведёт ООО «Дельта-Релиз».';
await ingest(channel, NEW, fx.answer({
  companies: [fx.company('Дельта-Релиз', NEW, { legal_form: 'ООО' })],
  projects: [fx.project('Причал-Релиз', NEW)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Дельта-Релиз', project: 'Причал-Релиз', building: 'корпус 1', work_package: 'отделка', date_from: '2026-04', date_precision: 'month', quote: NEW })],
}));

// 5. Два разных судебных дела: в одном компания истец, в другом ответчик.
const CASE1 = `ООО «Альфа-Релиз» (ИНН ${INN_A}) подало иск к «Гамма-Релиз» по делу А40-111/2026 о взыскании 3 млн рублей.`;
await ingest(channel, CASE1, fx.answer({
  companies: [fx.company('Альфа-Релиз', CASE1, { legal_form: 'ООО', tax_id: INN_A }), fx.company('Гамма-Релиз', CASE1)],
  events: [fx.event({ type: 'court_case', subject: 'Альфа-Релиз', counterparty: 'Гамма-Релиз', subject_role: 'plaintiff', counterparty_role: 'defendant', case_number: 'А40-111/2026', stage: 'claim_filed', amount: '3000000', currency: 'RUB', amount_purpose: 'claim', date_from: '2026-02', date_precision: 'month', quote: CASE1 })],
}));

const CASE2 = `К ООО «Альфа-Релиз» (ИНН ${INN_A}) подан иск по делу А40-222/2026: заказчик требует 5 млн рублей неустойки.`;
await ingest(digest, CASE2, fx.answer({
  companies: [fx.company('Альфа-Релиз', CASE2, { legal_form: 'ООО', tax_id: INN_A })],
  events: [fx.event({ type: 'court_case', subject: 'Альфа-Релиз', subject_role: 'defendant', case_number: 'А40-222/2026', stage: 'claim_filed', amount: '5000000', currency: 'RUB', amount_purpose: 'claim', date_from: '2026-05', date_precision: 'month', quote: CASE2 })],
}));

// 6. Перепечатки: один и тот же текст в трёх источниках — три публикации, не три подтверждения.
const REPRINT = 'На корпусе 1 ЖК «Причал-Релиз» зафиксирована задержка передачи фронта работ.';
const reprintAnswer = fx.answer({
  projects: [fx.project('Причал-Релиз', REPRINT)],
  events: [fx.event({ type: 'delay', project: 'Причал-Релиз', building: 'корпус 1', date_from: '2026-07', date_precision: 'month', quote: REPRINT })],
});
for (const [i, sourceId] of [channel, digest, site].entries()) {
  await ingest(sourceId, `Сводка недели. ${REPRINT}`, reprintAnswer, { externalId: `release/reprint-${i + 1}` });
}

// 7. Правка новости: та же публикация канала, исправленный текст — вторая редакция, первая остаётся.
const EDIT_ID = 'release/edited';
const EDIT_V1 = 'ООО «Дельта-Релиз» получило контракт на отделку корпуса 1 на сумму 90 млн рублей.';
const EDIT_V2 = 'ООО «Дельта-Релиз» получило контракт на отделку корпуса 1 на сумму 80 млн рублей (уточнено).';
const editAnswer = (quote: string, amount: string): ReturnType<typeof fx.answer> =>
  fx.answer({
    companies: [fx.company('Дельта-Релиз', quote, { legal_form: 'ООО' })],
    events: [fx.event({ type: 'tender_award', subject: 'Дельта-Релиз', building: 'корпус 1', amount, currency: 'RUB', amount_purpose: 'contract', quote })],
  });
await ingest(channel, EDIT_V1, editAnswer(EDIT_V1, '90000000'), { externalId: EDIT_ID });
const edited = await ingest(channel, EDIT_V2, editAnswer(EDIT_V2, '80000000'), { externalId: EDIT_ID });

const signals = await refreshSignals({ requestedBy: 'seed' });
const pool = getPool();
const companies = (
  await pool.query<{ id: number; name: string; identifiers: string }>(
    `SELECT c.id, c.name, coalesce(string_agg(i.identifier_type || ' ' || i.value, ', '), 'реквизитов нет') AS identifiers
     FROM companies c LEFT JOIN entity_identifiers i ON i.company_id = c.id AND i.status = 'active'
     WHERE c.merged_into_id IS NULL GROUP BY c.id ORDER BY c.id`,
  )
).rows;
for (const c of companies) console.log(`[seed] компания #${c.id} ${c.name}: ${c.identifiers}`);
const stats = (
  await pool.query<{ items: number; revisions: number; assertions: number; evidence: number; events: number }>(
    `SELECT (SELECT count(*)::int FROM source_items) AS items, (SELECT count(*)::int FROM document_revisions) AS revisions,
            (SELECT count(*)::int FROM assertions) AS assertions, (SELECT count(*)::int FROM evidence) AS evidence,
            (SELECT count(*)::int FROM events) AS events`,
  )
).rows[0]!;
console.log(`[seed] публикаций ${stats.items}, редакций ${stats.revisions} (правка новости: ${edited.outcome}), утверждений ${stats.assertions}, доказательств ${stats.evidence}, событий ${stats.events}`);
const project = (await pool.query<{ id: number }>(`SELECT id FROM projects WHERE name = 'Причал-Релиз'`)).rows[0];
console.log(`[seed] объект «Причал-Релиз» #${project?.id}`);
console.log(`[seed] сигналы: ${signals.outcome}`);
await closeDb();
