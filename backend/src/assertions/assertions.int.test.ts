// Этап 03A на PostgreSQL: TC-019…TC-024, неизменяемость, FK, API решений.
// Компании, объекты и тексты синтетические.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import type { IAssertionContent } from './model.js';
import { addEvidence, upsertAssertion } from './repository.js';
import { locateQuote } from './span.js';

const PHRASE = '«Демо-Альфа» ведёт работы по ВК на ЖК «Берег-Демо»';
const CONTRA = '«Демо-Альфа» не участвует в строительстве ЖК «Берег-Демо»';

let api: ITestApi;
let companyId = 0;
let projectId = 0;
const revisions: Record<string, { id: number; body: string }> = {};

const content = (over: Partial<IAssertionContent> = {}): IAssertionContent => ({
  predicate: 'participates_in_project',
  role: 'contractor',
  eventType: null,
  subjectCompanyId: companyId,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: projectId,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: 'ВК',
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'reported_fact',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  ...over,
});

const evidenceFor = async (assertionId: number, revisionKey: string, quote: string, stance: 'supports' | 'contradicts') => {
  const revision = revisions[revisionKey]!;
  const location = locateQuote(revision.body, quote);
  if (location.kind !== 'unique') throw new Error(`цитата не найдена однозначно: ${location.kind}`);
  return withTransaction(client =>
    addEvidence(client, {
      assertionId,
      revisionId: revision.id,
      stance,
      span: location.span,
      origin: 'manual',
      extractionId: null,
      legacyKind: null,
      legacyId: null,
    }),
  );
};

const state = async (id: number) =>
  (
    await getPool().query<{ status: string; needs_revalidation: boolean; version: number }>(
      'SELECT status, needs_revalidation, version FROM assertions WHERE id = $1',
      [id],
    )
  ).rows[0]!;

