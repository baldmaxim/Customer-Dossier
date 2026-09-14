// Этап 04 на PostgreSQL: TC-034…TC-041 — реквизиты, бренд и юрлицо, неоднозначность,
// география и корпуса, безопасное слияние, конкуренция, повтор, отмена и отказ небезопасной отмены.
// Все названия и реквизиты синтетические (контрольные суммы подобраны).

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import type { IAssertionContent } from '../assertions/model.js';
import { addEvidence, recordReviewDecision, upsertAssertion } from '../assertions/repository.js';
import { locateQuote } from '../assertions/span.js';
import { resolveCompany } from './company.js';
import {
  EntityVersionConflictError,
  MergeBlockedError,
  MergeIdempotencyMismatchError,
  UnsafeUndoError,
  applyEntityMerge,
  previewMerge,
  undoEntityMerge,
} from './entityMerge.js';
import { runIdentifierBackfill, runRenormalizeBackfill } from './identityBackfill.js';
import { normalizeName } from './normalize.js';
import { resolveProject } from './project.js';

const W = [2, 4, 10, 3, 5, 9, 4, 6, 8];
/** ИНН юрлица с верной контрольной суммой из 9 цифр. */
const inn = (prefix9: string): string => {
  const digits = [...prefix9].map(Number);
  return prefix9 + String((digits.reduce((sum, d, i) => sum + d * W[i]!, 0) % 11) % 10);
};

let api: ITestApi;
let sourceId = 0;
let docCounter = 0;
const pool = () => getPool();

const company = (surface: string, taxId: string | null = null, legalForm: string | null = null, revisionId: number | null = null) =>
  withTransaction(client => resolveCompany(client, { surface, taxId, legalForm, city: null, documentId: null, revisionId }));

const project = (surface: string, city: string | null) =>
  withTransaction(client => resolveProject(client, { surface, city, kind: 'residential', stage: 'unknown' }));

const store = async (body: string) => {
  docCounter += 1;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: `synthetic_identity/${docCounter}`,
    url: null,
    title: null,
    body,
    publishedAt: null,
    forwardFrom: null,
  });
  return { revisionId: stored.revisionId!, documentId: stored.documentId!, body };
};

const version = async (table: 'companies' | 'projects', id: number): Promise<number> =>
  (await pool().query<{ version: number }>(`SELECT version FROM ${table} WHERE id = $1`, [id])).rows[0]!.version;

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
  (await pool().query<T>(sql, params)).rows[0]!;

const n = async (sql: string, params: unknown[] = []): Promise<number> => (await one<{ n: number }>(sql, params)).n;

/** Контрольные количества: слияние и откат не удаляют строк истории. */
interface ITotals {
  companies: number;
  tombstones: number;
  assertions: number;
  evidence: number;
  evidence_active: number;
  reviews: number;
  mentions: number;
  participants: number;
  aliases: number;
  events: number;
  merges: number;
}

const totals = async (): Promise<ITotals> =>
  one<ITotals & Record<string, unknown>>(
    `SELECT (SELECT count(*)::int FROM companies) AS companies,
            (SELECT count(*)::int FROM companies WHERE merged_into_id IS NOT NULL) AS tombstones,
            (SELECT count(*)::int FROM assertions) AS assertions,
            (SELECT count(*)::int FROM evidence) AS evidence,
            (SELECT count(*)::int FROM evidence WHERE status = 'active') AS evidence_active,
            (SELECT count(*)::int FROM review_decisions) AS reviews,
            (SELECT count(*)::int FROM mentions) AS mentions,
            (SELECT count(*)::int FROM project_participants) AS participants,
            (SELECT count(*)::int FROM entity_aliases) AS aliases,
            (SELECT count(*)::int FROM events) AS events,
            (SELECT count(*)::int FROM entity_merges) AS merges`,
  );

const content = (over: Partial<IAssertionContent>): IAssertionContent => ({
  predicate: 'company_mentioned',
  role: null,
  eventType: null,
  subjectCompanyId: null,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: null,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'unknown',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  ...over,
});

