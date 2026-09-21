// Этап 03B на PostgreSQL: запуски, чанки, наборы кандидатов и публикация.
// Модель подменена детерминированным провайдером; реальный LLM-smoke — отдельно,
// LOCAL_MODEL_VALIDATED по этим тестам не выставляется. Тексты и компании синтетические.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import type { ILlmResult } from '../llm/client.js';
import { recordReviewDecision } from '../assertions/repository.js';
import { PublicationConflictError, previewCandidateSet, publishCandidateSet } from './publish.js';
import type { IChunkerParams, IModelProvider } from './provider.js';
import { claimNextRun, enqueueRun, processRun, retryRun, StaleLeaseError, type IRunResult } from './runs.js';
import { company, event, extraction, fakeProvider, INN_A, INN_B, link, ok, project } from './__fixtures__/extraction.js';

const CHUNKER: IChunkerParams = { chunkSize: 4000, maxChunks: 6, overlap: 50 };
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

let api: ITestApi;
let sourceMain = 0;
let sourceRevoke = 0;
let docCounter = 0;

const pool = () => getPool();

const store = async (sourceId: number, body: string, externalId?: string) => {
  docCounter += 1;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: externalId ?? `synthetic_reprocess/${docCounter}`,
    url: null,
    title: null,
    body,
    publishedAt: null,
    forwardFrom: null,
  });
  if (!stored.revisionId || !stored.sourceItemId) throw new Error(`редакция не создана: ${stored.outcome}`);
  return { revisionId: stored.revisionId, sourceItemId: stored.sourceItemId, documentId: stored.documentId };
};

const enqueue = async (revisionId: number, provider: IModelProvider, chunker: IChunkerParams = CHUNKER): Promise<number> => {
  const result = await enqueueRun(pool(), { revisionId, provider, chunker, requestedBy: 'test' });
  if (result.outcome !== 'queued') throw new Error(`запуск не поставлен: ${result.outcome}`);
  return result.runId;
};

const execute = async (runId: number, provider: IModelProvider, owner = 'w1'): Promise<IRunResult> => {
  const claim = await claimNextRun(owner, { runId });
  if (!claim) throw new Error(`запуск ${runId} не захвачен`);
  return processRun(provider, claim);
};

const publicationOf = async (sourceItemId: number) =>
  (
    await pool().query<{ active_set_id: number | null; version: number }>(
      'SELECT active_set_id, version FROM item_publications WHERE source_item_id = $1',
      [sourceItemId],
    )
  ).rows[0] ?? { active_set_id: null, version: 0 };

interface ICounts {
  assertions: number;
  evidence: number;
  evidence_active: number;
  reviews: number;
  companies: number;
  sets: number;
  published_items: number;
  history: number;
  responses: number;
}

/** Контрольные количества — сравнение таблиц до/после сценария. */
const counts = async (): Promise<ICounts> =>
  (
    await pool().query<ICounts>(
      `SELECT (SELECT count(*)::int FROM assertions) AS assertions,
              (SELECT count(*)::int FROM evidence) AS evidence,
              (SELECT count(*)::int FROM evidence WHERE status = 'active') AS evidence_active,
              (SELECT count(*)::int FROM review_decisions) AS reviews,
              (SELECT count(*)::int FROM companies) AS companies,
              (SELECT count(*)::int FROM candidate_sets) AS sets,
              (SELECT count(*)::int FROM item_publications WHERE active_set_id IS NOT NULL) AS published_items,
              (SELECT count(*)::int FROM publication_history) AS history,
              (SELECT count(*)::int FROM extraction_chunk_responses) AS responses`,
    )
  ).rows[0]!;