beforeAll(async () => {
  await resetAndMigrate();
  const source = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_assert' });
  companyId = (
    await getPool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Альфа', 'демо альфа', 'demo alfa') RETURNING id`,
    )
  ).rows[0]!.id;
  projectId = (
    await getPool().query<{ id: number }>(
      `INSERT INTO projects (name, name_norm, name_latin) VALUES ('Берег-Демо', 'берег демо', 'bereg demo') RETURNING id`,
    )
  ).rows[0]!.id;

  const texts: Record<string, string> = {
    first: `Первый канал: ${PHRASE}, сообщили в пресс-службе.`,
    second: `Второй канал 🏗️: по данным редакции, ${PHRASE}.`,
    contra: `Опровержение: ${CONTRA}, заявили в компании.`,
    emoji: '🚧🚧 Синтетика: работы 🏗️ на объекте «Берег-Демо» идут по графику.',
  };
  let n = 0;
  for (const [key, body] of Object.entries(texts)) {
    n += 1;
    const stored = await storeDocument({
      sourceId: source,
      sourceRunId: null,
      externalId: `synthetic_assert/${n}`,
      url: null,
      title: null,
      body,
      publishedAt: null,
      forwardFrom: null,
    });
    revisions[key] = { id: stored.revisionId!, body };
  }
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('две основы одной связи и отзыв (TC-019)', () => {
  let assertionId = 0;
  let firstEvidence = 0;

  it('одинаковое содержание из двух документов — одно утверждение с двумя доказательствами', async () => {
    const a = await withTransaction(client => upsertAssertion(client, content(), { origin: 'manual', confidenceExtraction: 0.9, confidenceIdentity: null }));
    const b = await withTransaction(client => upsertAssertion(client, content(), { origin: 'manual', confidenceExtraction: 0.8, confidenceIdentity: null }));
    expect(b.id).toBe(a.id);
    assertionId = a.id;
    firstEvidence = (await evidenceFor(assertionId, 'first', PHRASE, 'supports')).id;
    await evidenceFor(assertionId, 'second', PHRASE, 'supports');
    expect((await state(assertionId)).status).toBe('text_grounded');
  });

  it('решение аналитика и отзыв одного доказательства: второе и решение на месте, нужен пересмотр', async () => {
    const before = await state(assertionId);
    const review = await api.call('POST', `/api/assertions/${assertionId}/reviews`, {
      decision: 'reviewed_supported',
      reason: 'сверено с двумя публикациями',
      expectedVersion: before.version,
      idempotencyKey: 'tc019-review-0001',
    });
    expect(review.status).toBe(201);

    const afterReview = await state(assertionId);
    const withdrawn = await api.call('POST', `/api/evidence/${firstEvidence}/withdraw`, {
      reason: 'первая публикация удалена источником',
      expectedVersion: afterReview.version,
    });
    expect(withdrawn.status).toBe(200);

    const detail = await api.call('GET', `/api/assertions/${assertionId}`);
    const evidence = detail.body.evidence as Array<{ id: number; status: string }>;
    expect(evidence.filter(e => e.status === 'active')).toHaveLength(1);
    expect(evidence.find(e => e.id === firstEvidence)?.status).toBe('withdrawn');
    expect(detail.body.reviews as unknown[]).toHaveLength(1);
    expect(detail.body.assertion).toMatchObject({ status: 'reviewed_supported', needsRevalidation: true });
  });

  it('TC-021: опровержение видно рядом с поддержкой', async () => {
    await evidenceFor(assertionId, 'contra', CONTRA, 'contradicts');
    const detail = await api.call('GET', `/api/assertions/${assertionId}`);
    const stances = (detail.body.evidence as Array<{ stance: string; status: string }>)
      .filter(e => e.status === 'active')
      .map(e => e.stance)
      .sort();
    expect(stances).toEqual(['contradicts', 'supports']);
    expect(detail.body.assertion).toMatchObject({ supportsCount: 1, contradictsCount: 1, needsRevalidation: true });
  });

  it('TC-020: новый смысл — новое утверждение без наследования решения; старое содержание не изменить', async () => {
    const planned = await withTransaction(client =>
      upsertAssertion(client, content({ modality: 'planned' }), {
        origin: 'manual',
        confidenceExtraction: null,
        confidenceIdentity: null,
        supersedesAssertionId: assertionId,
      }),
    );
    expect(planned.id).not.toBe(assertionId);
    await evidenceFor(planned.id, 'second', PHRASE, 'supports');
    expect((await state(planned.id)).status).toBe('text_grounded');
    const reviews = await getPool().query('SELECT 1 FROM review_decisions WHERE assertion_id = $1', [planned.id]);
    expect(reviews.rowCount).toBe(0);

    await expect(
      getPool().query(`UPDATE assertions SET modality = 'planned' WHERE id = $1`, [assertionId]),
    ).rejects.toThrow(/содержание утверждения неизменяемо/);
  });

  it('история не переписывается: решение и доказательство нельзя изменить или удалить', async () => {
    await expect(getPool().query(`UPDATE review_decisions SET reason = 'подмена'`)).rejects.toThrow(/только дополняется/);
    await expect(getPool().query('DELETE FROM evidence WHERE id = $1', [firstEvidence])).rejects.toThrow(/удаление запрещено/);
    await expect(
      getPool().query(`UPDATE evidence SET quote = 'подмена' WHERE id = $1`, [firstEvidence]),
    ).rejects.toThrow(/неизменяемо/);
  });
});

describe('конкурентные решения (TC-022)', () => {
  let assertionId = 0;

  beforeAll(async () => {
    assertionId = (
      await withTransaction(client =>
        upsertAssertion(client, content({ scopeBuilding: 'корпус 2' }), { origin: 'manual', confidenceExtraction: null, confidenceIdentity: null }),
      )
    ).id;
    await evidenceFor(assertionId, 'first', PHRASE, 'supports');
  });

  it('повтор с тем же ключом — тот же результат без дубля; тот же ключ с другим решением — 422', async () => {
    const version = (await state(assertionId)).version;
    const body = { decision: 'disputed', reason: 'нужен договор', expectedVersion: version, idempotencyKey: 'tc022-key-0001' };
    const first = await api.call('POST', `/api/assertions/${assertionId}/reviews`, body);
    const repeat = await api.call('POST', `/api/assertions/${assertionId}/reviews`, body);
    expect(first.status).toBe(201);
    expect(repeat.status).toBe(200);
    expect(repeat.body.replayed).toBe(true);
    const count = await getPool().query('SELECT 1 FROM review_decisions WHERE assertion_id = $1', [assertionId]);
    expect(count.rowCount).toBe(1);

    const mismatch = await api.call('POST', `/api/assertions/${assertionId}/reviews`, { ...body, decision: 'rejected' });
    expect(mismatch.status).toBe(422);
  });

  it('вторая вкладка со старой версией получает 409 и не затирает первое решение', async () => {
    const version = (await state(assertionId)).version;
    const tabA = await api.call('POST', `/api/assertions/${assertionId}/reviews`, {
      decision: 'reviewed_supported',
      expectedVersion: version,
      idempotencyKey: 'tc022-tab-a-0001',
    });
    const tabB = await api.call('POST', `/api/assertions/${assertionId}/reviews`, {
      decision: 'rejected',
      expectedVersion: version,
      idempotencyKey: 'tc022-tab-b-0001',
    });
    expect(tabA.status).toBe(201);
    expect(tabB.status).toBe(409);
    expect(tabB.body.code).toBe('version_conflict');
    expect((await state(assertionId)).status).toBe('reviewed_supported');
  });

  it('без входа и без CSRF решение не записывается', async () => {
    const version = (await state(assertionId)).version;
    const anonymous = await api.call(
      'POST',
      `/api/assertions/${assertionId}/reviews`,
      { decision: 'rejected', expectedVersion: version, idempotencyKey: 'tc022-anon-0001' },
      { cookie: '' },
    );
    const noCsrf = await api.call(
      'POST',
      `/api/assertions/${assertionId}/reviews`,
      { decision: 'rejected', expectedVersion: version, idempotencyKey: 'tc022-nocsrf-0001' },
      { 'x-csrf-token': '' },
    );
    expect(anonymous.status).toBe(401);
    expect(noCsrf.status).toBe(403);
  });
});

describe('ограничения базы (TC-023, TC-024)', () => {
  it('несуществующие компания, объект и редакция отвергаются FK', async () => {
    await expect(
      withTransaction(client =>
        upsertAssertion(client, content({ subjectCompanyId: 999_999_999 }), { origin: 'manual', confidenceExtraction: null, confidenceIdentity: null }),
      ),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      getPool().query(
        `INSERT INTO evidence (assertion_id, revision_id, stance, span_start, span_end, quote, origin)
         SELECT id, 999999999, 'supports', 0, 1, 'x', 'manual' FROM assertions LIMIT 1`,
      ),
    ).rejects.toThrow(/foreign key|не совпадает/i);
  });

  it('участие без объекта у разрешённой стороны отвергается CHECK', async () => {
    await expect(
      withTransaction(client =>
        upsertAssertion(client, content({ objectProjectId: null, scopeBuilding: 'без объекта' }), {
          origin: 'manual',
          confidenceExtraction: null,
          confidenceIdentity: null,
        }),
      ),
    ).rejects.toThrow(/assertions_predicate_shape/);
  });

  it('неразрешённая сторона допустима только у кандидата', async () => {
    const candidate = await withTransaction(client =>
      upsertAssertion(client, content({ subjectCompanyId: null, subjectText: 'ООО «Неизвестная»', scopeBuilding: 'кандидат' }), {
        origin: 'manual',
        confidenceExtraction: null,
        confidenceIdentity: null,
      }),
    );
    await expect(
      getPool().query(`UPDATE assertions SET status = 'reviewed_supported' WHERE id = $1`, [candidate.id]),
    ).rejects.toThrow(/assertions_subject_resolved/);
  });

  it('цитата, не совпадающая с фрагментом, отвергается базой', async () => {
    const assertionId = (await getPool().query<{ id: number }>('SELECT id FROM assertions ORDER BY id LIMIT 1')).rows[0]!.id;
    await expect(
      getPool().query(
        `INSERT INTO evidence (assertion_id, revision_id, stance, span_start, span_end, quote, origin)
         VALUES ($1, $2, 'supports', 0, 5, 'подмена', 'manual')`,
        [assertionId, revisions.first!.id],
      ),
    ).rejects.toThrow(/не совпадает с фрагментом/);
  });

  it('эмодзи и кириллица: offsets JS (code points) принимаются проверкой базы', async () => {
    const assertionId = (
      await withTransaction(client =>
        upsertAssertion(
          client,
          { ...content(), predicate: 'project_mentioned', role: null, workPackage: null, subjectCompanyId: null, subjectProjectId: projectId, objectProjectId: null },
          { origin: 'manual', confidenceExtraction: null, confidenceIdentity: null },
        ),
      )
    ).id;
    const added = await evidenceFor(assertionId, 'emoji', 'объекте «Берег-Демо»', 'supports');
    expect(added.created).toBe(true);
  });
});