const assertWithEvidence = async (c: IAssertionContent, doc: { revisionId: number; body: string }, quote: string) =>
  withTransaction(async client => {
    const a = await upsertAssertion(client, c, { origin: 'manual', confidenceExtraction: 0.9, confidenceIdentity: null });
    const location = locateQuote(doc.body, quote);
    if (location.kind !== 'unique') throw new Error(`цитата не найдена однозначно: ${location.kind}`);
    const ev = await addEvidence(client, {
      assertionId: a.id,
      revisionId: doc.revisionId,
      stance: 'supports',
      span: location.span,
      origin: 'manual',
      extractionId: null,
      legacyKind: null,
      legacyId: null,
    });
    return { assertionId: a.id, evidenceId: ev.id };
  });

const plainCompany = async (name: string, legalForm: string | null = null, taxId: string | null = null): Promise<number> => {
  const norm = normalizeName(name, 'company');
  return (
    await one<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin, legal_form, tax_id, entity_type)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, norm.norm, norm.latin, legalForm, taxId, taxId || legalForm ? 'legal_entity' : 'unknown'],
    )
  ).id;
};

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'synthetic_identity' });
  api = await startTestApi();
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('реквизиты и вид сущности', () => {
  it('TC-034: одинаковое имя и разные ИНН — разные юрлица; реквизиты типизированы в реестре', async () => {
    const a = await company('Демо-Вектор', inn('500100100'), 'ООО');
    const b = await company('Демо-Вектор', inn('500100200'), 'ООО');
    expect(b!.companyId).not.toBe(a!.companyId);
    const rows = (
      await pool().query<{ company_id: number; identifier_type: string; validation_status: string }>(
        `SELECT company_id, identifier_type, validation_status FROM entity_identifiers
         WHERE company_id = ANY($1::bigint[]) ORDER BY company_id`,
        [[a!.companyId, b!.companyId]],
      )
    ).rows;
    expect(rows.map(r => [r.identifier_type, r.validation_status])).toEqual([
      ['inn', 'checksum_valid'],
      ['inn', 'checksum_valid'],
    ]);
    // Упоминание с ИНН первой находит первую, а не «первую по имени».
    const again = await company('Демо-Вектор', inn('500100200'), 'ООО');
    expect(again!.companyId).toBe(b!.companyId);
    expect(again!.method).toBe('tax_id');
  });

  it('TC-035: бренд без формы и реквизитов не получает ИНН дочернего ООО; повтор не плодит дубли', async () => {
    const legal = await company('Демо-Самолёт', inn('500100300'), 'ООО');
    const brand = await company('Демо-Самолёт');
    const brandAgain = await company('Демо-Самолёт');
    expect(brand!.companyId).not.toBe(legal!.companyId);
    expect(brandAgain!.companyId).toBe(brand!.companyId);
    expect(brandAgain!.method).toBe('provisional');

    const row = await one<{ tax_id: string | null; entity_type: string }>('SELECT tax_id, entity_type FROM companies WHERE id = $1', [
      brand!.companyId,
    ]);
    expect(row).toEqual({ tax_id: null, entity_type: 'unknown' });
    expect(await n('SELECT count(*)::int AS n FROM entity_identifiers WHERE company_id = $1', [brand!.companyId])).toBe(0);
    const queue = await one<{ status: string }>(
      `SELECT status::text AS status FROM merge_queue WHERE least(source_entity_id, target_entity_id) = least($1::bigint, $2::bigint)
         AND greatest(source_entity_id, target_entity_id) = greatest($1::bigint, $2::bigint)`,
      [brand!.companyId, legal!.companyId],
    );
    expect(queue.status).toBe('pending');

    // Оператор фиксирует связь «бренд юрлица» — слияние этих сущностей блокируется.
    const type = await api.call('PATCH', `/api/entities/companies/${brand!.companyId}/type`, {
      entityType: 'brand',
      expectedVersion: await version('companies', brand!.companyId),
    });
    expect(type.status).toBe(200);
    const relation = await api.call('POST', '/api/entities/relations', {
      fromCompanyId: brand!.companyId,
      toCompanyId: legal!.companyId,
      relationType: 'brand_of',
    });
    expect(relation.status).toBe(201);
    const preview = await previewMerge('company', brand!.companyId, legal!.companyId);
    expect(preview.canApply).toBe(false);
    expect(preview.conflicts.map(c => c.code).sort()).toEqual(['entity_type_conflict', 'relation_exists']);
    // После слияний бренд и юрлицо остаются раздельными сущностями с явной связью в карточке.
    const card = await api.call('GET', `/api/companies/${brand!.companyId}`);
    expect((card.body.relations as Array<{ relationType: string }>)[0]?.relationType).toBe('brand_of');
  });

  it('TC-036: несколько кандидатов без реквизитов — не выбор первой строки и не новый дубль, а очередь уточнения', async () => {
    await plainCompany('Демо-Двойник');
    await plainCompany('Демо-Двойник');
    const doc = await store('Синтетика: «Демо-Двойник» объявил тендер на отделку.');
    const before = await n('SELECT count(*)::int AS n FROM companies');
    expect(await company('Демо-Двойник', null, null, doc.revisionId)).toBeNull();
    expect(await company('Демо-Двойник', null, null, doc.revisionId)).toBeNull();
    expect(await n('SELECT count(*)::int AS n FROM companies')).toBe(before);
    const ambiguity = await one<{ occurrences: number; candidates: number }>(
      `SELECT occurrences, cardinality(candidate_ids) AS candidates FROM resolution_ambiguities
       WHERE entity_kind = 'company' AND revision_id = $1`,
      [doc.revisionId],
    );
    expect(ambiguity).toEqual({ occurrences: 2, candidates: 2 });
  });

  it('поиск по типизированному реквизиту и алиасу', async () => {
    const id = (await company('Демо-Поиск', inn('500100400'), 'АО'))!.companyId;
    const ogrn = '1027700132239';
    const added = await api.call('POST', `/api/entities/companies/${id}/identifiers`, { value: ogrn });
    expect(added.status).toBe(201);
    const taken = await api.call('POST', `/api/entities/companies/${(await company('Демо-Другой', null, 'АО'))!.companyId}/identifiers`, {
      value: ogrn,
    });
    expect(taken.status).toBe(409);
    const byOgrn = await api.call('GET', `/api/companies?q=${ogrn}`);
    expect((byOgrn.body.items as Array<{ id: number; score: number }>)[0]).toMatchObject({ id, score: 1 });
    await pool().query(
      `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source)
       VALUES ('company', $1, 'Поисковик Демо', 'поисковик демо', 'poiskovik demo', 'manual')`,
      [id],
    );
    const byAlias = await api.call('GET', `/api/companies?q=${encodeURIComponent('Поисковик Демо')}`);
    expect((byAlias.body.items as Array<{ id: number }>).map(i => i.id)).toContain(id);
  });
});

