// Синтетический сценарий рабочего досье (этап 08A): два одноимённых юрлица с разными ИНН, участие одного
// из них в корпусе 2, отрицание из другой публикации, задержка корпуса 1 до участия, иск, где компания — истец.
// Модель подменена шаблонными ответами (LM Studio не нужен). Только тестовая база.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-dossier

process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

const { assertTestDatabaseUrl } = await import('../../db/testTarget.js');
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.DOTENV_CONFIG_PATH = 'seed-no-dotenv.env';

const { closeDb, getPool } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { claimNextRun, enqueueRun, processRun } = await import('../../reprocess/runs.js');
const { publishCandidateSet } = await import('../../reprocess/publish.js');
const { refreshSignals } = await import('../../signals/refresh.js');
const fx = await import('../../reprocess/semantic/__fixtures__/semanticAnswers.js');
const { INN_A, INN_B } = await import('../../reprocess/__fixtures__/extraction.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_dossier_channel', status: 'paused', access: 'approved', ai: 'approved' });
let n = 0;
const ingest = async (body: string, answer: ReturnType<typeof fx.answer>): Promise<void> => {
  n += 1;
  const stored = await storeDocument({ sourceId: source, sourceRunId: null, externalId: `demo_dossier_channel/${n}`, url: null, title: null, body, publishedAt: new Date(), forwardFrom: null });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = fx.semanticProvider(() => answer);
  const queued = await enqueueRun(getPool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'seed' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('seed-dossier', { runId: queued.runId }))!);
  await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'seed' });
};

const PART = `ООО «Альфа-Демо» (ИНН ${INN_A}) приступило к монтажу систем ВК корпуса 2 ЖК «Берег-Демо» в июне 2026 года.`;
const DELAY = 'В 2024 году на корпусе 1 ЖК «Берег-Демо» произошла задержка строительства.';
await ingest(`${PART} ${DELAY}`, fx.answer({
  companies: [fx.company('Альфа-Демо', PART, { legal_form: 'ООО', tax_id: INN_A })],
  projects: [fx.project('Берег-Демо', PART)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', building: 'корпус 2', work_package: 'монтаж систем ВК', date_from: '2026-06', date_precision: 'month', quote: PART })],
  events: [fx.event({ type: 'delay', project: 'Берег-Демо', building: 'корпус 1', date_from: '2024', date_precision: 'year', quote: DELAY })],
}));

const OTHER = `АО «Альфа-Демо» (ИНН ${INN_B}) строит склад в промзоне.`;
await ingest(OTHER, fx.answer({ companies: [fx.company('Альфа-Демо', OTHER, { legal_form: 'АО', tax_id: INN_B })] }));

const GC = 'Генподрядчик ЖК «Берег-Демо» — «Бета-Демо».';
await ingest(GC, fx.answer({
  companies: [fx.company('Бета-Демо', GC)],
  projects: [fx.project('Берег-Демо', GC)],
  relations: [fx.relation({ type: 'participation', kind: 'general_contractor', subject: 'Бета-Демо', project: 'Берег-Демо', quote: GC })],
}));

const COURT = `ООО «Альфа-Демо» (ИНН ${INN_A}) подало иск к «Гамма-Демо» о взыскании 3 млн рублей.`;
await ingest(COURT, fx.answer({
  companies: [fx.company('Альфа-Демо', COURT, { legal_form: 'ООО', tax_id: INN_A }), fx.company('Гамма-Демо', COURT)],
  events: [fx.event({ type: 'court_case', subject: 'Альфа-Демо', counterparty: 'Гамма-Демо', subject_role: 'plaintiff', counterparty_role: 'defendant', stage: 'claim_filed', amount: '3000000', currency: 'RUB', amount_purpose: 'claim', quote: COURT })],
}));

const DENY = `Компания «Альфа-Демо» (ИНН ${INN_A}) не является подрядчиком ЖК «Берег-Демо», сообщил заказчик.`;
await ingest(DENY, fx.answer({
  companies: [fx.company('Альфа-Демо', DENY, { tax_id: INN_A })],
  projects: [fx.project('Берег-Демо', DENY)],
  relations: [fx.relation({ type: 'participation', kind: 'contractor', subject: 'Альфа-Демо', project: 'Берег-Демо', polarity: 'negative', quote: DENY })],
}));

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
const project = (await pool.query<{ id: number }>(`SELECT id FROM projects WHERE name = 'Берег-Демо'`)).rows[0];
console.log(`[seed] объект «Берег-Демо» #${project?.id}`);
console.log(`[seed] сигналы: ${signals.outcome}`);
await closeDb();
