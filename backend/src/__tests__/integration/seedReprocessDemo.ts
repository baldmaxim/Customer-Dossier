// Синтетический разбор новым конвейером — для ручной проверки --runs / --preview /
// --publish и карточки. Модель подменена детерминированным ответом (LM Studio не нужен).
// Только тестовая база, с той же проверкой цели, что у интеграционных тестов.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-reprocess
//
// Создаёт публикацию с двумя редакциями: по первой — опубликованный набор, по второй —
// набор, ждущий публикации (одно основание снимется, одно добавится). Плюс
// набор поздно завершившегося старого разбора первой редакции — устаревший.

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
const fx = await import('../../reprocess/__fixtures__/extraction.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({
  kind: 'telegram',
  key: 'demo_reprocess_channel',
  status: 'paused',
  access: 'approved',
  ai: 'approved',
});

const ROLE = '«Демо-Зета» — генподрядчик ЖК «Демо-Роща»';
const DELAY = '«Демо-Зета» перенесла сдачу ЖК «Демо-Роща» на весну';
const COURT = '«Демо-Зета» получила иск субподрядчика';

const store = async (body: string) => {
  const stored = await storeDocument({
    sourceId: source,
    sourceRunId: null,
    externalId: 'demo_reprocess_channel/1',
    url: null,
    title: null,
    body,
    publishedAt: null,
    forwardFrom: null,
  });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  return stored.revisionId;
};

const run = async (revisionId: number, model: string, answer: ReturnType<typeof fx.extraction>) => {
  const provider = fx.fakeProvider(() => fx.ok(answer), model);
  const queued = await enqueueRun(getPool(), {
    revisionId,
    provider,
    chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 },
    requestedBy: 'seed',
  });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const claim = await claimNextRun('seed', { runId: queued.runId });
  const result = await processRun(provider, claim!);
  return { runId: queued.runId, setId: result.candidateSetId! };
};

const company = fx.company('Демо-Зета', ROLE);
const projectExtract = fx.project('Демо-Роща', ROLE);

const r1 = await store(`Канал застройщика: ${ROLE}. Позже: ${DELAY}.`);
const staleProvider = fx.fakeProvider(() => fx.ok(fx.extraction()), 'demo-model-old');
const staleQueued = await enqueueRun(getPool(), { revisionId: r1, provider: staleProvider, requestedBy: 'seed' });

const first = await run(
  r1,
  'demo-model',
  fx.extraction({
    companies: [company],
    projects: [projectExtract],
    links: [fx.link('Демо-Зета', 'Демо-Роща', 'general_contractor')],
    events: [fx.event('delay', DELAY, { company: 'Демо-Зета', project: 'Демо-Роща' })],
  }),
);
await publishCandidateSet({ setId: first.setId, expectedVersion: 0, actor: 'seed' });

const r2 = await store(`Канал застройщика (правка): ${ROLE}. Кроме того, ${COURT}.`);
const second = await run(
  r2,
  'demo-model',
  fx.extraction({
    companies: [company],
    projects: [projectExtract],
    links: [fx.link('Демо-Зета', 'Демо-Роща', 'general_contractor')],
    events: [fx.event('court_case', COURT, { company: 'Демо-Зета' })],
  }),
);

// Старый разбор первой редакции завершается последним.
if (staleQueued.outcome !== 'queued') throw new Error('устаревший запуск не поставлен');
const staleClaim = await claimNextRun('seed-late', { runId: staleQueued.runId });
const stale = await processRun(staleProvider, staleClaim!);

console.log(`[seed] опубликован набор #${first.setId} (редакция 1)`);
console.log(`[seed] ждёт публикации набор #${second.setId} (редакция 2)`);
console.log(`[seed] устаревший набор #${stale.candidateSetId} (старый разбор редакции 1)`);
await closeDb();
