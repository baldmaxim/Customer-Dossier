// Ограниченный большой синтетический набор (этап 18): у одной компании больше 1000 утверждений (лимит выборки фактов
// досье — 1000), больше 2000 договорных рёбер (лимит рёбер схемы — 2000), вторые редакции и решения аналитика.
// Детерминированно (имена и порядок по номерам), только тестовая цель, реальные компании не используются.
//
//   TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test npm run seed:test-large -- --facts 1200 --edges 2100 --revised 50 --reviewed 50
//
// Верхние пределы жёсткие: не больше 5000 утверждений и 5000 рёбер за запуск. Повторный запуск не дублирует (проверка по имени).

const { prepareTestTargetProcess } = await import('../../db/testTargetBootstrap.js');
prepareTestTargetProcess();

const { closeDb, getPool, withTransaction } = await import('../../db/pool.js');
const { assertIsolatedTarget, insertSyntheticSource } = await import('./db.js');
const { storeDocument } = await import('../../ingest/store.js');
const { addEvidence, recordReviewDecision, upsertAssertion } = await import('../../assertions/repository.js');
const { locateQuote } = await import('../../assertions/span.js');
const { normalizeName } = await import('../../resolve/normalize.js');
const { createCase, createCaseSchema } = await import('../../dossier/cases.js');
type IAssertionContent = import('../../assertions/model.js').IAssertionContent;

await assertIsolatedTarget();

const argv = process.argv.slice(2);
const intFlag = (name: string, fallback: number, max: number): number => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? Number.parseInt(argv[i + 1] ?? '', 10) : fallback;
  if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new Error(`${name}: целое 0…${max}`);
  return v;
};
const FACTS = intFlag('--facts', 1200, 5000);
const EDGES = intFlag('--edges', 2100, 5000);
const REVISED = intFlag('--revised', 50, 500);
const REVIEWED = intFlag('--reviewed', 50, 500);
const PER_DOC = 40;
const pad = (n: number): string => String(n).padStart(4, '0');

const pool = getPool();
const TARGET = 'Масштаб-Демо';
if ((await pool.query('SELECT 1 FROM companies WHERE name = $1', [TARGET])).rowCount) {
  console.log(`[seed-large] «${TARGET}» уже есть — набор не дублируется`);
  await closeDb();
  process.exit(0);
}

const source = await insertSyntheticSource({ kind: 'telegram', key: 'demo_large_channel', status: 'paused', access: 'approved', ai: 'approved' });
const company = async (name: string): Promise<number> => {
  const norm = normalizeName(name, 'company');
  return Number(
    (
      await pool.query<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin, legal_form, entity_type) VALUES ($1, $2, $3, 'ООО', 'legal_entity') RETURNING id`,
        [name, norm.norm, norm.latin],
      )
    ).rows[0]!.id,
  );
};
const target = await company(TARGET);
const project = Number(
  (await pool.query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin, city) VALUES ('Масштаб-Объект', 'масштаб объект', 'masshtab obekt', NULL) RETURNING id`)).rows[0]!.id,
);

const base = (over: Partial<IAssertionContent>): IAssertionContent => ({
  predicate: 'participates_in_project',
  role: 'contractor',
  eventType: null,
  subjectCompanyId: target,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: project,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'reported_fact',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  ...over,
});

