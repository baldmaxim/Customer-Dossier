// Безопасное слияние компаний и объектов (этап 04).
//
//  - preview: обе сущности, реквизиты, конфликты, число переносимых зависимостей,
//    дубликаты, утверждения с решениями аналитика;
//  - apply: явное действие оператора, ожидаемые версии обеих сущностей, ключ
//    идемпотентности; блокировки в стабильном порядке; коллизии уникальностей
//    проверяются до записи; любая ошибка откатывает всю операцию;
//  - исходная сущность не удаляется (tombstone), каждое изменение пишется в
//    entity_merge_moves (было/стало/образ удалённой строки);
//  - утверждения неизменяемы: для живой сущности создаётся (или находится) утверждение
//    с тем же смыслом, активные доказательства копируются, оригиналы — superseded;
//    решения аналитика остаются на исходном утверждении и не переносятся;
//  - undo: только если зависимости обеих сторон не изменились после слияния; иначе —
//    отказ и план компенсирующего разнесения без автоматического применения.

import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { withTransaction } from '../db/pool.js';
import type { IAssertionContent, Modality } from '../assertions/model.js';
import { refreshAssertionState, upsertAssertion } from '../assertions/repository.js';
import { refreshCompanyMetrics } from '../metrics/refresh.js';
import { findIdentifierConflicts, loadIdentifiers } from './identifiers.js';
import { citiesKnownAndEqual } from './project.js';

export type MergeEntityKind = 'company' | 'project';

export interface IMergeConflict {
  code:
    | 'self'
    | 'not_found'
    | 'already_merged'
    | 'identifier_conflict'
    | 'entity_type_conflict'
    | 'legal_form_conflict'
    | 'relation_exists'
    | 'city_conflict'
    | 'hierarchy_conflict'
    | 'unique_collision'
    | 'opposite_parties';
  message: string;
  details?: unknown;
}

export class MergeBlockedError extends Error {
  constructor(readonly conflicts: IMergeConflict[]) {
    super(`Слияние заблокировано: ${conflicts.map(c => c.message).join('; ')}`);
    this.name = 'MergeBlockedError';
  }
}

export class EntityVersionConflictError extends Error {
  constructor(readonly current: { source: number; target: number }) {
    super('Сущности изменились после предпросмотра. Обновите предпросмотр и решите заново.');
    this.name = 'EntityVersionConflictError';
  }
}

export class MergeIdempotencyMismatchError extends Error {
  constructor() {
    super('Ключ идемпотентности уже использован для другого слияния');
    this.name = 'MergeIdempotencyMismatchError';
  }
}

export class MergeNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} не найдено`);
    this.name = 'MergeNotFoundError';
  }
}

export interface ICompensatingPlan {
  reason: string;
  /** Зависимости, появившиеся или изменившиеся после слияния. */
  changes: Array<{ dependency: string; added: string[]; removed: string[] }>;
  steps: string[];
}

export class UnsafeUndoError extends Error {
  constructor(readonly plan: ICompensatingPlan) {
    super(`Простая отмена небезопасна: ${plan.reason}`);
    this.name = 'UnsafeUndoError';
  }
}

interface IEntityRow {
  id: number;
  name: string;
  version: number;
  merged_into_id: number | null;
  city: string | null;
  // компании
  legal_form?: string | null;
  tax_id?: string | null;
  entity_type?: string;
  // объекты
  project_level?: string;
  parent_project_id?: number | null;
  level_label?: string | null;
}

const TABLE: Record<MergeEntityKind, 'companies' | 'projects'> = { company: 'companies', project: 'projects' };

const lockEntities = async (client: PoolClient, kind: MergeEntityKind, ids: number[]): Promise<Map<number, IEntityRow>> => {
  // Стабильный порядок блокировок: две встречные операции A→B и B→A не взаимоблокируются.
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const columns =
    kind === 'company'
      ? 'id, name, version, merged_into_id, city, legal_form, tax_id, entity_type'
      : 'id, name, version, merged_into_id, city, project_level, parent_project_id, level_label';
  const rows = new Map<number, IEntityRow>();
  for (const id of sorted) {
    const row = (await client.query<IEntityRow>(`SELECT ${columns} FROM ${TABLE[kind]} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (row) rows.set(id, row);
  }
  return rows;
};

const loadEntity = async (client: PoolClient, kind: MergeEntityKind, id: number): Promise<IEntityRow | null> =>
  (
    await client.query<IEntityRow>(
      kind === 'company'
        ? 'SELECT id, name, version, merged_into_id, city, legal_form, tax_id, entity_type FROM companies WHERE id = $1'
        : 'SELECT id, name, version, merged_into_id, city, project_level, parent_project_id, level_label FROM projects WHERE id = $1',
      [id],
    )
  ).rows[0] ?? null;

// ---------------------------------------------------------------------------
// Зависимости

const ASSERTION_REF_COLUMNS: Record<MergeEntityKind, string[]> = {
  company: ['subject_company_id', 'object_company_id', 'counterparty_company_id'],
  // context_project_id — объект договора (этап 06): ссылка на объект, переносится вместе с остальными.
  project: ['subject_project_id', 'object_project_id', 'context_project_id'],
};

const idsOf = async (client: PoolClient, sql: string, params: unknown[]): Promise<number[]> =>
  (await client.query<{ id: number }>(sql, params)).rows.map(r => r.id);

const assertionIdsReferencing = async (client: PoolClient, kind: MergeEntityKind, id: number): Promise<number[]> => {
  const where = ASSERTION_REF_COLUMNS[kind].map(c => c + ' = $1').join(' OR ');
  return idsOf(client, `SELECT id FROM assertions WHERE ${where} ORDER BY id`, [id]);
};

/**
 * Снимок зависимостей сущностей: по нему отмена проверяет, что после слияния ничего не
 * добавилось и не изменилось. Строки с идентичностью и изменяемыми полями.
 */
