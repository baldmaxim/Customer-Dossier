// Синтетическое утверждение с двумя поддерживающими и одним опровергающим
// доказательством — для ручной проверки панели «Проверка утверждений».
// Только тестовая база, с той же проверкой цели, что у интеграционных тестов.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-assertions

process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

const { assertTestDatabaseUrl } = await import('../../db/testTarget.js');
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.DOTENV_CONFIG_PATH = 'seed-no-dotenv.env';

const { closeDb, getPool, withTransaction } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { addEvidence, upsertAssertion } = await import('../../assertions/repository.js');
const { locateQuote } = await import('../../assertions/span.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_assertions_channel', status: 'paused' });
const companyId = (
  await getPool().query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Гамма', 'демо гамма', 'demo gamma') RETURNING id`,
  )
).rows[0]!.id;
const projectId = (
  await getPool().query<{ id: number }>(
    `INSERT INTO projects (name, name_norm, name_latin, city) VALUES ('Демо-Квартал', 'демо квартал', 'demo kvartal', 'Москва') RETURNING id`,
  )
).rows[0]!.id;

const SUPPORT = '«Демо-Гамма» — генподрядчик корпуса 3 ЖК «Демо-Квартал»';
const CONTRA = '«Демо-Гамма» не является генподрядчиком ЖК «Демо-Квартал»';
const texts = [
  `Пресс-релиз застройщика: ${SUPPORT}, работы начаты в июне.`,
  `Отраслевой канал: по данным источника, ${SUPPORT}.`,
  `Комментарий компании: ${CONTRA}, компания выполняет только поставку.`,
];

const revisions: Array<{ id: number; body: string }> = [];
for (const [index, body] of texts.entries()) {
  const stored = await storeDocument({
    sourceId: source,
    sourceRunId: null,
    externalId: `demo_assertions_channel/${Date.now()}-${index}`,
    url: null,
    title: null,
    body,
    publishedAt: new Date(`2026-09-0${index + 1}T10:00:00Z`),
    forwardFrom: null,
  });
  revisions.push({ id: stored.revisionId!, body });
}

const assertionId = await withTransaction(async client => {
  const assertion = await upsertAssertion(
    client,
    {
      predicate: 'participates_in_project',
      role: 'general_contractor',
      eventType: null,
      subjectCompanyId: companyId,
      subjectProjectId: null,
      subjectText: null,
      objectCompanyId: null,
      objectProjectId: projectId,
      objectText: null,
      counterpartyCompanyId: null,
      scopeBuilding: 'корпус 3',
      workPackage: null,
      validFrom: null,
      validTo: null,
      periodPrecision: 'unknown',
      modality: 'reported_fact',
      valueType: null,
      valueNumeric: null,
      valueCurrency: null,
    },
    { origin: 'manual', confidenceExtraction: 0.87, confidenceIdentity: null },
  );
  const plan: Array<[number, string, 'supports' | 'contradicts']> = [
    [0, SUPPORT, 'supports'],
    [1, SUPPORT, 'supports'],
    [2, CONTRA, 'contradicts'],
  ];
  for (const [index, quote, stance] of plan) {
    const revision = revisions[index]!;
    const location = locateQuote(revision.body, quote);
    if (location.kind !== 'unique') throw new Error('цитата не найдена однозначно');
    await addEvidence(client, {
      assertionId: assertion.id,
      revisionId: revision.id,
      stance,
      span: location.span,
      origin: 'manual',
      extractionId: null,
      legacyKind: null,
      legacyId: null,
    });
  }
  return assertion.id;
});

console.log(`[seed] утверждение ${assertionId}: админка → «Проверка утверждений» → фильтр «Есть в тексте»`);
await closeDb();
