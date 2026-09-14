// Синтетические пары для ручной проверки очереди слияний (этап 04).
// Только тестовая база, с той же проверкой цели, что у интеграционных тестов.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-identity
//
// Создаёт: пару-дубль компании с упоминаниями и ролью (сливается и отменяется),
// похожие юрлица с разными ИНН (слияние блокируется реквизитами),
// одинаковый ЖК в двух городах (слияние блокируется географией).

process.env.TG_INFO_ORIGINAL_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

const { assertTestDatabaseUrl } = await import('../../db/testTarget.js');
assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.TG_INFO_ORIGINAL_DATABASE_URL);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_SSL = 'false';
process.env.DOTENV_CONFIG_PATH = 'seed-no-dotenv.env';

const { closeDb, getPool, withTransaction } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { resolveCompany } = await import('../../resolve/company.js');
const { resolveProject } = await import('../../resolve/project.js');

await assertIsolatedTarget();

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_identity_channel', status: 'paused' });
const stored = await storeDocument({
  sourceId: source,
  sourceRunId: null,
  externalId: 'demo_identity_channel/1',
  url: null,
  title: null,
  body: 'Синтетика: «Демо-Гранит» — подрядчик ЖК «Демо-Роща», сообщил застройщик.',
  publishedAt: null,
  forwardFrom: null,
});

const company = (surface: string, taxId: string | null, legalForm: string | null) =>
  withTransaction(client => resolveCompany(client, { surface, taxId, legalForm, city: null, documentId: stored.documentId }));

// 1. Дубль без реквизитов у одного из пары: «Демо-Гранит» (ООО, ИНН) и «Гранит-Демо» (ООО).
const withInn = (await company('Демо-Гранит', '7707083893', 'ООО'))!.companyId;
const duplicate = (await company('Гранит-Демо', null, 'ООО'))!.companyId;
const projectId = (await withTransaction(client => resolveProject(client, { surface: 'ЖК «Демо-Роща»', city: 'Москва' })))!.projectId;
await getPool().query(
  `INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, quote, confidence, published_at)
   VALUES ($1, 'company', $2, 'Гранит-Демо', '«Демо-Гранит» — подрядчик', 0.9, now())`,
  [stored.documentId, duplicate],
);
await getPool().query(
  `INSERT INTO project_participants (project_id, company_id, role, confidence, evidence_document_id) VALUES ($1, $2, 'contractor', 0.9, $3)`,
  [projectId, duplicate, stored.documentId],
);
const pair = await getPool().query<{ id: number }>(
  `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons, sample_document_id)
   VALUES ('company', $1, $2, 0.88, '{"seed":"duplicate"}', $3)
   ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
   DO UPDATE SET status = 'pending', decided_by = NULL, decided_at = NULL
   RETURNING id`,
  [duplicate, withInn, stored.documentId],
);

// 2. Одинаковые названия, разные ИНН: слияние запрещено.
const other = (await company('Демо-Гранит Групп', '7736050003', 'ООО'))!.companyId;
const conflictPair = await getPool().query<{ id: number }>(
  `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons)
   VALUES ('company', $1, $2, 0.8, '{"seed":"identifier_conflict"}')
   ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
   DO UPDATE SET status = 'pending', decided_by = NULL, decided_at = NULL
   RETURNING id`,
  [other, withInn],
);

// 3. ЖК в двух городах.
const kazan = (await withTransaction(client => resolveProject(client, { surface: 'ЖК «Демо-Роща»', city: 'Казань' })))!.projectId;
const cityPair = await getPool().query<{ id: number }>(
  `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons)
   VALUES ('project', $1, $2, 0.8, '{"seed":"city_conflict"}')
   ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
   DO UPDATE SET status = 'pending', decided_by = NULL, decided_at = NULL
   RETURNING id`,
  [kazan, projectId],
);

console.log(`[seed] пара-дубль #${pair.rows[0]!.id}: «Гранит-Демо» → «Демо-Гранит» (сливается)`);
console.log(`[seed] пара с разными ИНН #${conflictPair.rows[0]!.id} (блокируется)`);
console.log(`[seed] ЖК в двух городах #${cityPair.rows[0]!.id} (блокируется)`);
await closeDb();