export const dependencyState = async (
  client: PoolClient,
  kind: MergeEntityKind,
  ids: readonly number[],
): Promise<Record<string, string[]>> => {
  const state: Record<string, string[]> = {};
  const list = [...ids];
  const put = (key: string, values: string[]): void => {
    state[key] = [...values].sort();
  };
  const rows = async (sql: string): Promise<string[]> =>
    (await client.query<{ k: string }>(sql, [list])).rows.map(r => r.k);

  put('entities', await rows(`SELECT id || ':' || version || ':' || coalesce(merged_into_id::text, '') AS k FROM ${TABLE[kind]} WHERE id = ANY($1::bigint[])`));
  put('aliases', await rows(`SELECT id || ':' || entity_id || ':' || hits AS k FROM entity_aliases WHERE entity_kind = '${kind}' AND entity_id = ANY($1::bigint[])`));
  put('mentions', await rows(`SELECT id || ':' || entity_id AS k FROM mentions WHERE entity_kind = '${kind}' AND entity_id = ANY($1::bigint[])`));
  if (kind === 'company') {
    put('identifiers', await rows(`SELECT id || ':' || company_id || ':' || status AS k FROM entity_identifiers WHERE company_id = ANY($1::bigint[])`));
    put('events', await rows(`SELECT id || ':' || coalesce(company_id::text, '') || ':' || coalesce(counterparty_id::text, '') AS k FROM events WHERE company_id = ANY($1::bigint[]) OR counterparty_id = ANY($1::bigint[])`));
    put('participants', await rows(`SELECT id || ':' || company_id AS k FROM project_participants WHERE company_id = ANY($1::bigint[])`));
    put('relations', await rows(`SELECT id || ':' || status AS k FROM company_relations WHERE from_company_id = ANY($1::bigint[]) OR to_company_id = ANY($1::bigint[])`));
  } else {
    put('events', await rows(`SELECT id || ':' || coalesce(project_id::text, '') AS k FROM events WHERE project_id = ANY($1::bigint[])`));
    put('participants', await rows(`SELECT id || ':' || project_id AS k FROM project_participants WHERE project_id = ANY($1::bigint[])`));
    put('children', await rows(`SELECT id || ':' || parent_project_id AS k FROM projects WHERE parent_project_id = ANY($1::bigint[])`));
  }
  const refs = ASSERTION_REF_COLUMNS[kind].map(c => `a.${c} = ANY($1::bigint[])`).join(' OR ');
  put('assertions', await rows(`SELECT a.id || ':' || a.version AS k FROM assertions a WHERE ${refs}`));
  put('evidence', await rows(`SELECT e.id || ':' || e.status AS k FROM evidence e JOIN assertions a ON a.id = e.assertion_id WHERE ${refs}`));
  put('reviews', await rows(`SELECT r.id::text AS k FROM review_decisions r JOIN assertions a ON a.id = r.assertion_id WHERE ${refs}`));
  return state;
};

const diffStates = (before: Record<string, string[]>, now: Record<string, string[]>): ICompensatingPlan['changes'] => {
  const changes: ICompensatingPlan['changes'] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const a = new Set(before[key] ?? []);
    const b = new Set(now[key] ?? []);
    const added = [...b].filter(x => !a.has(x));
    const removed = [...a].filter(x => !b.has(x));
    if (added.length > 0 || removed.length > 0) changes.push({ dependency: key, added, removed });
  }
  return changes;
};

// ---------------------------------------------------------------------------
// Предпросмотр

export interface IEntitySummary {
  id: number;
  name: string;
  version: number;
  mergedIntoId: number | null;
  city: string | null;
  legalForm: string | null;
  entityType: string | null;
  projectLevel: string | null;
  parentProjectId: number | null;
  identifiers: Array<{ type: string; value: string }>;
  aliases: string[];
}

export interface IMergePreview {
  kind: MergeEntityKind;
  source: IEntitySummary;
  target: IEntitySummary;
  conflicts: IMergeConflict[];
  warnings: string[];
  counts: Record<string, number>;
  reviewedAssertions: Array<{ assertionId: number; status: string; decisions: number }>;
  canApply: boolean;
}

const summarize = async (client: PoolClient, kind: MergeEntityKind, row: IEntityRow): Promise<IEntitySummary> => {
  const identifiers = kind === 'company' ? await loadIdentifiers(client, row.id) : [];
  const aliases = (
    await client.query<{ alias: string }>(
      'SELECT alias FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2 ORDER BY hits DESC, id LIMIT 20',
      [kind, row.id],
    )
  ).rows.map(r => r.alias);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    mergedIntoId: row.merged_into_id,
    city: row.city,
    legalForm: row.legal_form ?? null,
    entityType: row.entity_type ?? null,
    projectLevel: row.project_level ?? null,
    parentProjectId: row.parent_project_id ?? null,
    identifiers: identifiers.map(i => ({ type: `${i.jurisdiction}:${i.identifier_type}`, value: i.value })),
    aliases,
  };
};