beforeAll(async () => {
  await resetAndMigrate();
  sourceMain = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_reprocess', access: 'approved', ai: 'approved' });
  sourceRevoke = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_revoke', access: 'approved', ai: 'approved' });
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

// ---------------------------------------------------------------------------

const Q_ROLE = '«Демо-Альфа» — генподрядчик ЖК «Берег-Демо»';
const Q_COURT_1 = '«Демо-Альфа» проиграла первый спор в арбитраже';
const Q_COURT_2 = '«Демо-Альфа» получила второй иск от поставщика';

const fullAnswer = extraction({
  companies: [company('Демо-Альфа', Q_ROLE)],
  projects: [project('Берег-Демо', Q_ROLE)],
  links: [link('Демо-Альфа', 'Берег-Демо', 'general_contractor')],
  events: [
    event('court_case', Q_COURT_1, { company: 'Демо-Альфа' }),
    event('court_case', Q_COURT_2, { company: 'Демо-Альфа' }),
  ],
});

describe('полный путь: запуск → чанк → набор → публикация', () => {
  let item = { revisionId: 0, sourceItemId: 0, documentId: null as number | null };
  let setId = 0;

  it('completed-запуск создаёт набор; карточки не меняются до публикации', async () => {
    item = await store(sourceMain, `Новости стройки. ${Q_ROLE}. Кроме того, ${Q_COURT_1}, а позже ${Q_COURT_2}.`);
    const provider = fakeProvider(() => ok(fullAnswer));
    const before = await counts();
    const run = await execute(await enqueue(item.revisionId, provider), provider);

    expect(run.status).toBe('completed');
    expect(run.coveredChars).toBe(run.totalChars);
    expect(run.candidateSetId).not.toBeNull();
    setId = run.candidateSetId!;

    const after = await counts();
    expect(after.assertions).toBe(before.assertions);
    expect(after.published_items).toBe(before.published_items);
    expect(after.sets).toBe(before.sets + 1);
  });

  it('предпросмотр показывает добавления; два суда — два события', async () => {
    const preview = await previewCandidateSet(setId);
    expect(preview.expectedVersion).toBe(0);
    expect(preview.policy.allowed).toBe(true);
    expect(preview.stale.stale).toBe(false);
    expect(preview.added.filter(a => a.predicate === 'event')).toHaveLength(2);
    expect(preview.removed).toEqual([]);
  });

  it('публикация: утверждения, доказательства evidence → chunk → run → revision, проекция карточки', async () => {
    const result = await publishCandidateSet({ setId, expectedVersion: 0, actor: 'test' });
    expect(result.outcome).toBe('published');
    expect(result.version).toBe(1);

    const chain = (
      await pool().query<{ revision_ok: boolean; chunk_id: number | null }>(
        `SELECT e.extraction_chunk_id AS chunk_id, (er.revision_id = e.revision_id AND e.revision_id = $2) AS revision_ok
         FROM candidate_set_evidence cse
         JOIN evidence e ON e.id = cse.evidence_id
         LEFT JOIN extraction_chunks c ON c.id = e.extraction_chunk_id
         LEFT JOIN extraction_runs er ON er.id = c.run_id
         WHERE cse.set_id = $1`,
        [setId, item.revisionId],
      )
    ).rows;
    expect(chain.length).toBeGreaterThanOrEqual(4);
    expect(chain.every(r => r.chunk_id !== null && r.revision_ok)).toBe(true);

    const machineReviewed = await pool().query(`SELECT 1 FROM assertions WHERE status = 'reviewed_supported'`);
    expect(machineReviewed.rowCount).toBe(0);

    const participations = await pool().query<{ origin: string }>(
      `SELECT v.origin FROM card_participations_v v JOIN companies c ON c.id = v.company_id WHERE c.name = 'Демо-Альфа'`,
    );
    expect(participations.rows.map(r => r.origin)).toContain('published');
    const events = await pool().query(
      `SELECT 1 FROM card_events_v v JOIN companies c ON c.id = v.company_id WHERE c.name = 'Демо-Альфа' AND v.origin = 'published'`,
    );
    expect(events.rowCount).toBe(2);
    const courts = await pool().query(
      `SELECT DISTINCT a.id FROM assertions a JOIN companies c ON c.id = a.subject_company_id
       WHERE c.name = 'Демо-Альфа' AND a.event_type = 'court_case' AND a.event_discriminator IS NOT NULL`,
    );
    expect(courts.rowCount).toBe(2);
  });

  it('повтор той же публикации идемпотентен', async () => {
    const before = await counts();
    const again = await publishCandidateSet({ setId, expectedVersion: 0, actor: 'test' });
    expect(again.outcome).toBe('already_published');
    expect(again.version).toBe(1);
    expect(await counts()).toEqual(before);
  });

  it('API: предпросмотр и 409 на устаревшую версию', async () => {
    const provider = fakeProvider(() => ok(fullAnswer), 'fake-model-api');
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    const preview = await api.call('GET', `/api/reprocess/sets/${run.candidateSetId}/preview`, undefined);
    expect(preview.status).toBe(200);
    expect(preview.body.expectedVersion).toBe(1);
    const token = String(preview.body.previewToken);
    const stale = await api.call('POST', `/api/reprocess/sets/${run.candidateSetId}/publish`, { expectedVersion: 0, expectedPreviewToken: token });
    expect(stale.status).toBe(409);
    // Тестовый клиент подставляет вход сам: отсутствие cookie и CSRF задаём явно.
    const anonymous = await api.call('POST', `/api/reprocess/sets/${run.candidateSetId}/publish`, { expectedVersion: 1, expectedPreviewToken: token }, { cookie: '' });
    const noCsrf = await api.call('POST', `/api/reprocess/sets/${run.candidateSetId}/publish`, { expectedVersion: 1, expectedPreviewToken: token }, { 'x-csrf-token': '' });
    expect(anonymous.status).toBe(401);
    expect(noCsrf.status).toBe(403);
    expect((await publicationOf(item.sourceItemId)).version).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('страница документа: что портал взял из текста', () => {
  it('после публикации — состояние in_cards, утверждения с цитатами и ссылки на карточки', async () => {
    const item = await store(sourceMain, `Стройка. ${Q_ROLE}. Затем ${Q_COURT_1}.`);
    const provider = fakeProvider(() => ok(fullAnswer), 'fake-model-outcome');
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    const published = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
    expect(published.outcome).toBe('published');

    const res = await api.call('GET', `/api/items/${item.sourceItemId}/extraction`, undefined);
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('in_cards');
    expect(res.body.activeSetId).toBe(run.candidateSetId);
    expect(res.body.run).toMatchObject({ status: 'completed', relevant: true });
    expect((res.body.policy as { allowed: boolean }).allowed).toBe(true);

    const names = (res.body.companies as Array<{ name: string }>).map(c => c.name);
    expect(names).toContain('Демо-Альфа');
    expect((res.body.projects as Array<{ name: string }>).map(p => p.name)).toContain('Берег-Демо');

    // У каждого утверждения — своя цитата, и она дословно есть в тексте редакции.
    const assertions = res.body.assertions as Array<{ predicate: string; quotes: Array<{ quote: string; spanStart: number; spanEnd: number }> }>;
    expect(assertions.length).toBeGreaterThan(0);
    expect(assertions.every(a => a.quotes.length > 0)).toBe(true);
    const body = (await pool().query<{ body: string }>('SELECT body FROM document_revisions WHERE id = $1', [item.revisionId])).rows[0]!.body;
    for (const a of assertions) {
      for (const q of a.quotes) expect(body).toContain(q.quote);
    }
    expect(assertions.some(a => a.predicate === 'participates_in_project')).toBe(true);
  });

  it('публикация без запуска: «ещё не разбирался», а не «ничего нет»', async () => {
    const item = await store(sourceMain, `Другой текст про стройку. ${Q_ROLE}.`);
    const res = await api.call('GET', `/api/items/${item.sourceItemId}/extraction`, undefined);

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('no_run');
    expect(res.body.run).toBeNull();
    expect(res.body.assertions).toEqual([]);
    expect(res.body.activeSetId).toBeNull();
  });

  it('неизвестная публикация — 404, а не пустой ответ', async () => {
    const res = await api.call('GET', '/api/items/99999999/extraction', undefined);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('неполные запуски не становятся completed', () => {
  const longBody = (tag: string): string =>
    Array.from({ length: 8 }, (_, i) => `Абзац ${i} ${tag}: ${'строительные новости '.repeat(4)}`).join('\n') +
    `\nПОСЛЕДНИЙ-${tag} абзац ${'хвост '.repeat(10)}`;
  const small: IChunkerParams = { chunkSize: 200, maxChunks: 20, overlap: 20 };

  it('падение последнего чанка → partial, набора нет, публикация не тронута', async () => {
    const item = await store(sourceMain, longBody('last'));
    const provider = fakeProvider((text): ILlmResult =>
      text.includes('ПОСЛЕДНИЙ-last')
        ? { ok: false, failure: 'invalid_json', message: 'обрыв', usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{"doc' }
        : ok(extraction({ doc_relevant: false })),
    );
    const before = await counts();
    const run = await execute(await enqueue(item.revisionId, provider, small), provider);
    expect(run.status).toBe('partial');
    expect(run.candidateSetId).toBeNull();
    expect(run.coveredChars).toBeLessThan(run.totalChars);
    const after = await counts();
    expect(after.sets).toBe(before.sets);
    expect(after.published_items).toBe(before.published_items);

    // Повтор — новым запуском; прежний запуск и его ответы не меняются.
    const fixed = fakeProvider(() => ok(extraction({ doc_relevant: false })));
    const retry = await retryRun(run.runId, fixed, 'test');
    expect(retry.outcome).toBe('queued');
    const retried = await execute((retry as { runId: number }).runId, fixed);
    expect(retried.status).toBe('completed');
    const old = await pool().query<{ status: string }>('SELECT status FROM extraction_runs WHERE id = $1', [run.runId]);
    expect(old.rows[0]!.status).toBe('partial');
  });

  it('TC-076: сбой позднего чанка ПОСЛЕ релевантного успешного — partial, канон и решения аналитика прежние, повтор публикует целиком', async () => {
    // Опубликованная первая редакция с решением аналитика.
    const Q_LATE = '«Демо-Поздний» — подрядчик ЖК «Берег-Демо»';
    const v1 = await store(sourceMain, `Первая редакция. ${Q_LATE}.`, 'synthetic_reprocess/late-chunk');
    const answerLate = extraction({ companies: [company('Демо-Поздний', Q_LATE)], projects: [project('Берег-Демо', Q_LATE)], links: [link('Демо-Поздний', 'Берег-Демо', 'contractor')] });
    const first = fakeProvider(() => ok(answerLate));
    const run1 = await execute(await enqueue(v1.revisionId, first), first);
    expect((await publishCandidateSet({ setId: run1.candidateSetId!, expectedVersion: 0, actor: 'test' })).outcome).toBe('published');
    const reviewed = (await pool().query<{ id: number; version: number }>(
      `SELECT a.id, a.version FROM assertions a JOIN companies c ON c.id = a.subject_company_id WHERE c.name = 'Демо-Поздний' ORDER BY a.id LIMIT 1`,
    )).rows[0]!;
    await withTransaction(client =>
      recordReviewDecision(client, { assertionId: reviewed.id, decision: 'reviewed_supported', scope: 'reflects_source', reason: 'сверено (синтетика)', reviewer: 'operator', expectedVersion: reviewed.version, idempotencyKey: 'reprocess-late-chunk-review' }),
    );
    const publication = await publicationOf(v1.sourceItemId);
    const reviewsBefore = (await pool().query('SELECT id, assertion_id, decision, reviewer, decided_at FROM review_decisions ORDER BY id')).rows;

    // Правка: длинный текст, первый чанк релевантен и успешен, последний падает.
    const edited = `Вторая редакция. ${Q_LATE}.\n${Array.from({ length: 8 }, (_, i) => `Абзац ${i}: ${'строительные новости '.repeat(4)}`).join('\n')}\nПОСЛЕДНИЙ-late2 абзац ${'хвост '.repeat(10)}`;
    const v2 = await store(sourceMain, edited, 'synthetic_reprocess/late-chunk');
    expect(v2.sourceItemId).toBe(v1.sourceItemId);
    const failing = fakeProvider((text): ILlmResult =>
      text.includes('ПОСЛЕДНИЙ-late2')
        ? { ok: false, failure: 'invalid_json', message: 'обрыв', usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{"doc' }
        : text.includes(Q_LATE)
          ? ok(answerLate)
          : ok(extraction({ doc_relevant: false })),
    );
    const before = await counts();
    const run2 = await execute(await enqueue(v2.revisionId, failing, { chunkSize: 200, maxChunks: 20, overlap: 20 }), failing);
    expect(run2.status).toBe('partial');
    expect(run2.candidateSetId).toBeNull();
    const outcomes = (await pool().query<{ outcome: string; n: number }>(
      `SELECT resp.outcome, count(*)::int AS n FROM extraction_chunk_responses resp JOIN extraction_chunks c ON c.id = resp.chunk_id
       WHERE c.run_id = $1 GROUP BY resp.outcome`,
      [run2.runId],
    )).rows;
    expect(outcomes.find(o => o.outcome === 'ok')?.n ?? 0).toBeGreaterThan(0);
    expect(outcomes.some(o => o.outcome !== 'ok')).toBe(true);
    const after = await counts();
    expect({ ...after, responses: 0 }).toEqual({ ...before, responses: 0 });
    expect(await publicationOf(v1.sourceItemId)).toEqual(publication);
    expect((await pool().query('SELECT id, assertion_id, decision, reviewer, decided_at FROM review_decisions ORDER BY id')).rows).toEqual(reviewsBefore);

    // Повтор новым запуском: полный разбор публикуется одной транзакцией, прежнее решение не удаляется.
    const fixed = fakeProvider(text => (text.includes(Q_LATE) ? ok(answerLate) : ok(extraction({ doc_relevant: false }))));
    const retry = await retryRun(run2.runId, fixed, 'test');
    expect(retry.outcome).toBe('queued');
    const retried = await execute((retry as { runId: number }).runId, fixed);
    expect(retried.status).toBe('completed');
    expect((await publishCandidateSet({ setId: retried.candidateSetId!, expectedVersion: publication.version, actor: 'test' })).outcome).toBe('published');
    const reviewsNow = (await pool().query('SELECT id, assertion_id, decision, reviewer, decided_at FROM review_decisions ORDER BY id')).rows;
    expect(reviewsNow).toEqual(reviewsBefore);
  });

  it('непокрытый хвост (лимит чанков) → failed без вызова модели', async () => {
    const item = await store(sourceMain, longBody('tail'));
    const provider = fakeProvider(() => ok(extraction({ doc_relevant: false })));
    const run = await execute(await enqueue(item.revisionId, provider, { chunkSize: 200, maxChunks: 1, overlap: 20 }), provider);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('непокрытый хвост');
    expect(provider.calls).toHaveLength(0);
  });

  it('timeout модели записывается как timeout, запуск failed', async () => {
    const item = await store(sourceMain, `Тайм-аут: ${'текст про стройку '.repeat(5)}`);
    const provider = fakeProvider(() => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    expect(run.status).toBe('failed');
    const responses = await pool().query<{ outcome: string }>(
      `SELECT resp.outcome FROM extraction_chunk_responses resp
       JOIN extraction_chunks c ON c.id = resp.chunk_id WHERE c.run_id = $1`,
      [run.runId],
    );
    expect(responses.rows.map(r => r.outcome)).toEqual(['timeout']);
  });

  it('ответы чанков неизменяемы', async () => {
    await expect(pool().query(`UPDATE extraction_chunk_responses SET error = 'x'`)).rejects.toThrow();
    await expect(pool().query('DELETE FROM extraction_chunk_responses')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('сбои worker\'а и конкуренция', () => {
  const small: IChunkerParams = { chunkSize: 200, maxChunks: 20, overlap: 20 };
  const body = Array.from({ length: 5 }, (_, i) => `Раздел ${i}: ${'обзор рынка жилья '.repeat(5)}`).join('\n');

  it('crash до commit итога: тот же запуск продолжается, готовые чанки модели не отдаются повторно', async () => {
    const item = await store(sourceMain, `Сбой-1. ${body}`);
    const provider = fakeProvider(() => ok(extraction({ doc_relevant: false })));
    const runId = await enqueue(item.revisionId, provider, small);

    const first = await claimNextRun('crashing', { runId, leaseMs: 30 });
    await expect(
      processRun(provider, first!, {
        leaseMs: 30,
        beforeFinalize: async () => {
          throw new Error('имитация падения процесса');
        },
      }),
    ).rejects.toThrow('имитация');
    const callsAfterCrash = provider.calls.length;
    expect(callsAfterCrash).toBeGreaterThan(1);
    expect((await pool().query('SELECT 1 FROM candidate_sets cs WHERE cs.run_id = $1', [runId])).rowCount).toBe(0);

    await sleep(60);
    const second = await claimNextRun('recovering', { runId });
    expect(second).not.toBeNull();
    expect(second!.fencingToken).toBeGreaterThan(first!.fencingToken);
    const result = await processRun(provider, second!);
    expect(result.status).toBe('completed');
    expect(provider.calls.length).toBe(callsAfterCrash);
  });

  it('crash после commit: запуск не захватывается снова, набор ровно один', async () => {
    const item = await store(sourceMain, `Сбой-2. ${body}`);
    const provider = fakeProvider(() => ok(extraction({ doc_relevant: false })));
    const runId = await enqueue(item.revisionId, provider, small);
    await execute(runId, provider);
    expect(await claimNextRun('after-crash', { runId })).toBeNull();
    const sets = await pool().query('SELECT 1 FROM candidate_sets WHERE run_id = $1', [runId]);
    expect(sets.rowCount).toBe(1);
  });

  it('crash внутри транзакции публикации: читатель видит прежнее состояние целиком', async () => {
    const item = await store(sourceMain, `Сбой-3. Сообщение: ${Q_ROLE} — подтверждено.`);
    const provider = fakeProvider(() => ok(fullAnswer));
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    const before = await counts();
    await expect(
      publishCandidateSet({
        setId: run.candidateSetId!,
        expectedVersion: 0,
        actor: 'test',
        beforeCommit: async () => {
          throw new Error('имитация падения внутри публикации');
        },
      }),
    ).rejects.toThrow('имитация');
    expect(await counts()).toEqual(before);
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBeNull();
  });

  it('два worker\'а: захватывает один; прежний держатель после перехвата ничего не пишет', async () => {
    const item = await store(sourceMain, `Два worker'а. ${body}`);
    const provider = fakeProvider(() => ok(extraction({ doc_relevant: false })));
    const runId = await enqueue(item.revisionId, provider, small);

    const claims = await Promise.all([claimNextRun('w-a', { runId, leaseMs: 20 }), claimNextRun('w-b', { runId, leaseMs: 20 })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const holder = claims.find(Boolean)!;

    await sleep(50);
    const taker = await claimNextRun('w-c', { runId });
    expect(taker).not.toBeNull();
    await expect(processRun(provider, holder, { leaseMs: 20 })).rejects.toBeInstanceOf(StaleLeaseError);
    const stale = await pool().query(
      `SELECT 1 FROM extraction_chunk_responses resp JOIN extraction_chunks c ON c.id = resp.chunk_id
       WHERE c.run_id = $1 AND resp.fencing_token = $2`,
      [runId, holder.fencingToken],
    );
    expect(stale.rowCount).toBe(0);
    expect((await processRun(provider, taker!)).status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------

describe('устаревшие разборы, нерелевантная версия, политика, ручное решение', () => {
  const Q_A = `ООО «Демо-Вега» (ИНН ${INN_A}) начала строительство квартала`;
  const answerA = extraction({ companies: [company('Демо-Вега', Q_A, { tax_id: INN_A })] });

  it('поздний старый запуск не переписывает актуальную публикацию', async () => {
    const item = await store(sourceMain, `Лента: ${Q_A}. Подробности позже.`);
    const oldProvider = fakeProvider(() => ok(answerA), 'model-old');
    const newProvider = fakeProvider(() => ok(answerA), 'model-new');
    const oldRun = await enqueue(item.revisionId, oldProvider);
    const newRun = await enqueue(item.revisionId, newProvider);

    const fresh = await execute(newRun, newProvider);
    expect((await publishCandidateSet({ setId: fresh.candidateSetId!, expectedVersion: 0, actor: 'test' })).outcome).toBe('published');

    const late = await execute(oldRun, oldProvider);
    const rejected = await publishCandidateSet({ setId: late.candidateSetId!, expectedVersion: 1, actor: 'test' });
    expect(rejected.outcome).toBe('rejected_stale');
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBe(fresh.candidateSetId);

    const history = await pool().query<{ action: string }>(
      'SELECT action FROM publication_history WHERE source_item_id = $1 ORDER BY id',
      [item.sourceItemId],
    );
    expect(history.rows.map(r => r.action)).toEqual(['publish', 'rejected_stale']);
  });

  it('два источника и ручное решение; нерелевантная новая версия снимает только свой вклад', async () => {
    const x = await store(sourceMain, `Канал X: ${Q_A}. Конец заметки.`, 'synthetic_reprocess/x');
    const y = await store(sourceRevoke, `Канал Y сообщает: ${Q_A}. Иные детали.`, 'synthetic_revoke/y');
    const provider = fakeProvider(() => ok(answerA), 'model-two-sources');

    for (const it of [x, y]) {
      const run = await execute(await enqueue(it.revisionId, provider), provider);
      const version = (await publicationOf(it.sourceItemId)).version;
      expect((await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: version, actor: 'test' })).outcome).toBe(
        'published',
      );
    }

    const assertion = (
      await pool().query<{ id: number; version: number; company_id: number }>(
        `SELECT a.id, a.version, a.subject_company_id AS company_id FROM assertions a
         JOIN companies c ON c.id = a.subject_company_id
         WHERE a.predicate = 'company_mentioned' AND c.tax_id = $1`,
        [INN_A],
      )
    ).rows[0]!;
    const active = await pool().query(`SELECT 1 FROM evidence WHERE assertion_id = $1 AND status = 'active'`, [assertion.id]);
    expect(active.rowCount).toBeGreaterThanOrEqual(2);

    await withTransaction(client =>
      recordReviewDecision(client, {
        assertionId: assertion.id,
        decision: 'reviewed_supported',
        scope: 'reflects_source',
        reason: 'сверено с обоими источниками',
        reviewer: 'operator',
        expectedVersion: assertion.version,
        idempotencyKey: 'reprocess-two-sources-review',
      }),
    );

    // Новая редакция X: текст правлен, модель признаёт нерелевантным.
    const x2 = await store(sourceMain, 'Канал X: заметка снята редакцией, текст заменён объявлением о вакансиях.', 'synthetic_reprocess/x');
    expect(x2.sourceItemId).toBe(x.sourceItemId);
    const irrelevant = fakeProvider(() => ok(extraction({ doc_relevant: false })), 'model-two-sources');
    const before = await counts();
    const run = await execute(await enqueue(x2.revisionId, irrelevant), irrelevant);
    expect(run.relevant).toBe(false);
    const version = (await publicationOf(x.sourceItemId)).version;
    const result = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: version, actor: 'test' });
    expect(result.outcome).toBe('published');
    expect(result.evidenceSuperseded).toBeGreaterThanOrEqual(1);

    const after = await counts();
    expect(after.reviews).toBe(before.reviews);
    expect(after.companies).toBe(before.companies);
    expect(after.evidence).toBe(before.evidence); // строки не удаляются

    const state = (
      await pool().query<{ status: string; needs_revalidation: boolean }>(
        'SELECT status, needs_revalidation FROM assertions WHERE id = $1',
        [assertion.id],
      )
    ).rows[0]!;
    expect(state.status).toBe('reviewed_supported');
    expect(state.needs_revalidation).toBe(true);

    const yEvidence = await pool().query(
      `SELECT 1 FROM evidence WHERE assertion_id = $1 AND revision_id = $2 AND status = 'active'`,
      [assertion.id, y.revisionId],
    );
    expect(yEvidence.rowCount).toBe(1);
    const xEvidence = await pool().query<{ status: string }>(
      'SELECT status FROM evidence WHERE assertion_id = $1 AND revision_id = $2',
      [assertion.id, x.revisionId],
    );
    expect(xEvidence.rows.map(r => r.status)).toEqual(['superseded']);
  });

  it('набор по старой редакции после появления новой — устаревший', async () => {
    const first = await store(sourceMain, `Редакция 1: ${Q_A}. Заметка.`, 'synthetic_reprocess/edited');
    const provider = fakeProvider(() => ok(answerA), 'model-edited');
    const run = await execute(await enqueue(first.revisionId, provider), provider);
    await store(sourceMain, `Редакция 2: ${Q_A}. Заметка дополнена.`, 'synthetic_reprocess/edited');
    const result = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
    expect(result.outcome).toBe('rejected_stale');
  });

  it('отзыв права ИИ после разбора: набор сохранён, но не опубликован; новый захват не выдаётся', async () => {
    const item = await store(sourceRevoke, `Политика: ${Q_A}. Проверка отзыва.`, 'synthetic_revoke/policy');
    const provider = fakeProvider(() => ok(answerA), 'model-policy');
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    const queuedAfter = await enqueue(item.revisionId, fakeProvider(() => ok(answerA), 'model-policy-2'));

    await pool().query(`UPDATE sources SET ai_processing_status = 'revoked' WHERE id = $1`, [sourceRevoke]);
    const before = await counts();
    const result = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
    expect(result.outcome).toBe('rejected_policy');
    const after = await counts();
    expect(after.assertions).toBe(before.assertions);
    expect(after.evidence).toBe(before.evidence);
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBeNull();
    const set = await pool().query<{ status: string }>('SELECT status FROM candidate_sets WHERE id = $1', [run.candidateSetId]);
    expect(set.rows[0]!.status).toBe('rejected_policy');

    expect(await claimNextRun('policy-worker', { runId: queuedAfter })).toBeNull();
    const refused = await enqueueRun(pool(), {
      revisionId: item.revisionId,
      provider: fakeProvider(() => ok(answerA), 'model-policy-3'),
      requestedBy: 'test',
    });
    expect(refused.outcome).toBe('refused_policy');
  });
});

// ---------------------------------------------------------------------------

describe('проекция карточки для переразобранного legacy-документа', () => {
  it('авто-событие документа скрывается, вручную подтверждённое остаётся', async () => {
    const Q = '«Демо-Сигма» — заказчик ЖК «Сосны-Демо»';
    const item = await store(sourceMain, `Legacy-проверка: ${Q}. Опубликовано ранее.`);
    expect(item.documentId).not.toBeNull();
    const companyId = (
      await pool().query<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Сигма', 'демо сигма', 'demo sigma') RETURNING id`,
      )
    ).rows[0]!.id;
    // Разные типы: уникальный индекс событий — (документ, тип, объект, компания).
    for (const [type, status] of [['delay', 'auto'], ['deadline_missed', 'confirmed']] as const) {
      await pool().query(
        `INSERT INTO events (type, company_id, severity, document_id, quote, confidence, status)
         VALUES ($1, $2, 1, $3, $4, 0.9, $5)`,
        [type, companyId, item.documentId, `${Q} (${status})`, status],
      );
    }
    const visible = async () =>
      (
        await pool().query<{ status: string }>(
          `SELECT status FROM card_events_v WHERE company_id = $1 AND origin = 'legacy' ORDER BY status`,
          [companyId],
        )
      ).rows.map(r => r.status);
    expect(await visible()).toEqual(['auto', 'confirmed']);

    const provider = fakeProvider(() => ok(extraction({ doc_relevant: false })), 'model-legacy');
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
    expect(await visible()).toEqual(['confirmed']);
    // legacy-строки не удалены
    const rows = await pool().query('SELECT 1 FROM events WHERE document_id = $1', [item.documentId]);
    expect(rows.rowCount).toBe(2);
  });

  it('одинаковые названия с разными ИНН публикуются как разные компании', async () => {
    const q1 = `ООО «Демо-Омега» (ИНН ${INN_A}) заключила договор`;
    const q2 = `ООО «Демо-Омега» (ИНН ${INN_B}) открыла офис`;
    const item = await store(sourceMain, `${q1}.\n${'Разделитель. '.repeat(30)}\n${q2}.`);
    const provider = fakeProvider(
      text =>
        ok(
          extraction({
            companies: [
              ...(text.includes(q1) ? [company('Демо-Омега', q1, { tax_id: INN_A })] : []),
              ...(text.includes(q2) ? [company('Демо-Омега', q2, { tax_id: INN_B })] : []),
            ],
          }),
        ),
      'model-omega',
    );
    const run = await execute(await enqueue(item.revisionId, provider, { chunkSize: 200, maxChunks: 10, overlap: 10 }), provider);
    expect(run.status).toBe('completed');
    const published = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
    expect(published.outcome).toBe('published');
    const taxIds = await pool().query<{ tax_id: string }>(
      `SELECT DISTINCT c.tax_id FROM candidate_set_evidence cse
       JOIN evidence e ON e.id = cse.evidence_id
       JOIN assertions a ON a.id = e.assertion_id
       JOIN companies c ON c.id = a.subject_company_id
       WHERE cse.set_id = $1 ORDER BY c.tax_id`,
      [run.candidateSetId],
    );
    expect(taxIds.rows.map(r => r.tax_id)).toEqual([INN_A, INN_B].sort());
  });
});

describe('конфликт версии публикации', () => {
  it('ожидаемая версия не совпала — ошибка, указатель не меняется', async () => {
    const item = await store(sourceMain, `Версия: ${Q_ROLE}. Проверка конфликта публикации.`);
    const provider = fakeProvider(() => ok(fullAnswer), 'model-conflict');
    const run = await execute(await enqueue(item.revisionId, provider), provider);
    await expect(publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 5, actor: 'test' })).rejects.toBeInstanceOf(
      PublicationConflictError,
    );
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBeNull();
  });
});

describe('повторная публикация новой редакции', () => {
  it('объект без города и компания без ИНН не размножаются при переразборе той же публикации', async () => {
    const Q = '«Демо-Каппа» — подрядчик ЖК «Ручей-Демо»';
    const answer = extraction({
      companies: [company('Демо-Каппа', Q)],
      projects: [project('Ручей-Демо', Q)],
      links: [link('Демо-Каппа', 'Ручей-Демо', 'contractor')],
    });
    const provider = fakeProvider(() => ok(answer), 'model-repeat');
    const first = await store(sourceMain, `Повтор 1: ${Q}. Работы идут.`, 'synthetic_reprocess/repeat');
    const run1 = await execute(await enqueue(first.revisionId, provider), provider);
    await publishCandidateSet({ setId: run1.candidateSetId!, expectedVersion: 0, actor: 'test' });

    const second = await store(sourceMain, `Повтор 2: ${Q}. Работы идут по графику.`, 'synthetic_reprocess/repeat');
    const run2 = await execute(await enqueue(second.revisionId, provider), provider);
    const result = await publishCandidateSet({ setId: run2.candidateSetId!, expectedVersion: 1, actor: 'test' });
    expect(result.outcome).toBe('published');

    const projects = await pool().query(`SELECT 1 FROM projects WHERE name = 'Ручей-Демо'`);
    const companies = await pool().query(`SELECT 1 FROM companies WHERE name = 'Демо-Каппа'`);
    expect(projects.rowCount).toBe(1);
    expect(companies.rowCount).toBe(1);
    const roles = await pool().query(
      `SELECT 1 FROM card_participations_v v JOIN projects p ON p.id = v.project_id WHERE p.name = 'Ручей-Демо'`,
    );
    expect(roles.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('этап 11: идентичность исполнения, допуск перед каждым вызовом, аренда', () => {
  const small: IChunkerParams = { chunkSize: 200, maxChunks: 20, overlap: 20 };
  const body = (tag: string): string => Array.from({ length: 4 }, (_, i) => `Часть ${i} ${tag}: ${'новости стройки '.repeat(5)}`).join('\n');
  const irrelevant = () => ok(extraction({ doc_relevant: false }));
  const runRow = async (runId: number) =>
    (await pool().query<{ status: string; error: string | null; fingerprint: string; previous_run_id: number | null }>(
      'SELECT status, error, fingerprint, previous_run_id FROM extraction_runs WHERE id = $1',
      [runId],
    )).rows[0]!;
  const setsOf = async (runId: number) => (await pool().query('SELECT 1 FROM candidate_sets WHERE run_id = $1', [runId])).rowCount;

  it('T11-01: запуск модели A у исполнителя B — ноль вызовов, blocked, запуск остаётся в очереди; A выполняет', async () => {
    const item = await store(sourceMain, body('a-b'));
    const a = fakeProvider(irrelevant, 'stage11-model-a');
    const b = fakeProvider(irrelevant, 'stage11-model-b');
    const runId = await enqueue(item.revisionId, a, small);
    const fingerprint = (await runRow(runId)).fingerprint;

    expect(await claimNextRun('worker-b', { runId, provider: b })).toBeNull();
    const manual = await claimNextRun('manual', { runId });
    const blocked = await processRun(b, manual!);
    expect(blocked.status).toBe('blocked');
    expect(b.calls).toHaveLength(0);
    expect(await runRow(runId)).toMatchObject({ status: 'queued', fingerprint, error: expect.stringMatching(/^config_mismatch/) });

    const byA = await claimNextRun('worker-a', { runId, provider: a });
    expect(byA).not.toBeNull();
    expect((await processRun(a, byA!)).status).toBe('completed');
    expect(a.calls.length).toBeGreaterThan(1);
  });

  it('T11-02: частичный запуск A не продолжается моделью B — новый запуск со ссылкой, ответы A не переиспользуются', async () => {
    const item = await store(sourceMain, `${body('resume')}\nХВОСТ-stage11 ${'конец '.repeat(10)}`);
    const a = fakeProvider(text => (text.includes('ХВОСТ-stage11') ? { ok: false, failure: 'invalid_json', message: 'обрыв', usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{' } : irrelevant()), 'stage11-resume-a');
    const b = fakeProvider(irrelevant, 'stage11-resume-b');
    const partial = await execute(await enqueue(item.revisionId, a, small), a);
    expect(partial.status).toBe('partial');

    const retry = await retryRun(partial.runId, b, 'test');
    expect(retry.outcome).toBe('queued');
    const nextId = (retry as { runId: number }).runId;
    expect(await runRow(nextId)).toMatchObject({ status: 'queued', previous_run_id: partial.runId });
    expect((await runRow(partial.runId)).status).toBe('partial');

    const done = await execute(nextId, b);
    expect(done.status).toBe('completed');
    const chunks = (await pool().query<{ n: number }>('SELECT count(*)::int AS n FROM extraction_chunks WHERE run_id = $1', [nextId])).rows[0]!.n;
    expect(b.calls).toHaveLength(chunks);
  });

  it('поставленный прежней конфигурацией и не начатый запуск заменяется новым, а не исполняется', async () => {
    const item = await store(sourceMain, body('stale-queued'));
    const a = fakeProvider(irrelevant, 'stage11-old-config');
    const b = fakeProvider(irrelevant, 'stage11-new-config');
    const oldId = await enqueue(item.revisionId, a, small);
    const retry = await retryRun(oldId, b, 'test');
    expect(retry.outcome).toBe('queued');
    expect(await runRow(oldId)).toMatchObject({ status: 'cancelled', error: expect.stringMatching(/^config_mismatch/) });
    expect((await runRow((retry as { runId: number }).runId)).previous_run_id).toBe(oldId);
    expect(a.calls).toHaveLength(0);
  });

  it('T11-03: ИИ-допуск отозван после первого из нескольких чанков — следующий не отправлен, cancelled, набора нет; повтор не ставится', async () => {
    const src = await insertSyntheticSource({ kind: 'telegram', key: 'stage11_revoke_between', access: 'approved', ai: 'approved' });
    const item = await store(src, body('revoke-between'));
    const provider = fakeProvider(async (_text, call) => {
      if (call === 1) await pool().query(`UPDATE sources SET ai_processing_status = 'revoked' WHERE id = $1`, [src]);
      return irrelevant();
    });
    const runId = await enqueue(item.revisionId, provider, small);
    const result = await processRun(provider, (await claimNextRun('w-revoke', { runId }))!);
    expect(provider.calls).toHaveLength(1);
    expect(result.status).toBe('cancelled');
    expect(result.error).toMatch(/^policy_revoked/);
    expect(await setsOf(runId)).toBe(0);
    expect((await retryRun(runId, provider, 'test')).outcome).toBe('refused_policy');
  });

  it('T11-04: допуск истёк между захватом и вызовом — вызовов нет; сбор разрешён, ИИ неизвестен — запуск не ставится', async () => {
    const src = await insertSyntheticSource({ kind: 'telegram', key: 'stage11_expired', access: 'approved', ai: 'approved' });
    const item = await store(src, body('expired'));
    const provider = fakeProvider(irrelevant);
    const runId = await enqueue(item.revisionId, provider, small);
    const claim = await claimNextRun('w-expired', { runId });
    await pool().query(`UPDATE sources SET policy_expires_at = now() - interval '1 minute' WHERE id = $1`, [src]);
    const result = await processRun(provider, claim!);
    expect(provider.calls).toHaveLength(0);
    expect(result.status).toBe('cancelled');

    const collectOnly = await insertSyntheticSource({ kind: 'telegram', key: 'stage11_collect_only', access: 'approved', ai: 'unknown' });
    const other = await store(collectOnly, body('collect-only'));
    expect((await enqueueRun(pool(), { revisionId: other.revisionId, provider, chunker: small, requestedBy: 'test' })).outcome).toBe('refused_policy');
    expect(provider.calls).toHaveLength(0);
  });

  it('T11-05: ответ пришёл после отзыва — сохранён как ответ попытки, но не становится набором; канон и решения не меняются', async () => {
    const src = await insertSyntheticSource({ kind: 'telegram', key: 'stage11_inflight', access: 'approved', ai: 'approved' });
    const item = await store(src, `Новости. ${Q_ROLE}. Кроме того, ${Q_COURT_1}.`);
    const provider = fakeProvider(async () => {
      await pool().query(`UPDATE sources SET ai_processing_status = 'revoked' WHERE id = $1`, [src]);
      return ok(fullAnswer);
    });
    const runId = await enqueue(item.revisionId, provider);
    const before = await counts();
    const result = await processRun(provider, (await claimNextRun('w-inflight', { runId }))!);
    expect(result.status).toBe('cancelled');
    expect(await setsOf(runId)).toBe(0);
    const after = await counts();
    expect({ ...after, responses: 0 }).toEqual({ ...before, responses: 0 });
    expect(after.responses).toBe(before.responses + 1);
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBeNull();
  });

  it('T11-08: аренда перехвачена после первого чанка — второй вызов не делается, запись отвергнута', async () => {
    const item = await store(sourceMain, body('lease-lost'));
    let runId = 0;
    const provider = fakeProvider(async (_text, call) => {
      if (call === 1) await pool().query('UPDATE extraction_runs SET fencing_token = fencing_token + 1 WHERE id = $1', [runId]);
      return irrelevant();
    });
    runId = await enqueue(item.revisionId, provider, small);
    const claim = await claimNextRun('w-lease', { runId });
    await expect(processRun(provider, claim!)).rejects.toBeInstanceOf(StaleLeaseError);
    expect(provider.calls).toHaveLength(1);
    const written = await pool().query(
      `SELECT 1 FROM extraction_chunk_responses resp JOIN extraction_chunks c ON c.id = resp.chunk_id WHERE c.run_id = $1 AND resp.fencing_token = $2`,
      [runId, claim!.fencingToken],
    );
    expect(written.rowCount).toBe(0);
    expect(await setsOf(runId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Этап 15B: рабочее место запусков — карточка, точечные действия, устаревший предпросмотр публикации

describe('этап 15B: запуски, отмена, повтор и публикация по предпросмотру', () => {
  const small: IChunkerParams = { chunkSize: 200, maxChunks: 20, overlap: 20 };
  const body = (tag: string): string => Array.from({ length: 3 }, (_, i) => `Часть ${i} ${tag}: ${'новости стройки '.repeat(5)}`).join('\n');
  const irrelevant = () => ok(extraction({ doc_relevant: false }));
  const statusOf = async (runId: number) => (await pool().query<{ status: string }>('SELECT status FROM extraction_runs WHERE id = $1', [runId])).rows[0]!.status;

  it('T15B-01: невалидный чанк виден в карточке запуска с причиной; набора и изменений канона нет', async () => {
    const item = await store(sourceMain, `${body('15b-invalid')}\nСБОЙ-15b ${'хвост '.repeat(10)}`);
    const provider = fakeProvider(text =>
      text.includes('СБОЙ-15b') ? { ok: false, failure: 'invalid_json', message: 'обрыв JSON', usage: { tokensIn: 1, tokensOut: 1, latencyMs: 1 }, rawResponse: '{' } : irrelevant(),
    );
    const before = await counts();
    const run = await execute(await enqueue(item.revisionId, provider, small), provider);
    expect(run.status).toBe('partial');
    const detail = await api.call('GET', `/api/reprocess/runs/${run.runId}`, undefined);
    expect(detail.status).toBe(200);
    const chunks = detail.body.chunks as Array<{ status: string; lastError: string | null; responses: Array<{ outcome: string; error: string | null }> }>;
    const failed = chunks.filter(c => c.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.responses.map(r => r.outcome)).toContain('invalid_json');
    expect(JSON.stringify(detail.body)).not.toContain('rawResponse');
    expect(detail.body.candidateSet).toBeNull();
    expect(detail.body.runComplete).toBe(false);
    const after = await counts();
    expect({ ...after, responses: 0 }).toEqual({ ...before, responses: 0 });
  });

  it('T15B-03: повтор той же команды идемпотентен; отмена поставленного — без вызовов', async () => {
    const item = await store(sourceMain, `${body('15b-retry')}\nСБОЙ2-15b ${'хвост '.repeat(10)}`);
    const provider = fakeProvider(text => {
      // Тайм-аут: расход токенов неизвестен (latency считается по часам, токены — null).
      if (text.includes('СБОЙ2-15b')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return irrelevant();
    });
    const run = await execute(await enqueue(item.revisionId, provider, small), provider);
    const first = await api.call('POST', `/api/reprocess/runs/${run.runId}/retry`, {});
    expect(first.status).toBe(201);
    const second = await api.call('POST', `/api/reprocess/runs/${run.runId}/retry`, {});
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ outcome: 'already_retried', runId: first.body.runId });
    expect((await pool().query('SELECT 1 FROM extraction_runs WHERE previous_run_id = $1', [run.runId])).rowCount).toBe(1);
    // Неизвестный расход не досчитывается.
    const list = await api.call('GET', `/api/reprocess/runs?revisionId=${item.revisionId}&status=partial`, undefined);
    expect((list.body.items as Array<{ usage: { tokensIn: number | null } }>)[0]!.usage.tokensIn).toBeNull();

    const cancel = await api.call('POST', `/api/reprocess/runs/${String(first.body.runId)}/cancel`, {});
    expect(cancel.status).toBe(200);
    expect(cancel.body).toMatchObject({ outcome: 'cancelled', previousStatus: 'queued', inFlight: false });
    expect(await claimNextRun('w-15b', { runId: Number(first.body.runId) })).toBeNull();
    expect((await api.call('POST', `/api/reprocess/runs/${String(first.body.runId)}/cancel`, {})).status).toBe(409);
  });

  it('T15B-04: отмена выполняемого — in-flight показан, держатель ничего не пишет и не отправляет следующий чанк', async () => {
    const item = await store(sourceMain, body('15b-cancel-running'));
    const provider = fakeProvider(irrelevant, 'fake-15b-cancel');
    const runId = await enqueue(item.revisionId, provider, small);
    const claim = await claimNextRun('w-15b-running', { runId });
    const cancel = await api.call('POST', `/api/reprocess/runs/${runId}/cancel`, {});
    expect(cancel.body).toMatchObject({ outcome: 'cancelled', previousStatus: 'running', inFlight: true });
    expect(String(cancel.body.note)).toMatch(/мог уже уйти/);
    await expect(processRun(provider, claim!)).rejects.toBeInstanceOf(StaleLeaseError);
    expect(provider.calls).toHaveLength(0);
    expect(await statusOf(runId)).toBe('cancelled');
  });

  it('T15B-05: без cookie, без CSRF и с чужим Origin действия ничего не меняют', async () => {
    const item = await store(sourceMain, body('15b-auth'));
    const provider = fakeProvider(irrelevant, 'fake-15b-auth');
    const runId = await enqueue(item.revisionId, provider, small);
    expect((await api.call('POST', `/api/reprocess/runs/${runId}/cancel`, {}, { cookie: '' })).status).toBe(401);
    expect((await api.call('POST', `/api/reprocess/runs/${runId}/cancel`, {}, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await api.call('POST', `/api/reprocess/runs/${runId}/cancel`, {}, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await api.call('POST', `/api/reprocess/revisions/${item.revisionId}/runs`, {}, { cookie: '' })).status).toBe(401);
    expect(await statusOf(runId)).toBe('queued');
    await api.call('POST', `/api/reprocess/runs/${runId}/cancel`, {});
  });

  it('T15B-02: решение аналитика после предпросмотра — 409 preview_stale без записи; новый предпросмотр публикуется', async () => {
    const item = await store(sourceMain, `Сводка 15B. ${Q_ROLE}. Кроме того, ${Q_COURT_1}.`);
    const p1 = fakeProvider(() => ok(fullAnswer), 'fake-15b-first');
    const first = await execute(await enqueue(item.revisionId, p1), p1);
    expect((await publishCandidateSet({ setId: first.candidateSetId!, expectedVersion: 0, actor: 'test' })).outcome).toBe('published');

    const p2 = fakeProvider(() => ok(fullAnswer), 'fake-15b-second');
    const second = await execute(await enqueue(item.revisionId, p2), p2);
    const preview = await api.call('GET', `/api/reprocess/sets/${second.candidateSetId}/preview`, undefined);
    expect(preview.body.run).toMatchObject({ status: 'completed', complete: true });

    const assertionId = (
      await pool().query<{ id: number }>(
        `SELECT e.assertion_id AS id FROM candidate_set_evidence cse JOIN evidence e ON e.id = cse.evidence_id WHERE cse.set_id = $1 LIMIT 1`,
        [first.candidateSetId],
      )
    ).rows[0]!.id;
    await withTransaction(async client =>
      recordReviewDecision(client, {
        assertionId,
        decision: 'reviewed_supported',
        scope: 'reflects_source',
        reason: 'сверено до публикации нового набора',
        reviewer: 'operator',
        expectedVersion: (await client.query<{ version: number }>('SELECT version FROM assertions WHERE id = $1', [assertionId])).rows[0]!.version,
        idempotencyKey: 'review-15b-stale-01',
      }),
    );
    const before = await counts();
    const stale = await api.call(
      'POST',
      `/api/reprocess/sets/${second.candidateSetId}/publish`,
      { expectedVersion: preview.body.expectedVersion, expectedPreviewToken: preview.body.previewToken },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('preview_stale');
    expect(String(stale.body.nextStep)).toMatch(/предпросмотр/);
    expect(await counts()).toEqual(before);

    const fresh = await api.call('GET', `/api/reprocess/sets/${second.candidateSetId}/preview`, undefined);
    expect(fresh.body.previewToken).not.toBe(preview.body.previewToken);
    const published = await api.call(
      'POST',
      `/api/reprocess/sets/${second.candidateSetId}/publish`,
      { expectedVersion: fresh.body.expectedVersion, expectedPreviewToken: fresh.body.previewToken },
    );
    expect(published.body.outcome).toBe('published');
    // Решение аналитика осталось, машинного подтверждения нет.
    expect((await pool().query('SELECT 1 FROM review_decisions WHERE assertion_id = $1', [assertionId])).rowCount).toBe(1);
  });

  it('T15B-02: допуск отозван или появилась новая редакция между предпросмотром и публикацией — отказ со следующим шагом', async () => {
    const src = await insertSyntheticSource({ kind: 'telegram', key: 'stage15b_revoke', access: 'approved', ai: 'approved' });
    const revoked = await store(src, `Отзыв 15B. ${Q_ROLE}.`, 'synthetic_15b/revoke');
    const p = fakeProvider(() => ok(fullAnswer), 'fake-15b-policy');
    const run = await execute(await enqueue(revoked.revisionId, p), p);
    const preview = await api.call('GET', `/api/reprocess/sets/${run.candidateSetId}/preview`, undefined);
    await pool().query(`UPDATE sources SET ai_processing_status = 'revoked' WHERE id = $1`, [src]);
    const refused = await api.call('POST', `/api/reprocess/sets/${run.candidateSetId}/publish`, { expectedVersion: 0, expectedPreviewToken: preview.body.previewToken });
    expect(refused.body).toMatchObject({ outcome: 'rejected_policy' });
    expect(String(refused.body.nextStep)).toMatch(/Допуск/);
    expect((await publicationOf(revoked.sourceItemId)).active_set_id).toBeNull();

    const edited = await store(sourceMain, `Редакция 15B. ${Q_ROLE}.`, 'synthetic_15b/edited');
    const q = fakeProvider(() => ok(fullAnswer), 'fake-15b-revision');
    const old = await execute(await enqueue(edited.revisionId, q), q);
    const oldPreview = await api.call('GET', `/api/reprocess/sets/${old.candidateSetId}/preview`, undefined);
    await store(sourceMain, `Редакция 15B, исправлено. ${Q_ROLE}.`, 'synthetic_15b/edited');
    const stale = await api.call('POST', `/api/reprocess/sets/${old.candidateSetId}/publish`, { expectedVersion: 0, expectedPreviewToken: oldPreview.body.previewToken });
    expect(stale.body).toMatchObject({ outcome: 'rejected_stale' });
    expect(String(stale.body.nextStep)).toMatch(/последней редакции/);
    expect((await publicationOf(edited.sourceItemId)).active_set_id).toBeNull();
  });

  it('T15B-07: набор запуска с неполным покрытием не публикуется ни с каким токеном', async () => {
    const item = await store(sourceMain, `Покрытие 15B. ${Q_ROLE}.`);
    const p = fakeProvider(() => ok(fullAnswer), 'fake-15b-coverage');
    const run = await execute(await enqueue(item.revisionId, p), p);
    await pool().query('UPDATE extraction_runs SET covered_chars = covered_chars - 1 WHERE id = $1', [run.runId]);
    const preview = await api.call('GET', `/api/reprocess/sets/${run.candidateSetId}/preview`, undefined);
    expect(preview.body.run).toMatchObject({ complete: false });
    const res = await api.call('POST', `/api/reprocess/sets/${run.candidateSetId}/publish`, { expectedVersion: 0, expectedPreviewToken: preview.body.previewToken });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('not_publishable');
    expect((await publicationOf(item.sourceItemId)).active_set_id).toBeNull();
  });

  it('T15B-06: 105 запусков не теряются за первой страницей; фильтр и курсор без пересечений', async () => {
    const item = await store(sourceMain, body('15b-paging'));
    await pool().query(
      `INSERT INTO extraction_runs (revision_id, fingerprint, fingerprint_json, status, requested_by, finished_at)
       SELECT $1, 'ab15' || lpad(g::text, 4, '0'), '{}'::jsonb, 'failed', 'test', now() FROM generate_series(1, 105) g`,
      [item.revisionId],
    );
    const first = await api.call('GET', `/api/reprocess/runs?revisionId=${item.revisionId}&limit=100`, undefined);
    expect(first.body.total).toBe(105);
    const ids1 = (first.body.items as Array<{ id: number }>).map(r => r.id);
    expect(ids1).toHaveLength(100);
    const next = await api.call('GET', `/api/reprocess/runs?revisionId=${item.revisionId}&limit=100&beforeId=${String(first.body.nextBeforeId)}`, undefined);
    const ids2 = (next.body.items as Array<{ id: number }>).map(r => r.id);
    expect(ids2).toHaveLength(5);
    expect(new Set([...ids1, ...ids2]).size).toBe(105);
    expect(next.body.nextBeforeId).toBeNull();
    const filtered = await api.call('GET', `/api/reprocess/runs?revisionId=${item.revisionId}&fingerprint=ab150001`, undefined);
    expect(filtered.body.total).toBe(1);
    expect((await api.call('GET', '/api/reprocess/runs?status=bogus', undefined)).status).toBe(400);
  });
});