// ---------------------------------------------------------------------------

describe('объекты: география и иерархия', () => {
  it('TC-037: одинаковые ЖК в двух городах и неизвестный город не склеиваются; неизвестный город стабилен', async () => {
    const moscow = await project('ЖК «Демо-Парк»', 'Москва');
    const kazan = await project('ЖК «Демо-Парк»', 'Казань');
    const unknown = await project('ЖК «Демо-Парк»', null);
    const unknownAgain = await project('ЖК «Демо-Парк»', null);
    expect(new Set([moscow!.projectId, kazan!.projectId, unknown!.projectId]).size).toBe(3);
    expect(unknownAgain!.projectId).toBe(unknown!.projectId);
    const merge = await previewMerge('project', kazan!.projectId, moscow!.projectId);
    expect(merge.conflicts.map(c => c.code)).toContain('city_conflict');
  });

  it('TC-038: два корпуса одного ЖК — иерархия; варианты названия комплекса — один объект', async () => {
    const one1 = await project('ЖК «Демо-Берег», корпус 1', 'Москва');
    const two = await project('ЖК «Демо-Берег», корпус 2', 'Москва');
    const one1Again = await project('ЖК «Демо-Берег» корп. 1', 'Москва');
    const complex = await project('жилой комплекс «Демо-Берег»', 'Москва');
    expect(two!.projectId).not.toBe(one1!.projectId);
    expect(one1Again!.projectId).toBe(one1!.projectId);
    const rows = (
      await pool().query<{ id: number; project_level: string; parent_project_id: number | null; level_label: string | null }>(
        'SELECT id, project_level, parent_project_id, level_label FROM projects WHERE id = ANY($1::bigint[]) ORDER BY id',
        [[one1!.projectId, two!.projectId]],
      )
    ).rows;
    expect(rows.map(r => [r.project_level, r.parent_project_id, r.level_label])).toEqual([
      ['building', complex!.projectId, '1'],
      ['building', complex!.projectId, '2'],
    ]);
    const cross = await previewMerge('project', one1!.projectId, complex!.projectId);
    expect(cross.conflicts.map(c => c.code)).toContain('hierarchy_conflict');
  });
});

// ---------------------------------------------------------------------------