const count = async (client: PoolClient, sql: string, params: unknown[]): Promise<number> =>
  (await client.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

const isAncestor = async (client: PoolClient, ancestorId: number, id: number): Promise<boolean> => {
  let current: number | null = id;
  for (let hop = 0; hop < 10 && current !== null; hop += 1) {
    const parent: number | null =
      (await client.query<{ parent_project_id: number | null }>('SELECT parent_project_id FROM projects WHERE id = $1', [current])).rows[0]
        ?.parent_project_id ?? null;
    if (parent === ancestorId) return true;
    current = parent;
  }
  return false;
};

const buildPreview = async (
  client: PoolClient,
  kind: MergeEntityKind,
  source: IEntityRow,
  target: IEntityRow,
): Promise<IMergePreview> => {
  const conflicts: IMergeConflict[] = [];
  const warnings: string[] = [];
  const s = source.id;
  const t = target.id;

  if (s === t) conflicts.push({ code: 'self', message: 'нельзя слить сущность саму с собой' });
  if (source.merged_into_id !== null) conflicts.push({ code: 'already_merged', message: `#${s} уже слита в #${source.merged_into_id}` });
  if (target.merged_into_id !== null) conflicts.push({ code: 'already_merged', message: `#${t} уже слита в #${target.merged_into_id}` });

  const counts: Record<string, number> = {};

  if (kind === 'company') {
    const idConflicts = findIdentifierConflicts(await loadIdentifiers(client, s), await loadIdentifiers(client, t));
    if (idConflicts.length > 0) {
      conflicts.push({ code: 'identifier_conflict', message: 'разные реквизиты одного типа — это разные юрлица', details: idConflicts });
    }
    const typeA = source.entity_type ?? 'unknown';
    const typeB = target.entity_type ?? 'unknown';
    if (typeA !== 'unknown' && typeB !== 'unknown' && typeA !== typeB) {
      conflicts.push({
        code: 'entity_type_conflict',
        message: `${typeA} и ${typeB} — разные виды сущностей; оформите связь, а не слияние`,
      });
    }
    const formA = (source.legal_form ?? '').trim().toUpperCase();
    const formB = (target.legal_form ?? '').trim().toUpperCase();
    if (formA && formB && formA !== formB) {
      conflicts.push({ code: 'legal_form_conflict', message: `разные организационные формы (${formA} / ${formB}) без доказанной реорганизации` });
    }
    const relations = (
      await client.query<{ relation_type: string; status: string }>(
        `SELECT relation_type, status FROM company_relations
         WHERE (from_company_id = $1 AND to_company_id = $2) OR (from_company_id = $2 AND to_company_id = $1)`,
        [s, t],
      )
    ).rows;
    if (relations.some(r => r.status === 'confirmed')) {
      conflicts.push({ code: 'relation_exists', message: 'между сущностями подтверждена связь (бренд/группа/правопреемник)', details: relations });
    } else if (relations.length > 0) {
      warnings.push('между сущностями есть неподтверждённая связь');
    }
    // Стороны одного события (истец и ответчик, сменённый и новый подрядчик) — сильный довод,
    // что это разные компании: после слияния событие стало бы спором компании с собой.
    const opposite =
      (await count(
        client,
        `SELECT count(*)::int AS n FROM assertions
         WHERE (subject_company_id = $1 AND (object_company_id = $2 OR counterparty_company_id = $2))
            OR (subject_company_id = $2 AND (object_company_id = $1 OR counterparty_company_id = $1))`,
        [s, t],
      )) +
      (await count(
        client,
        'SELECT count(*)::int AS n FROM events WHERE (company_id = $1 AND counterparty_id = $2) OR (company_id = $2 AND counterparty_id = $1)',
        [s, t],
      ));
    if (opposite > 0) {
      conflicts.push({ code: 'opposite_parties', message: `сущности — противоположные стороны событий (${opposite})` });
    }
    counts.identifiers = await count(client, `SELECT count(*)::int AS n FROM entity_identifiers WHERE company_id = $1 AND status = 'active'`, [s]);
    counts.events = await count(client, 'SELECT count(*)::int AS n FROM events WHERE company_id = $1 OR counterparty_id = $1', [s]);
    counts.participants = await count(client, 'SELECT count(*)::int AS n FROM project_participants WHERE company_id = $1', [s]);
    counts.participantDuplicates = await count(
      client,
      `SELECT count(*)::int AS n FROM project_participants a JOIN project_participants b
         ON b.project_id = a.project_id AND b.role = a.role AND b.company_id = $2 AND b.ended_on IS NULL
       WHERE a.company_id = $1 AND a.ended_on IS NULL`,
      [s, t],
    );
    counts.relations = await count(client, 'SELECT count(*)::int AS n FROM company_relations WHERE from_company_id = $1 OR to_company_id = $1', [s]);
    const eventCollisions = (
      await client.query<{ id: number }>(
        `SELECT a.id FROM events a JOIN events b
           ON b.document_id = a.document_id AND b.type = a.type AND coalesce(b.project_id, 0) = coalesce(a.project_id, 0)
          AND b.company_id = $2
         WHERE a.company_id = $1`,
        [s, t],
      )
    ).rows;
    if (eventCollisions.length > 0) {
      conflicts.push({
        code: 'unique_collision',
        message: `у обеих сторон есть одинаковые legacy-события одного документа (${eventCollisions.length}): разберите их до слияния`,
        details: eventCollisions.map(r => r.id),
      });
    }
  } else {
    if (source.city && target.city && !citiesKnownAndEqual(source.city, target.city)) {
      conflicts.push({ code: 'city_conflict', message: `разные города (${source.city} / ${target.city})` });
    }
    if (!source.city || !target.city) warnings.push('город неизвестен хотя бы у одной стороны — совпадение не подтверждено географией');
    if (source.project_level !== target.project_level || (source.parent_project_id ?? null) !== (target.parent_project_id ?? null)) {
      conflicts.push({ code: 'hierarchy_conflict', message: 'разный уровень или родитель: корпус, очередь и комплекс не сливаются между собой' });
    }
    if ((await isAncestor(client, s, t)) || (await isAncestor(client, t, s))) {
      conflicts.push({ code: 'hierarchy_conflict', message: 'одна сущность входит в другую' });
    }
    counts.events = await count(client, 'SELECT count(*)::int AS n FROM events WHERE project_id = $1', [s]);
    counts.participants = await count(client, 'SELECT count(*)::int AS n FROM project_participants WHERE project_id = $1', [s]);
    counts.participantDuplicates = await count(
      client,
      `SELECT count(*)::int AS n FROM project_participants a JOIN project_participants b
         ON b.company_id = a.company_id AND b.role = a.role AND b.project_id = $2 AND b.ended_on IS NULL
       WHERE a.project_id = $1 AND a.ended_on IS NULL`,
      [s, t],
    );
    counts.children = await count(client, 'SELECT count(*)::int AS n FROM projects WHERE parent_project_id = $1 AND merged_into_id IS NULL', [s]);
    const childCollisions = await count(
      client,
      `SELECT count(*)::int AS n FROM projects a JOIN projects b
         ON b.parent_project_id = $2 AND b.project_level = a.project_level AND b.level_label = a.level_label AND b.merged_into_id IS NULL
       WHERE a.parent_project_id = $1 AND a.merged_into_id IS NULL`,
      [s, t],
    );
    if (childCollisions > 0) {
      conflicts.push({ code: 'unique_collision', message: `одинаковые очереди/корпуса у обеих сторон (${childCollisions}): сначала слейте их` });
    }
    const eventCollisions = await count(
      client,
      `SELECT count(*)::int AS n FROM events a JOIN events b
         ON b.document_id = a.document_id AND b.type = a.type AND coalesce(b.company_id, 0) = coalesce(a.company_id, 0)
        AND b.project_id = $2
       WHERE a.project_id = $1`,
      [s, t],
    );
    if (eventCollisions > 0) {
      conflicts.push({ code: 'unique_collision', message: `у обеих сторон есть одинаковые legacy-события одного документа (${eventCollisions})` });
    }
  }

  counts.aliases = await count(client, 'SELECT count(*)::int AS n FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2', [kind, s]);
  counts.aliasDuplicates = await count(
    client,
    `SELECT count(*)::int AS n FROM entity_aliases a JOIN entity_aliases b
       ON b.entity_kind = a.entity_kind AND b.entity_id = $3 AND b.alias_norm = a.alias_norm
     WHERE a.entity_kind = $1 AND a.entity_id = $2`,
    [kind, s, t],
  );
  counts.mentions = await count(client, 'SELECT count(*)::int AS n FROM mentions WHERE entity_kind = $1 AND entity_id = $2', [kind, s]);
  const sourceAssertions = await assertionIdsReferencing(client, kind, s);
  counts.assertions = sourceAssertions.length;
  counts.activeEvidence = await count(
    client,
    `SELECT count(*)::int AS n FROM evidence WHERE assertion_id = ANY($1::bigint[]) AND status = 'active'`,
    [sourceAssertions],
  );
  counts.pendingQueuePairs = await count(
    client,
    `SELECT count(*)::int AS n FROM merge_queue WHERE entity_kind = $1 AND status = 'pending' AND (source_entity_id = $2 OR target_entity_id = $2)`,
    [kind, s],
  );
  counts.priorMerges = await count(
    client,
    `SELECT count(*)::int AS n FROM entity_merges WHERE entity_kind = $1 AND status = 'applied' AND (target_id = $2 OR target_id = $3)`,
    [kind, s, t],
  );
  const reviewedAssertions = (
    await client.query<{ assertion_id: number; status: string; decisions: number }>(
      `SELECT a.id AS assertion_id, a.status::text AS status, count(r.id)::int AS decisions
       FROM assertions a JOIN review_decisions r ON r.assertion_id = a.id
       WHERE a.id = ANY($1::bigint[]) GROUP BY a.id, a.status ORDER BY a.id`,
      [sourceAssertions],
    )
  ).rows.map(r => ({ assertionId: r.assertion_id, status: r.status, decisions: r.decisions }));
  if (reviewedAssertions.length > 0) {
    warnings.push(
      `решения аналитика по ${reviewedAssertions.length} утверждениям останутся в истории исходных утверждений и на новые не переносятся — нужен пересмотр`,
    );
  }

  return {
    kind,
    source: await summarize(client, kind, source),
    target: await summarize(client, kind, target),
    conflicts,
    warnings,
    counts,
    reviewedAssertions,
    canApply: conflicts.length === 0,
  };
};

export const previewMerge = async (kind: MergeEntityKind, sourceId: number, targetId: number): Promise<IMergePreview> =>
  withTransaction(async client => {
    const source = await loadEntity(client, kind, sourceId);
    const target = await loadEntity(client, kind, targetId);
    if (!source || !target) throw new MergeNotFoundError(kind === 'company' ? 'Компания' : 'Объект');
    const preview = await buildPreview(client, kind, source, target);
    // Предпросмотр ничего не пишет; транзакция нужна только для SET LOCAL-подобной изоляции чтения.
    return preview;
  });

// ---------------------------------------------------------------------------
// Применение

export interface IMergeApplyInput {
  kind: MergeEntityKind;
  sourceId: number;
  targetId: number;
  expectedSourceVersion: number;
  expectedTargetVersion: number;
  idempotencyKey: string;
  actor: string;
  reason?: string | null;
  queueId?: number | null;
  /** Точка сбоя для интеграционных тестов: внутри транзакции после всех записей. */
  beforeCommit?: () => Promise<void>;
}

export interface IMergeApplyResult {
  mergeId: number;
  replayed: boolean;
  counts: Record<string, number>;
  targetVersion: number;
}

interface IMove {
  table: string;
  rowId: number;
  action: 'update' | 'delete' | 'insert' | 'supersede';
  column?: string | null;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  beforeImage?: unknown;
}

const requestHash = (input: IMergeApplyInput): string =>
  createHash('sha256')
    .update(JSON.stringify([input.kind, input.sourceId, input.targetId, input.queueId ?? null]), 'utf8')
    .digest('hex');

/** Колонки, которые слияние меняет и отмена возвращает. Имена — из фиксированного списка, не из ввода. */
const MOVABLE: Record<string, Record<string, string>> = {
  companies: { merged_into_id: 'bigint', tax_id: 'text' },
  projects: { merged_into_id: 'bigint', parent_project_id: 'bigint' },
  entity_aliases: { entity_id: 'bigint', hits: 'int' },
  mentions: { entity_id: 'bigint' },
  events: { company_id: 'bigint', counterparty_id: 'bigint', project_id: 'bigint' },
  project_participants: { company_id: 'bigint', project_id: 'bigint' },
  entity_identifiers: { company_id: 'bigint' },
  company_relations: { from_company_id: 'bigint', to_company_id: 'bigint' },
  merge_queue: { status: 'merge_status' },
  evidence: { status: 'text' },
};

const DELETABLE = new Set(['entity_aliases', 'mentions', 'project_participants']);

const updateColumn = async (
  client: PoolClient,
  moves: IMove[],
  table: string,
  rowId: number,
  column: string,
  oldValue: string | number | null,
  newValue: string | number | null,
): Promise<void> => {
  const type = MOVABLE[table]?.[column];
  if (!type) throw new Error(`слияние: колонка ${table}.${column} не разрешена`);
  await client.query(`UPDATE ${table} SET ${column} = $2::text::${type} WHERE id = $1`, [rowId, newValue === null ? null : String(newValue)]);
  moves.push({ table, rowId, action: 'update', column, oldValue, newValue });
};

const deleteRow = async (client: PoolClient, moves: IMove[], table: string, rowId: number): Promise<void> => {
  if (!DELETABLE.has(table)) throw new Error(`слияние: удаление из ${table} не разрешено`);
  const image = (await client.query<{ image: unknown }>(`SELECT to_jsonb(t) AS image FROM ${table} t WHERE id = $1`, [rowId])).rows[0]?.image;
  await client.query(`DELETE FROM ${table} WHERE id = $1`, [rowId]);
  moves.push({ table, rowId, action: 'delete', beforeImage: image });
};

const moveLegacyRows = async (client: PoolClient, moves: IMove[], kind: MergeEntityKind, s: number, t: number): Promise<void> => {
  // Алиасы: дубликат написания — счётчик цели растёт, строка источника удаляется с образом.
  const aliases = (
    await client.query<{ id: number; hits: number; target_id: number | null; target_hits: number | null }>(
      `SELECT a.id, a.hits, b.id AS target_id, b.hits AS target_hits
       FROM entity_aliases a LEFT JOIN entity_aliases b
         ON b.entity_kind = a.entity_kind AND b.entity_id = $3 AND b.alias_norm = a.alias_norm
       WHERE a.entity_kind = $1 AND a.entity_id = $2 ORDER BY a.id`,
      [kind, s, t],
    )
  ).rows;
  for (const alias of aliases) {
    if (alias.target_id !== null && alias.target_hits !== null) {
      await updateColumn(client, moves, 'entity_aliases', alias.target_id, 'hits', alias.target_hits, alias.target_hits + alias.hits);
      await deleteRow(client, moves, 'entity_aliases', alias.id);
    } else {
      await updateColumn(client, moves, 'entity_aliases', alias.id, 'entity_id', s, t);
    }
  }

  // Упоминания: то же упоминание того же документа у цели — дубликат, удаляется с образом.
  const mentions = (
    await client.query<{ id: number; duplicate: boolean }>(
      `SELECT m.id, EXISTS (
                SELECT 1 FROM mentions x WHERE x.document_id = m.document_id AND x.entity_kind = m.entity_kind
                  AND x.entity_id = $3 AND md5(x.quote) = md5(m.quote)) AS duplicate
       FROM mentions m WHERE m.entity_kind = $1 AND m.entity_id = $2 ORDER BY m.id`,
      [kind, s, t],
    )
  ).rows;
  for (const m of mentions) {
    if (m.duplicate) await deleteRow(client, moves, 'mentions', m.id);
    else await updateColumn(client, moves, 'mentions', m.id, 'entity_id', s, t);
  }

  const fk = kind === 'company' ? 'company_id' : 'project_id';
  const other = kind === 'company' ? 'project_id' : 'company_id';
  for (const col of kind === 'company' ? ['company_id', 'counterparty_id'] : ['project_id']) {
    for (const id of await idsOf(client, `SELECT id FROM events WHERE ${col} = $1 ORDER BY id`, [s])) {
      await updateColumn(client, moves, 'events', id, col, s, t);
    }
  }

  const participants = (
    await client.query<{ id: number; duplicate: boolean }>(
      `SELECT p.id, (p.ended_on IS NULL AND EXISTS (
                SELECT 1 FROM project_participants x WHERE x.${other} = p.${other} AND x.role = p.role
                  AND x.${fk} = $2 AND x.ended_on IS NULL)) AS duplicate
       FROM project_participants p WHERE p.${fk} = $1 ORDER BY p.id`,
      [s, t],
    )
  ).rows;
  for (const p of participants) {
    if (p.duplicate) await deleteRow(client, moves, 'project_participants', p.id);
    else await updateColumn(client, moves, 'project_participants', p.id, fk, s, t);
  }

  if (kind === 'company') {
    for (const id of await idsOf(client, `SELECT id FROM entity_identifiers WHERE company_id = $1 ORDER BY id`, [s])) {
      await updateColumn(client, moves, 'entity_identifiers', id, 'company_id', s, t);
    }
    for (const col of ['from_company_id', 'to_company_id']) {
      for (const id of await idsOf(client, `SELECT id FROM company_relations WHERE ${col} = $1 ORDER BY id`, [s])) {
        await updateColumn(client, moves, 'company_relations', id, col, s, t);
      }
    }
  } else {
    for (const id of await idsOf(client, `SELECT id FROM projects WHERE parent_project_id = $1 AND merged_into_id IS NULL ORDER BY id`, [s])) {
      await updateColumn(client, moves, 'projects', id, 'parent_project_id', s, t);
    }
  }
};

interface IAssertionFullRow {
  id: number;
  predicate: IAssertionContent['predicate'];
  role: string | null;
  event_type: string | null;
  subject_company_id: number | null;
  subject_project_id: number | null;
  subject_text: string | null;
  object_company_id: number | null;
  object_project_id: number | null;
  object_text: string | null;
  counterparty_company_id: number | null;
  scope_building: string | null;
  work_package: string | null;
  valid_from: string | null;
  valid_to: string | null;
  period_precision: IAssertionContent['periodPrecision'];
  modality: Modality;
  value_type: string | null;
  value_numeric: string | null;
  value_currency: string | null;
  event_discriminator: string | null;
  polarity: 'positive' | 'negative';
  context_project_id: number | null;
  work_package_label: string | null;
  attributed_to: string | null;
  case_number: string | null;
  procedural_role: string | null;
  counterparty_role: string | null;
  event_stage: string | null;
  event_outcome: string | null;
  tax_basis: string | null;
  origin: 'extraction' | 'legacy_import' | 'manual';
  confidence_extraction: number | null;
  confidence_identity: number | null;
}

const replaceId = (value: number | null, s: number, t: number): number | null => (value === s ? t : value);

const moveAssertions = async (
  client: PoolClient,
  moves: IMove[],
  kind: MergeEntityKind,
  s: number,
  t: number,
  mergeId: number,
): Promise<{ assertions: number; evidenceCopied: number; evidenceDeduplicated: number }> => {
  const stats = { assertions: 0, evidenceCopied: 0, evidenceDeduplicated: 0 };
  const touched = new Set<number>();
  for (const oldId of await assertionIdsReferencing(client, kind, s)) {
    const a = (
      await client.query<IAssertionFullRow>(
        `SELECT id, predicate, role, event_type, subject_company_id, subject_project_id, subject_text, object_company_id,
                object_project_id, object_text, counterparty_company_id, scope_building, work_package,
                valid_from::text AS valid_from, valid_to::text AS valid_to, period_precision, modality::text AS modality,
                value_type, value_numeric::text AS value_numeric, value_currency, event_discriminator, origin,
                polarity, context_project_id, work_package_label, attributed_to, case_number, procedural_role,
                counterparty_role, event_stage, event_outcome, tax_basis,
                confidence_extraction, confidence_identity
         FROM assertions WHERE id = $1 FOR UPDATE`,
        [oldId],
      )
    ).rows[0]!;
    const evidence = (
      await client.query<{
        id: number;
        revision_id: number;
        stance: string;
        span_start: number;
        span_end: number;
        quote: string;
        context_before: string;
        context_after: string;
        origin: string;
        extraction_id: number | null;
        legacy_kind: string | null;
        legacy_id: number | null;
        extraction_chunk_id: number | null;
      }>(
        `SELECT id, revision_id, stance::text AS stance, span_start, span_end, quote, context_before, context_after, origin,
                extraction_id, legacy_kind, legacy_id, extraction_chunk_id
         FROM evidence WHERE assertion_id = $1 AND status = 'active' ORDER BY id`,
        [oldId],
      )
    ).rows;
    // Утверждение без активных оснований остаётся историей исходной сущности.
    if (evidence.length === 0) continue;

    const content: IAssertionContent = {
      predicate: a.predicate,
      role: a.role,
      eventType: a.event_type,
      subjectCompanyId: kind === 'company' ? replaceId(a.subject_company_id, s, t) : a.subject_company_id,
      subjectProjectId: kind === 'project' ? replaceId(a.subject_project_id, s, t) : a.subject_project_id,
      subjectText: a.subject_text,
      objectCompanyId: kind === 'company' ? replaceId(a.object_company_id, s, t) : a.object_company_id,
      objectProjectId: kind === 'project' ? replaceId(a.object_project_id, s, t) : a.object_project_id,
      objectText: a.object_text,
      counterpartyCompanyId: kind === 'company' ? replaceId(a.counterparty_company_id, s, t) : a.counterparty_company_id,
      scopeBuilding: a.scope_building,
      workPackage: a.work_package,
      validFrom: a.valid_from,
      validTo: a.valid_to,
      periodPrecision: a.period_precision,
      modality: a.modality,
      valueType: a.value_type,
      valueNumeric: a.value_numeric,
      valueCurrency: a.value_currency,
      eventDiscriminator: a.event_discriminator,
      polarity: a.polarity,
      contextProjectId: kind === 'project' ? replaceId(a.context_project_id, s, t) : a.context_project_id,
      workPackageLabel: a.work_package_label,
      attributedTo: a.attributed_to,
      caseNumber: a.case_number,
      proceduralRole: a.procedural_role,
      counterpartyRole: a.counterparty_role,
      eventStage: a.event_stage,
      eventOutcome: a.event_outcome,
      taxBasis: a.tax_basis,
    };
    const next = await upsertAssertion(client, content, {
      origin: a.origin,
      confidenceExtraction: a.confidence_extraction,
      confidenceIdentity: a.confidence_identity,
      supersedesAssertionId: a.id,
    });
    stats.assertions += 1;
    touched.add(a.id);
    touched.add(next.id);

    for (const ev of evidence) {
      // Совпадение идентичности основания (редакция, позиция, позиция) — дубликат, не второе основание.
      const existing = (
        await client.query<{ id: number; status: string }>(
          `SELECT id, status FROM evidence
           WHERE assertion_id = $1 AND revision_id = $2 AND span_start = $3 AND span_end = $4 AND stance = $5::evidence_stance`,
          [next.id, ev.revision_id, ev.span_start, ev.span_end, ev.stance],
        )
      ).rows[0];
      let targetEvidenceId: number;
      if (existing) {
        targetEvidenceId = existing.id;
        stats.evidenceDeduplicated += 1;
        // Та же позиция, снятая прежним разбором или отменой слияния, снова активна;
        // отозванная аналитиком — нет.
        if (existing.status === 'superseded') {
          await updateColumn(client, moves, 'evidence', existing.id, 'status', 'superseded', 'active');
        }
      } else {
        targetEvidenceId = (
          await client.query<{ id: number }>(
            `INSERT INTO evidence
               (assertion_id, revision_id, stance, span_start, span_end, quote, context_before, context_after, origin,
                extraction_id, legacy_kind, legacy_id, extraction_chunk_id, copied_from_evidence_id, merge_id)
             VALUES ($1, $2, $3::evidence_stance, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id`,
            [
              next.id,
              ev.revision_id,
              ev.stance,
              ev.span_start,
              ev.span_end,
              ev.quote,
              ev.context_before,
              ev.context_after,
              ev.origin,
              ev.extraction_id,
              ev.legacy_kind,
              ev.legacy_id,
              ev.extraction_chunk_id,
              ev.id,
              mergeId,
            ],
          )
        ).rows[0]!.id;
        moves.push({ table: 'evidence', rowId: targetEvidenceId, action: 'insert' });
        stats.evidenceCopied += 1;
      }
      await client.query(
        `UPDATE evidence SET status = 'superseded', status_reason = $2, status_changed_at = now() WHERE id = $1`,
        [ev.id, `слияние #${mergeId}: основание перенесено на утверждение #${next.id}`],
      );
      moves.push({ table: 'evidence', rowId: ev.id, action: 'supersede' });

      // Публикации 03B: набор, содержавший исходное основание, содержит и перенесённое.
      const links = (
        await client.query<{ set_id: number }>(
          `INSERT INTO candidate_set_evidence (set_id, evidence_id)
           SELECT set_id, $2 FROM candidate_set_evidence WHERE evidence_id = $1
           ON CONFLICT DO NOTHING RETURNING set_id`,
          [ev.id, targetEvidenceId],
        )
      ).rows;
      for (const link of links) {
        moves.push({ table: 'candidate_set_evidence', rowId: targetEvidenceId, action: 'insert', newValue: link.set_id });
      }
    }
  }
  for (const id of touched) await refreshAssertionState(client, id);
  return stats;
};

const snapshotEntity = async (client: PoolClient, kind: MergeEntityKind, id: number): Promise<unknown> => {
  const row = (await client.query<{ row: unknown }>(`SELECT to_jsonb(t) AS row FROM ${TABLE[kind]} t WHERE id = $1`, [id])).rows[0]?.row;
  const aliases = (
    await client.query<{ alias: string; hits: number }>('SELECT alias, hits FROM entity_aliases WHERE entity_kind = $1 AND entity_id = $2 ORDER BY id', [kind, id])
  ).rows;
  const identifiers = kind === 'company' ? await loadIdentifiers(client, id) : [];
  return { row, aliases, identifiers };
};

interface IMergeRow {
  id: number;
  request_hash: string;
  counts: Record<string, number>;
  target_version_after: number;
}

export const applyEntityMerge = async (input: IMergeApplyInput): Promise<IMergeApplyResult> => {
  const result = await withTransaction(async client => {
    const locked = await lockEntities(client, input.kind, [input.sourceId, input.targetId]);
    const source = locked.get(input.sourceId);
    const target = locked.get(input.targetId);

    // Повтор: тот же ключ и тот же запрос — прежний результат, без записи.
    const prior = (
      await client.query<IMergeRow>(
        'SELECT id, request_hash, counts, target_version_after FROM entity_merges WHERE idempotency_key = $1',
        [input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash(input)) throw new MergeIdempotencyMismatchError();
      return { mergeId: prior.id, replayed: true, counts: prior.counts, targetVersion: prior.target_version_after };
    }

    if (!source || !target) throw new MergeNotFoundError(input.kind === 'company' ? 'Компания' : 'Объект');
    if (source.version !== input.expectedSourceVersion || target.version !== input.expectedTargetVersion) {
      throw new EntityVersionConflictError({ source: source.version, target: target.version });
    }

    const preview = await buildPreview(client, input.kind, source, target);
    if (preview.conflicts.length > 0) throw new MergeBlockedError(preview.conflicts);

    const s = source.id;
    const t = target.id;
    const mergeId = (
      await client.query<{ id: number }>(`SELECT nextval(pg_get_serial_sequence('entity_merges', 'id'))::bigint AS id`)
    ).rows[0]!.id;
    const moves: IMove[] = [];
    const sourceSnapshot = await snapshotEntity(client, input.kind, s);
    const targetSnapshot = await snapshotEntity(client, input.kind, t);

    // Tombstone первым: освобождает уникальность tax_id для переноса на цель.
    await updateColumn(client, moves, TABLE[input.kind], s, 'merged_into_id', null, t);
    if (input.kind === 'company' && source.tax_id && !target.tax_id) {
      await updateColumn(client, moves, 'companies', t, 'tax_id', null, source.tax_id);
    }

    await moveLegacyRows(client, moves, input.kind, s, t);
    const assertionStats = await moveAssertions(client, moves, input.kind, s, t, mergeId);

    if (input.queueId) {
      const queue = (
        await client.query<{ id: number; status: string }>(
          `SELECT id, status::text AS status FROM merge_queue WHERE id = $1 AND entity_kind = $2 FOR UPDATE`,
          [input.queueId, input.kind],
        )
      ).rows[0];
      if (queue) await updateColumn(client, moves, 'merge_queue', queue.id, 'status', queue.status, 'merged');
    }
    for (const id of await idsOf(
      client,
      `SELECT id FROM merge_queue WHERE entity_kind = $1 AND status = 'pending' AND (source_entity_id = $2 OR target_entity_id = $2) ORDER BY id`,
      [input.kind, s],
    )) {
      await updateColumn(client, moves, 'merge_queue', id, 'status', 'pending', 'rejected');
    }

    const versions = (
      await client.query<{ id: number; version: number }>(
        `UPDATE ${TABLE[input.kind]} SET version = version + 1, updated_at = now() WHERE id = ANY($1::bigint[]) RETURNING id, version`,
        [[s, t]],
      )
    ).rows;
    const targetVersion = versions.find(v => v.id === t)!.version;

    const counts = { ...preview.counts, ...assertionStats, moves: moves.length };
    const afterState = await dependencyState(client, input.kind, [s, t]);
    await client.query(
      `INSERT INTO entity_merges
         (id, entity_kind, source_id, target_id, idempotency_key, request_hash, queue_id, actor, reason,
          source_version_before, target_version_before, target_version_after, source_snapshot, target_snapshot, counts, after_state)
       OVERRIDING SYSTEM VALUE
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        mergeId,
        input.kind,
        s,
        t,
        input.idempotencyKey,
        requestHash(input),
        input.queueId ?? null,
        input.actor,
        input.reason ?? null,
        source.version,
        target.version,
        targetVersion,
        JSON.stringify(sourceSnapshot),
        JSON.stringify(targetSnapshot),
        JSON.stringify(counts),
        JSON.stringify(afterState),
      ],
    );
    let seq = 0;
    for (const move of moves) {
      seq += 1;
      await client.query(
        `INSERT INTO entity_merge_moves (merge_id, seq, table_name, row_id, action, column_name, old_value, new_value, before_image)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          mergeId,
          seq,
          move.table,
          move.rowId,
          move.action,
          move.column ?? null,
          move.oldValue === undefined || move.oldValue === null ? null : String(move.oldValue),
          move.newValue === undefined || move.newValue === null ? null : String(move.newValue),
          move.beforeImage === undefined ? null : JSON.stringify(move.beforeImage),
        ],
      );
    }

    if (input.beforeCommit) await input.beforeCommit();
    return { mergeId, replayed: false, counts, targetVersion };
  });

  if (!result.replayed) await refreshMetricsQuietly();
  return result;
};