let docNo = 0;
const assertionIds: number[] = [];
/** Пачка предложений — одна публикация; каждое предложение — своё утверждение с доказательством-цитатой. */
const batch = async (sentences: Array<{ quote: string; content: IAssertionContent }>): Promise<{ externalId: string; body: string }> => {
  docNo += 1;
  const externalId = `demo_large_channel/${docNo}`;
  const body = `Синтетическая сводка ${docNo}. ${sentences.map(s => s.quote).join(' ')}`;
  const stored = await storeDocument({ sourceId: source, sourceRunId: null, externalId, url: null, title: null, body, publishedAt: new Date(Date.UTC(2026, 0, 1 + (docNo % 250))), forwardFrom: null });
  if (!stored.revisionId) throw new Error(`редакция не создана: ${stored.outcome}`);
  await withTransaction(async client => {
    for (const s of sentences) {
      const a = await upsertAssertion(client, s.content, { origin: 'manual', confidenceExtraction: 0.9, confidenceIdentity: null });
      const location = locateQuote(body, s.quote);
      if (location.kind !== 'unique') throw new Error(`цитата не уникальна: ${s.quote}`);
      await addEvidence(client, { assertionId: a.id, revisionId: stored.revisionId!, stance: 'supports', span: location.span, origin: 'manual', extractionId: null, legacyKind: null, legacyId: null });
      assertionIds.push(a.id);
    }
  });
  return { externalId, body };
};

// Утверждения об участии: разные корпуса — разные утверждения.
const docs: Array<{ externalId: string; body: string }> = [];
for (let i = 0; i < FACTS; i += PER_DOC) {
  const part = Array.from({ length: Math.min(PER_DOC, FACTS - i) }, (_, k) => {
    const n = i + k + 1;
    return { quote: `«${TARGET}» ведёт работы в корпусе ${pad(n)} объекта «Масштаб-Объект».`, content: base({ scopeBuilding: `корпус ${pad(n)}` }) };
  });
  docs.push(await batch(part));
}

// Договорные рёбра: у каждого партнёра свой договор с компанией.
for (let i = 0; i < EDGES; i += PER_DOC) {
  const part: Array<{ quote: string; content: IAssertionContent }> = [];
  for (let k = 0; k < Math.min(PER_DOC, EDGES - i); k += 1) {
    const n = i + k + 1;
    const partner = await company(`Партнёр-Демо-${pad(n)}`);
    part.push({ quote: `«Партнёр-Демо-${pad(n)}» заключила договор с «${TARGET}».`, content: base({ predicate: 'contract', role: 'subcontract', subjectCompanyId: partner, objectCompanyId: target, objectProjectId: null }) });
  }
  await batch(part);
}

// Вторые редакции первых публикаций: текст дополнен, прежние доказательства остаются на первой редакции.
for (const d of docs.slice(0, Math.ceil(REVISED / PER_DOC))) {
  const stored = await storeDocument({ sourceId: source, sourceRunId: null, externalId: d.externalId, url: null, title: null, body: `${d.body} Дополнение редакции.`, publishedAt: null, forwardFrom: null });
  console.log(`[seed-large] ${d.externalId}: ${stored.outcome}`);
}

// Решения аналитика по первым утверждениям.
for (const [i, assertionId] of assertionIds.slice(0, REVIEWED).entries()) {
  await withTransaction(async client =>
    recordReviewDecision(client, {
      assertionId,
      decision: 'reviewed_supported',
      scope: 'reflects_source',
      reason: 'синтетическое решение для замера',
      reviewer: 'seed-large',
      expectedVersion: (await client.query<{ version: number }>('SELECT version FROM assertions WHERE id = $1', [assertionId])).rows[0]!.version,
      idempotencyKey: `seed-large-review-${pad(i + 1)}`,
    }),
  );
}

const { row } = await createCase(
  createCaseSchema.parse({ title: 'Масштаб: корпус 0001', companyId: target, projectId: project, scopeBuilding: 'корпус 0001', claimedRole: 'contractor', requestDate: '2026-09-17', idempotencyKey: 'seed-large-case-0001' }),
  'seed-large',
);
console.log(`[seed-large] компания #${target}, объект #${project}, утверждений ${assertionIds.length} (участие ${FACTS}, договоры ${EDGES}), публикаций ${docNo}, решений ${Math.min(REVIEWED, assertionIds.length)}`);
console.log(`[seed-large] обращение #${row.id}: npm run release:bench -- --case-id ${row.id} --profile-queries`);
await closeDb();