describe('слияние компаний: перенос, дубликаты, повтор, отмена (TC-039…TC-041)', () => {
  const Q = '«Демо-Ромашка» — подрядчик ЖК «Демо-Поле»';
  let source = 0;
  let target = 0;
  let reviewedAssertion = 0;
  let mergeId = 0;
  let doc = { revisionId: 0, documentId: 0, body: '' };
  let afterMerge = {} as ITotals;

  beforeAll(async () => {
    source = await plainCompany('Демо-Ромашка', 'ООО');
    target = await plainCompany('Ромашка-Демо', 'ООО', inn('500100500'));
    const projectId = (
      await one<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin, city) VALUES ('Демо-Поле', 'демо поле', 'demo pole', 'Москва') RETURNING id`)
    ).id;
    doc = await store(`Синтетика для слияния: ${Q}, сообщил застройщик.`);

    for (const [id, hits] of [[source, 2], [target, 3]] as const) {
      await pool().query(
        `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source, hits)
         VALUES ('company', $1, 'Ромашка', 'ромашка', 'romashka', 'manual', $2)`,
        [id, hits],
      );
    }
    for (const [id, quote] of [[source, Q], [target, Q], [source, 'сообщил застройщик']] as const) {
      await pool().query(
        `INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, quote, confidence, published_at)
         VALUES ($1, 'company', $2, 'Ромашка', $3, 0.9, now())`,
        [doc.documentId, id, quote],
      );
    }
    await pool().query(
      `INSERT INTO project_participants (project_id, company_id, role, confidence, evidence_document_id)
       VALUES ($1, $2, 'contractor', 0.9, $4), ($1, $3, 'contractor', 0.9, $4), ($1, $2, 'designer', 0.8, $4)`,
      [projectId, source, target, doc.documentId],
    );

    // Одинаковый смысл у обеих сторон с той же цитатой — после слияния одно основание, не два.
    const s1 = await assertWithEvidence(content({ subjectCompanyId: source }), doc, Q);
    await assertWithEvidence(content({ subjectCompanyId: target }), doc, Q);
    await assertWithEvidence(
      content({ predicate: 'participates_in_project', role: 'contractor', subjectCompanyId: source, objectProjectId: projectId }),
      doc,
      Q,
    );
    reviewedAssertion = s1.assertionId;
    await withTransaction(async client =>
      recordReviewDecision(client, {
        assertionId: s1.assertionId,
        decision: 'reviewed_supported',
        scope: 'reflects_source',
        reason: 'сверено',
        reviewer: 'operator',
        expectedVersion: (await client.query<{ version: number }>('SELECT version FROM assertions WHERE id = $1', [s1.assertionId])).rows[0]!.version,
        idempotencyKey: 'identity-review-0001',
      }),
    );
  });

  it('предпросмотр: зависимости, дубликаты, решения аналитика', async () => {
    const preview = await previewMerge('company', source, target);
    expect(preview.canApply).toBe(true);
    expect(preview.counts).toMatchObject({
      aliases: 1,
      aliasDuplicates: 1,
      mentions: 2,
      participants: 2,
      participantDuplicates: 1,
      assertions: 2,
      activeEvidence: 2,
    });
    expect(preview.reviewedAssertions.map(r => r.assertionId)).toEqual([reviewedAssertion]);
    expect(preview.warnings.join(' ')).toContain('решения аналитика');
    const httpPreview = await api.call('GET', `/api/entities/merge-preview?kind=company&sourceId=${source}&targetId=${target}`);
    expect(httpPreview.status).toBe(200);
  });

  it('применение через API выключено флагом (423), состояние прежнее', async () => {
    const before = await totals();
    const res = await api.call('POST', '/api/entities/merge', {
      kind: 'company',
      sourceId: source,
      targetId: target,
      expectedSourceVersion: await version('companies', source),
      expectedTargetVersion: await version('companies', target),
      idempotencyKey: 'identity-api-0001',
    });
    expect(res.status).toBe(423);
    expect(await totals()).toEqual(before);
  });

  it('TC-039: сбой в середине — откатывается вся операция', async () => {
    const before = await totals();
    await expect(
      applyEntityMerge({
        kind: 'company',
        sourceId: source,
        targetId: target,
        expectedSourceVersion: await version('companies', source),
        expectedTargetVersion: await version('companies', target),
        idempotencyKey: 'identity-crash-0001',
        actor: 'test',
        beforeCommit: async () => {
          throw new Error('имитация сбоя');
        },
      }),
    ).rejects.toThrow('имитация сбоя');
    expect(await totals()).toEqual(before);
    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [source])).m).toBeNull();
  });

  it('TC-039: слияние переносит зависимости, дубликаты объединяет, строки истории не удаляет', async () => {
    const before = await totals();
    const result = await applyEntityMerge({
      kind: 'company',
      sourceId: source,
      targetId: target,
      expectedSourceVersion: await version('companies', source),
      expectedTargetVersion: await version('companies', target),
      idempotencyKey: 'identity-merge-0001',
      actor: 'test',
    });
    mergeId = result.mergeId;
    expect(result.replayed).toBe(false);
    afterMerge = await totals();

    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [source])).m).toBe(target);
    expect(afterMerge.companies).toBe(before.companies);
    expect(afterMerge.assertions).toBe(before.assertions + 1); // новое утверждение-роль для цели
    expect(afterMerge.evidence).toBe(before.evidence + 1); // скопирована только роль; упоминание — дубликат
    expect(afterMerge.reviews).toBe(before.reviews);
    expect(afterMerge.mentions).toBe(before.mentions - 1); // одинаковое упоминание того же документа
    expect(afterMerge.participants).toBe(before.participants - 1); // одинаковая роль
    expect(await n(`SELECT count(*)::int AS n FROM mentions WHERE entity_kind = 'company' AND entity_id = $1`, [source])).toBe(0);
    expect(await n('SELECT count(*)::int AS n FROM project_participants WHERE company_id = $1', [target])).toBe(2);
    expect((await one<{ hits: number }>(`SELECT hits FROM entity_aliases WHERE entity_kind = 'company' AND entity_id = $1 AND alias_norm = 'ромашка'`, [target])).hits).toBe(5);

    const reviewed = await one<{ status: string; needs_revalidation: boolean }>(
      'SELECT status::text AS status, needs_revalidation FROM assertions WHERE id = $1',
      [reviewedAssertion],
    );
    expect(reviewed).toEqual({ status: 'reviewed_supported', needs_revalidation: true });
    const targetMention = await n(
      `SELECT count(*)::int AS n FROM evidence e JOIN assertions a ON a.id = e.assertion_id
       WHERE a.predicate = 'company_mentioned' AND a.subject_company_id = $1 AND e.status = 'active'`,
      [target],
    );
    expect(targetMention).toBe(1);
    const copied = await one<{ copied: number | null; merge: number | null }>(
      `SELECT e.copied_from_evidence_id AS copied, e.merge_id AS merge FROM evidence e JOIN assertions a ON a.id = e.assertion_id
       WHERE a.predicate = 'participates_in_project' AND a.subject_company_id = $1`,
      [target],
    );
    expect(copied.merge).toBe(mergeId);
    expect(copied.copied).not.toBeNull();
    const history = await one<{ status: string; source_name: string }>(
      `SELECT status, source_snapshot->'row'->>'name' AS source_name FROM entity_merges WHERE id = $1`,
      [mergeId],
    );
    expect(history).toEqual({ status: 'applied', source_name: 'Демо-Ромашка' });
    await expect(pool().query('UPDATE entity_merge_moves SET old_value = NULL')).rejects.toThrow();
    await expect(pool().query('DELETE FROM entity_merges')).rejects.toThrow();
  });

  it('TC-040: повтор apply идемпотентен; тот же ключ для другой пары — ошибка', async () => {
    const replay = await applyEntityMerge({
      kind: 'company',
      sourceId: source,
      targetId: target,
      expectedSourceVersion: 1,
      expectedTargetVersion: 1,
      idempotencyKey: 'identity-merge-0001',
      actor: 'test',
    });
    expect(replay).toMatchObject({ mergeId, replayed: true });
    expect(await totals()).toEqual(afterMerge);
    const other = await plainCompany('Демо-Посторонняя', 'ООО');
    await expect(
      applyEntityMerge({
        kind: 'company',
        sourceId: other,
        targetId: target,
        expectedSourceVersion: 1,
        expectedTargetVersion: 1,
        idempotencyKey: 'identity-merge-0001',
        actor: 'test',
      }),
    ).rejects.toBeInstanceOf(MergeIdempotencyMismatchError);
  });

  it('TC-041: отмена без поздних изменений восстанавливает всё; повтор отмены — тот же результат', async () => {
    const result = await undoEntityMerge({ mergeId, actor: 'test', idempotencyKey: 'identity-undo-0001' });
    expect(result.replayed).toBe(false);
    const now = await totals();
    expect(now.mentions).toBe(afterMerge.mentions + 1);
    expect(now.participants).toBe(afterMerge.participants + 1);
    expect(now.evidence).toBe(afterMerge.evidence); // копия не удалена, а снята
    expect(now.reviews).toBe(afterMerge.reviews);
    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [source])).m).toBeNull();
    expect(await n(`SELECT count(*)::int AS n FROM mentions WHERE entity_kind = 'company' AND entity_id = $1`, [source])).toBe(2);
    expect((await one<{ hits: number }>(`SELECT hits FROM entity_aliases WHERE entity_kind = 'company' AND entity_id = $1 AND alias_norm = 'ромашка'`, [target])).hits).toBe(3);
    const reviewed = await one<{ status: string; needs_revalidation: boolean }>(
      'SELECT status::text AS status, needs_revalidation FROM assertions WHERE id = $1',
      [reviewedAssertion],
    );
    expect(reviewed).toEqual({ status: 'reviewed_supported', needs_revalidation: false });
    expect(
      await n(`SELECT count(*)::int AS n FROM evidence WHERE merge_id = $1 AND status = 'active'`, [mergeId]),
    ).toBe(0);
    expect((await undoEntityMerge({ mergeId, actor: 'test', idempotencyKey: 'identity-undo-0001' })).replayed).toBe(true);
  });

  it('TC-041: после новых данных простая отмена отказывает и отдаёт план, ничего не меняя', async () => {
    const second = await applyEntityMerge({
      kind: 'company',
      sourceId: source,
      targetId: target,
      expectedSourceVersion: await version('companies', source),
      expectedTargetVersion: await version('companies', target),
      idempotencyKey: 'identity-merge-0002',
      actor: 'test',
    });
    await pool().query(
      `INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, quote, confidence, published_at)
       VALUES ($1, 'company', $2, 'Ромашка', 'новое упоминание после слияния', 0.9, now())`,
      [doc.documentId, target],
    );
    const before = await totals();
    const error = await undoEntityMerge({ mergeId: second.mergeId, actor: 'test', idempotencyKey: 'identity-undo-0002' }).catch(e => e);
    expect(error).toBeInstanceOf(UnsafeUndoError);
    expect((error as UnsafeUndoError).plan.changes.map(c => c.dependency)).toContain('mentions');
    expect((error as UnsafeUndoError).plan.steps.length).toBeGreaterThan(0);
    expect(await totals()).toEqual(before);
    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [source])).m).toBe(target);
  });
});

// ---------------------------------------------------------------------------

describe('конфликты и конкуренция', () => {
  it('известный конфликт реквизитов блокирует слияние до записи', async () => {
    const a = await plainCompany('Демо-Кедр', 'ООО', inn('500100600'));
    const b = await plainCompany('Кедр-Демо', 'ООО', inn('500100700'));
    const before = await totals();
    await expect(
      applyEntityMerge({ kind: 'company', sourceId: a, targetId: b, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-conflict-01', actor: 'test' }),
    ).rejects.toBeInstanceOf(MergeBlockedError);
    expect(await totals()).toEqual(before);
  });

  it('TC-039: коллизия уникальности legacy-событий обнаруживается до записи, откат полный', async () => {
    const a = await plainCompany('Демо-Липа', 'ООО');
    const b = await plainCompany('Липа-Демо', 'ООО');
    const d = await store('Синтетика: у «Демо-Липа» перенесён срок сдачи.');
    for (const id of [a, b]) {
      await pool().query(
        `INSERT INTO events (type, company_id, severity, document_id, quote, confidence) VALUES ('delay', $1, 1, $2, 'перенесён срок', 0.9)`,
        [id, d.documentId],
      );
    }
    const before = await totals();
    const error = await applyEntityMerge({
      kind: 'company',
      sourceId: a,
      targetId: b,
      expectedSourceVersion: 1,
      expectedTargetVersion: 1,
      idempotencyKey: 'identity-unique-0001',
      actor: 'test',
    }).catch(e => e);
    expect(error).toBeInstanceOf(MergeBlockedError);
    expect((error as MergeBlockedError).conflicts.map(c => c.code)).toContain('unique_collision');
    expect(await totals()).toEqual(before);
  });

  it('устаревшая версия — конфликт без записи', async () => {
    const a = await plainCompany('Демо-Клён', 'ООО');
    const b = await plainCompany('Клён-Демо', 'ООО');
    await pool().query('UPDATE companies SET version = version + 1 WHERE id = $1', [b]);
    await expect(
      applyEntityMerge({ kind: 'company', sourceId: a, targetId: b, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-version-01', actor: 'test' }),
    ).rejects.toBeInstanceOf(EntityVersionConflictError);
    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [a])).m).toBeNull();
  });

  it('TC-040: две одновременные операции в одну цель — одна применяется, вторая получает конфликт версии', async () => {
    const target = await plainCompany('Демо-Дуб', 'ООО');
    const first = await plainCompany('Дуб-Демо-1', 'ООО');
    const second = await plainCompany('Дуб-Демо-2', 'ООО');
    const results = await Promise.allSettled([
      applyEntityMerge({ kind: 'company', sourceId: first, targetId: target, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-race-0001', actor: 'a' }),
      applyEntityMerge({ kind: 'company', sourceId: second, targetId: target, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-race-0002', actor: 'b' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(EntityVersionConflictError);
    expect(await n('SELECT count(*)::int AS n FROM companies WHERE merged_into_id = $1', [target])).toBe(1);
  });

  it('встречные операции A→B и B→A не взаимоблокируются', async () => {
    const a = await plainCompany('Демо-Ива', 'ООО');
    const b = await plainCompany('Ива-Демо', 'ООО');
    const results = await Promise.allSettled([
      applyEntityMerge({ kind: 'company', sourceId: a, targetId: b, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-cross-0001', actor: 'a' }),
      applyEntityMerge({ kind: 'company', sourceId: b, targetId: a, expectedSourceVersion: 1, expectedTargetVersion: 1, idempotencyKey: 'identity-cross-0002', actor: 'b' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('backfill идентичности', () => {
  it('реквизиты из legacy tax_id: dry-run ничего не пишет, запись идемпотентна', async () => {
    const legacyInn = inn('500100800');
    const id = await plainCompany('Демо-Легаси', null, legacyInn);
    const dry = await runIdentifierBackfill(getPool(), { dryRun: true, batchSize: 2, fromStart: true });
    expect(dry.identifiersCreated).toBeGreaterThanOrEqual(1);
    expect(await n('SELECT count(*)::int AS n FROM entity_identifiers WHERE company_id = $1', [id])).toBe(0);
    await runIdentifierBackfill(getPool(), { dryRun: false, batchSize: 2, fromStart: true });
    const row = await one<{ identifier_type: string; origin: string }>('SELECT identifier_type, origin FROM entity_identifiers WHERE company_id = $1', [id]);
    expect(row).toEqual({ identifier_type: 'inn', origin: 'legacy_import' });
    const again = await runIdentifierBackfill(getPool(), { dryRun: false, batchSize: 2, fromStart: true });
    expect(again.identifiersCreated).toBe(0);
  });

  it('ренормализация версией нормализатора: dry-run без записи, совпавшие ключи — в очередь, не слияние', async () => {
    const stale = (
      await one<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin, legal_form) VALUES ('ГК Демо-Консоль', 'гк демо консоль', 'gk demo konsol', NULL) RETURNING id`,
      )
    ).id;
    const fresh = (await company('Демо-Консоль'))!.companyId;
    const dry = await runRenormalizeBackfill(getPool(), { dryRun: true, batchSize: 50, fromStart: true });
    expect(dry.keysChanged).toBeGreaterThanOrEqual(1);
    expect((await one<{ name_latin: string }>('SELECT name_latin FROM companies WHERE id = $1', [stale])).name_latin).toBe('gk demo konsol');

    const applied = await runRenormalizeBackfill(getPool(), { dryRun: false, batchSize: 50, fromStart: true });
    expect(applied.collisionPairs).toContainEqual(expect.objectContaining({ kind: 'company', a: Math.min(stale, fresh), b: Math.max(stale, fresh) }));
    expect((await one<{ m: number | null }>('SELECT merged_into_id AS m FROM companies WHERE id = $1', [stale])).m).toBeNull();
    const repeat = await runRenormalizeBackfill(getPool(), { dryRun: false, batchSize: 50, fromStart: true });
    expect(repeat.companiesScanned).toBe(0);
  });
});