const refreshMetricsQuietly = async (): Promise<void> => {
  // Метрики — производные legacy-таблиц; сбой пересчёта не отменяет слияние.
  try {
    await refreshCompanyMetrics();
  } catch (err) {
    console.warn(`[merge] пересчёт метрик не выполнен: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ---------------------------------------------------------------------------
// Отмена

export interface IUndoInput {
  mergeId: number;
  actor: string;
  idempotencyKey: string;
  /** Точка сбоя для интеграционных тестов. */
  beforeCommit?: () => Promise<void>;
}

export interface IUndoResult {
  mergeId: number;
  replayed: boolean;
  restoredMoves: number;
}

interface IMoveRow {
  seq: number;
  table_name: string;
  row_id: number;
  action: IMove['action'];
  column_name: string | null;
  old_value: string | null;
  new_value: string | null;
  before_image: Record<string, unknown> | null;
}

export const undoEntityMerge = async (input: IUndoInput): Promise<IUndoResult> => {
  const result = await withTransaction(async client => {
    const merge = (
      await client.query<{
        id: number;
        entity_kind: MergeEntityKind;
        source_id: number;
        target_id: number;
        status: string;
        after_state: Record<string, string[]>;
        undo_idempotency_key: string | null;
      }>(
        `SELECT id, entity_kind, source_id, target_id, status, after_state, undo_idempotency_key
         FROM entity_merges WHERE id = $1 FOR UPDATE`,
        [input.mergeId],
      )
    ).rows[0];
    if (!merge) throw new MergeNotFoundError('Слияние');
    if (merge.status === 'undone') {
      if (merge.undo_idempotency_key === input.idempotencyKey) return { mergeId: merge.id, replayed: true, restoredMoves: 0 };
      throw new UnsafeUndoError({ reason: 'слияние уже отменено', changes: [], steps: [] });
    }

    const kind = merge.entity_kind;
    await lockEntities(client, kind, [merge.source_id, merge.target_id]);
    const now = await dependencyState(client, kind, [merge.source_id, merge.target_id]);
    const changes = diffStates(merge.after_state, now);
    if (changes.length > 0) {
      throw new UnsafeUndoError({
        reason: 'после слияния у сущностей появились или изменились зависимости',
        changes,
        steps: [
          'Автоматически ничего не применяется.',
          `Проверьте новые зависимости #${merge.target_id} по списку и решите, какие относятся к #${merge.source_id}.`,
          `Для отнесённых к #${merge.source_id}: отдельной операцией переназначить их после восстановления сущности (split).`,
          'Решения аналитика по затронутым утверждениям пересмотреть заново.',
        ],
      });
    }

    const moves = (
      await client.query<IMoveRow>(
        `SELECT seq, table_name, row_id, action, column_name, old_value, new_value, before_image
         FROM entity_merge_moves WHERE merge_id = $1 ORDER BY seq DESC`,
        [merge.id],
      )
    ).rows;
    const touchedEvidence: number[] = [];

    for (const move of moves) {
      if (move.action === 'update') {
        const type = move.column_name ? MOVABLE[move.table_name]?.[move.column_name] : undefined;
        if (!type) throw new Error(`отмена: колонка ${move.table_name}.${move.column_name} не разрешена`);
        await client.query(`UPDATE ${move.table_name} SET ${move.column_name} = $2::text::${type} WHERE id = $1`, [
          move.row_id,
          move.old_value,
        ]);
      } else if (move.action === 'delete') {
        if (!DELETABLE.has(move.table_name)) throw new Error(`отмена: вставка в ${move.table_name} не разрешена`);
        await client.query(
          `INSERT INTO ${move.table_name} OVERRIDING SYSTEM VALUE
           SELECT * FROM jsonb_populate_record(NULL::${move.table_name}, $1::jsonb)`,
          [JSON.stringify(move.before_image)],
        );
      } else if (move.action === 'insert' && move.table_name === 'candidate_set_evidence') {
        await client.query('DELETE FROM candidate_set_evidence WHERE set_id = $1 AND evidence_id = $2', [Number(move.new_value), move.row_id]);
      } else if (move.action === 'insert' && move.table_name === 'evidence') {
        await client.query(
          `UPDATE evidence SET status = 'superseded', status_reason = $2, status_changed_at = now() WHERE id = $1 AND status = 'active'`,
          [move.row_id, `отмена слияния #${merge.id}`],
        );
        touchedEvidence.push(move.row_id);
      } else if (move.action === 'supersede') {
        await client.query(
          `UPDATE evidence SET status = 'active', status_reason = NULL, status_changed_at = now() WHERE id = $1 AND status = 'superseded'`,
          [move.row_id],
        );
        touchedEvidence.push(move.row_id);
      }
    }

    const assertionIds = (
      await client.query<{ assertion_id: number }>('SELECT DISTINCT assertion_id FROM evidence WHERE id = ANY($1::bigint[])', [touchedEvidence])
    ).rows.map(r => r.assertion_id);
    for (const id of assertionIds) await refreshAssertionState(client, id);

    await client.query(`UPDATE ${TABLE[kind]} SET version = version + 1, updated_at = now() WHERE id = ANY($1::bigint[])`, [
      [merge.source_id, merge.target_id],
    ]);
    await client.query(
      `UPDATE entity_merges SET status = 'undone', undone_at = now(), undone_by = $2, undo_idempotency_key = $3 WHERE id = $1`,
      [merge.id, input.actor, input.idempotencyKey],
    );
    if (input.beforeCommit) await input.beforeCommit();
    return { mergeId: merge.id, replayed: false, restoredMoves: moves.length };
  });
  if (!result.replayed) await refreshMetricsQuietly();
  return result;
};
