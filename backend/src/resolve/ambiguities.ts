// Решения по неоднозначным упоминаниям (этап 15A, ADR-005 дополнение).
//
// Неоднозначность — одно упоминание (вид, ключ имени, редакция) с несколькими равноправными кандидатами.
// Решение аналитика относится только к этому упоминанию:
//  - resolved_to — в этой редакции имеется в виду кандидат X; резолвер при следующем разборе той же редакции
//    выберет X (без алиаса: одноимённые упоминания в других текстах остаются неоднозначными);
//  - kept_unknown — сознательно не выбираем, упоминание остаётся без сущности;
//  - dismissed — не упоминание компании/объекта.
// Решение не сливает сущности, не переписывает канон и не подтверждает участие, договор или долг.
// Выбор, противоречащий реквизитам или правовой форме из текста, отвергается; исключения по умолчанию нет.

import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { DbExecutor } from '../db/pool.js';
import { query, withTransaction } from '../db/pool.js';
import { classifyTaxId } from './identifiers.js';
import { normalizeName } from './normalize.js';

export type AmbiguityKind = 'company' | 'project';
export type AmbiguityStatus = 'open' | 'resolved' | 'dismissed';
export type AmbiguityDecisionKind = 'resolved_to' | 'kept_unknown' | 'dismissed';

export const AMBIGUITY_DECISION_VERSION = 'ambiguity-decision@1';
export const AMBIGUITY_PAGE_LIMIT = 100;
/** Окно текста вокруг упоминания, в котором ищутся реквизиты (code points). */
export const IDENTIFIER_WINDOW = 200;

export interface IAmbiguityCandidate {
  id: number;
  name: string;
  mergedIntoId: number | null;
  legalForm: string | null;
  entityType: string | null;
  city: string | null;
  identifiers: Array<{ type: string; value: string }>;
}

export interface IChoiceConflict {
  code: 'not_candidate' | 'candidate_merged' | 'identifier_other_candidate' | 'identifier_mismatch' | 'legal_form_conflict';
  message: string;
}

export interface IChoiceCheck {
  conflicts: IChoiceConflict[];
  /** Реквизиты, найденные в тексте рядом с упоминанием. */
  textIdentifiers: Array<{ type: string; value: string }>;
  textLegalForm: string | null;
  notes: string[];
}

const cp = (s: string): string[] => Array.from(s);

/** Окна текста вокруг каждого вхождения упоминания; позиции в code points. */
export const mentionWindows = (body: string, surface: string, radius = IDENTIFIER_WINDOW): string[] => {
  const chars = cp(body);
  const needle = cp(surface);
  if (needle.length === 0) return [];
  const windows: string[] = [];
  for (let i = 0; i + needle.length <= chars.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (chars[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) windows.push(chars.slice(Math.max(0, i - radius), Math.min(chars.length, i + needle.length + radius)).join(''));
  }
  return windows;
};

/** Реквизиты — последовательности цифр длиной 10/12/13/15, не часть более длинного числа. */
export const identifiersIn = (text: string): Array<{ type: string; value: string }> => {
  const found = new Map<string, { type: string; value: string }>();
  for (const m of text.matchAll(/(?<![0-9])[0-9]{10,15}(?![0-9])/g)) {
    const typed = classifyTaxId(m[0]);
    if (typed) found.set(`${typed.identifierType}:${typed.value}`, { type: typed.identifierType, value: typed.value });
  }
  return [...found.values()];
};

const typeOf = (t: string): string => t.split(':').pop() ?? t;

/**
 * Чистая проверка выбора кандидата. Город не сверяется: у неоднозначности нет подтверждённого цитатой города
 * упоминания (ограничение этапа).
 */
export const checkAmbiguityChoice = (input: {
  kind: AmbiguityKind;
  surface: string;
  body: string | null;
  candidateIds: readonly number[];
  candidates: readonly IAmbiguityCandidate[];
  chosenId: number;
}): IChoiceCheck => {
  const conflicts: IChoiceConflict[] = [];
  const notes: string[] = [];
  const chosen = input.candidates.find(c => c.id === input.chosenId);
  if (!input.candidateIds.includes(input.chosenId) || !chosen) {
    conflicts.push({ code: 'not_candidate', message: `#${input.chosenId} не входит в кандидатов этого упоминания` });
  } else if (chosen.mergedIntoId !== null) {
    conflicts.push({ code: 'candidate_merged', message: `#${chosen.id} слита в #${chosen.mergedIntoId}; обновите кандидатов` });
  }

  const windows = input.body === null ? [] : mentionWindows(input.body, input.surface);
  if (input.body === null) notes.push('редакция упоминания не сохранена — реквизиты из текста не проверены');
  else if (windows.length === 0) notes.push('упоминание не найдено в тексте редакции дословно — реквизиты из текста не проверены');
  const textIdentifiers = identifiersIn(windows.join('\n'));

  const textLegalForm = input.kind === 'company' ? (normalizeName(input.surface, 'company').legalForm ?? null) : null;

  if (chosen && input.kind === 'company') {
    for (const ti of textIdentifiers) {
      const owners = input.candidates.filter(c => c.identifiers.some(i => typeOf(i.type) === ti.type && i.value === ti.value));
      if (owners.some(o => o.id !== chosen.id)) {
        conflicts.push({
          code: 'identifier_other_candidate',
          message: `реквизит ${ti.value} рядом с упоминанием принадлежит другому кандидату (#${owners.map(o => o.id).join(', #')})`,
        });
      }
      const sameType = chosen.identifiers.filter(i => typeOf(i.type) === ti.type);
      if (sameType.length > 0 && !sameType.some(i => i.value === ti.value)) {
        conflicts.push({ code: 'identifier_mismatch', message: `у #${chosen.id} другой ${ti.type.toUpperCase()}, чем ${ti.value} в тексте` });
      }
    }
    const a = (textLegalForm ?? '').trim().toUpperCase();
    const b = (chosen.legalForm ?? '').trim().toUpperCase();
    if (a && b && a !== b) {
      conflicts.push({ code: 'legal_form_conflict', message: `в тексте ${a}, у #${chosen.id} — ${b}` });
    }
  }
  notes.push('город упоминания не сверяется: в неоднозначности он не подтверждён цитатой');
  return { conflicts, textIdentifiers, textLegalForm, notes };
};

export const decisionRequestHash = (input: {
  ambiguityId: number;
  decision: AmbiguityDecisionKind;
  entityId: number | null;
  reason: string;
  expectedVersion: number;
}): string =>
  createHash('sha256')
    .update(
      JSON.stringify([AMBIGUITY_DECISION_VERSION, input.ambiguityId, input.decision, input.entityId, input.reason.trim(), input.expectedVersion]),
      'utf8',
    )
    .digest('hex');

// ---------------------------------------------------------------------------
// Ошибки

export class AmbiguityNotFoundError extends Error {
  constructor(id: number) {
    super(`Неоднозначность #${id} не найдена`);
    this.name = 'AmbiguityNotFoundError';
  }
}

export class AmbiguityVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Неоднозначность изменилась (новые кандидаты или чужое решение). Обновите и решите заново.');
    this.name = 'AmbiguityVersionConflictError';
  }
}

export class AmbiguityIdempotencyError extends Error {
  constructor() {
    super('Ключ идемпотентности уже использован для другого решения');
    this.name = 'AmbiguityIdempotencyError';
  }
}

export class AmbiguityChoiceBlockedError extends Error {
  constructor(readonly conflicts: IChoiceConflict[]) {
    super(`Выбор отклонён: ${conflicts.map(c => c.message).join('; ')}`);
    this.name = 'AmbiguityChoiceBlockedError';
  }
}

// ---------------------------------------------------------------------------
// Чтение

interface IAmbiguityRow {
  id: number;
  entity_kind: AmbiguityKind;
  surface: string;
  name_key: string;
  candidate_ids: string[] | number[];
  revision_id: number | null;
  occurrences: number;
  status: AmbiguityStatus;
  resolved_entity_id: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const ids = (raw: ReadonlyArray<string | number>): number[] => raw.map(Number);

export interface IAmbiguityListItem {
  id: number;
  entityKind: AmbiguityKind;
  surface: string;
  candidateIds: number[];
  revisionId: number | null;
  occurrences: number;
  status: AmbiguityStatus;
  version: number;
  updatedAt: string;
}

export interface IAmbiguityPage {
  items: IAmbiguityListItem[];
  /** Всего по фильтру, а не длина страницы. */
  total: number;
  nextCursor: string | null;
}

const encodeCursor = (updatedAt: string, id: number): string => Buffer.from(JSON.stringify([updatedAt, id]), 'utf8').toString('base64url');

export const decodeCursor = (raw: string | undefined): { updatedAt: string; id: number } | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && Number.isSafeInteger(parsed[1]) && !Number.isNaN(Date.parse(parsed[0]))) {
      return { updatedAt: parsed[0], id: parsed[1] as number };
    }
  } catch {
    return null;
  }
  return null;
};

export const listAmbiguities = async (filter: {
  kind?: AmbiguityKind;
  status: AmbiguityStatus;
  limit: number;
  cursor: { updatedAt: string; id: number } | null;
}): Promise<IAmbiguityPage> => {
  const limit = Math.max(1, Math.min(AMBIGUITY_PAGE_LIMIT, filter.limit));
  const params: unknown[] = [filter.status, filter.kind ?? null];
  const base = `status = $1 AND ($2::entity_kind IS NULL OR entity_kind = $2::entity_kind)`;
  const total = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM resolution_ambiguities WHERE ${base}`, params))[0]?.n ?? 0;
  const pageParams = [...params, filter.cursor?.updatedAt ?? null, filter.cursor?.id ?? null, limit + 1];
  const rows = await query<IAmbiguityRow>(
    `SELECT id, entity_kind, surface, name_key, candidate_ids, revision_id, occurrences, status, resolved_entity_id, version,
            created_at, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM resolution_ambiguities
     WHERE ${base} AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3::timestamptz, $4::bigint))
     ORDER BY updated_at DESC, id DESC LIMIT $5`,
    pageParams,
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(r => ({
      id: r.id,
      entityKind: r.entity_kind,
      surface: r.surface,
      candidateIds: ids(r.candidate_ids),
      revisionId: r.revision_id,
      occurrences: r.occurrences,
      status: r.status,
      version: r.version,
      updatedAt: r.updated_at,
    })),
    total,
    nextCursor: rows.length > limit && last ? encodeCursor(last.updated_at, last.id) : null,
  };
};

const loadCandidates = async (exec: DbExecutor, kind: AmbiguityKind, candidateIds: readonly number[]): Promise<IAmbiguityCandidate[]> => {
  if (kind === 'company') {
    const rows = (
      await exec.query<{ id: number; name: string; merged_into_id: number | null; legal_form: string | null; entity_type: string; city: string | null; tax_id: string | null }>(
        'SELECT id, name, merged_into_id, legal_form, entity_type, city, tax_id FROM companies WHERE id = ANY($1::bigint[]) ORDER BY id',
        [candidateIds],
      )
    ).rows;
    const idRows = (
      await exec.query<{ company_id: number; identifier_type: string; jurisdiction: string; value: string }>(
        `SELECT company_id, identifier_type, jurisdiction, value FROM entity_identifiers
         WHERE company_id = ANY($1::bigint[]) AND status = 'active' ORDER BY id`,
        [candidateIds],
      )
    ).rows;
    return rows.map(r => {
      const identifiers = idRows.filter(i => Number(i.company_id) === Number(r.id)).map(i => ({ type: `${i.jurisdiction}:${i.identifier_type}`, value: i.value }));
      const legacy = r.tax_id ? classifyTaxId(r.tax_id) : null;
      if (legacy && !identifiers.some(i => typeOf(i.type) === legacy.identifierType && i.value === legacy.value)) {
        identifiers.push({ type: `${legacy.jurisdiction}:${legacy.identifierType}`, value: legacy.value });
      }
      return { id: Number(r.id), name: r.name, mergedIntoId: r.merged_into_id, legalForm: r.legal_form, entityType: r.entity_type, city: r.city, identifiers };
    });
  }
  const rows = (
    await exec.query<{ id: number; name: string; merged_into_id: number | null; city: string | null; project_level: string }>(
      'SELECT id, name, merged_into_id, city, project_level FROM projects WHERE id = ANY($1::bigint[]) ORDER BY id',
      [candidateIds],
    )
  ).rows;
  return rows.map(r => ({ id: Number(r.id), name: r.name, mergedIntoId: r.merged_into_id, legalForm: null, entityType: r.project_level, city: r.city, identifiers: [] }));
};

export interface IAmbiguityDecisionView {
  id: number;
  decision: AmbiguityDecisionKind;
  entityId: number | null;
  reason: string;
  actor: string;
  ambiguityVersion: number;
  decidedAt: string;
}

export interface IAmbiguityDetail extends IAmbiguityListItem {
  revision: { id: number; excerpt: string | null; publishedAt: string | null } | null;
  whyAmbiguous: string;
  candidates: Array<IAmbiguityCandidate & { choice: IChoiceCheck }>;
  decisions: IAmbiguityDecisionView[];
  /** Решение — о том, кто упомянут, а не о том, что утверждение о нём доказано. */
  scopeNote: string;
}

const WHY: Record<AmbiguityKind, string> = {
  company:
    'Несколько живых компаний с тем же ключом имени и совместимой формой (или без реквизитов); в тексте нет реквизита, который выбрал бы одну.',
  project: 'Несколько объектов-комплексов с тем же ключом имени; город в тексте не выделяет один.',
};

const loadDecisions = async (exec: DbExecutor, ambiguityId: number): Promise<IAmbiguityDecisionView[]> =>
  (
    await exec.query<{ id: number; decision: AmbiguityDecisionKind; entity_id: number | null; reason: string; actor: string; ambiguity_version: number; decided_at: string }>(
      `SELECT id, decision, entity_id, reason, actor, ambiguity_version, decided_at FROM ambiguity_decisions WHERE ambiguity_id = $1 ORDER BY id DESC`,
      [ambiguityId],
    )
  ).rows.map(r => ({
    id: Number(r.id),
    decision: r.decision,
    entityId: r.entity_id === null ? null : Number(r.entity_id),
    reason: r.reason,
    actor: r.actor,
    ambiguityVersion: r.ambiguity_version,
    decidedAt: r.decided_at,
  }));

export const getAmbiguity = async (id: number): Promise<IAmbiguityDetail> =>
  withTransaction(async client => {
    const row = (await client.query<IAmbiguityRow>('SELECT * FROM resolution_ambiguities WHERE id = $1', [id])).rows[0];
    if (!row) throw new AmbiguityNotFoundError(id);
    const candidateIds = ids(row.candidate_ids);
    const revision =
      row.revision_id === null
        ? null
        : ((
            await client.query<{ id: number; body: string; published_at: string | null }>(
              `SELECT r.id, r.body, si.published_at FROM document_revisions r JOIN source_items si ON si.id = r.source_item_id WHERE r.id = $1`,
              [row.revision_id],
            )
          ).rows[0] ?? null);
    const candidates = await loadCandidates(client, row.entity_kind, candidateIds);
    const excerpt = revision ? (mentionWindows(revision.body, row.surface, 300)[0] ?? null) : null;
    return {
      id: row.id,
      entityKind: row.entity_kind,
      surface: row.surface,
      candidateIds,
      revisionId: row.revision_id,
      occurrences: row.occurrences,
      status: row.status,
      version: row.version,
      updatedAt: row.updated_at,
      revision: revision ? { id: revision.id, excerpt, publishedAt: revision.published_at } : null,
      whyAmbiguous: WHY[row.entity_kind],
      candidates: candidates.map(c => ({
        ...c,
        choice: checkAmbiguityChoice({ kind: row.entity_kind, surface: row.surface, body: revision?.body ?? null, candidateIds, candidates, chosenId: c.id }),
      })),
      decisions: await loadDecisions(client, row.id),
      scopeNote:
        'Выбор юрлица относится только к этому упоминанию в этой редакции. Это не слияние одноимённых компаний и не подтверждение участия, договора или долга.',
    };
  });

// ---------------------------------------------------------------------------
// Решение

export interface IDecideAmbiguityInput {
  ambiguityId: number;
  decision: AmbiguityDecisionKind;
  entityId: number | null;
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actor: string;
}

export interface IDecideAmbiguityResult {
  decisionId: number;
  replayed: boolean;
  status: AmbiguityStatus;
  version: number;
}

const statusFor = (decision: AmbiguityDecisionKind): AmbiguityStatus => (decision === 'dismissed' ? 'dismissed' : 'resolved');

export const decideAmbiguity = async (input: IDecideAmbiguityInput): Promise<IDecideAmbiguityResult> =>
  withTransaction(async (client: PoolClient) => {
    const hash = decisionRequestHash(input);
    const row = (await client.query<IAmbiguityRow>('SELECT * FROM resolution_ambiguities WHERE id = $1 FOR UPDATE', [input.ambiguityId])).rows[0];

    // Повтор после блокировки: конкурентный запрос с тем же ключом дождётся первого и увидит его запись.
    const prior = (
      await client.query<{ id: number; request_hash: string; decision: AmbiguityDecisionKind }>(
        'SELECT id, request_hash, decision FROM ambiguity_decisions WHERE idempotency_key = $1',
        [input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new AmbiguityIdempotencyError();
      return { decisionId: Number(prior.id), replayed: true, status: row?.status ?? statusFor(prior.decision), version: row?.version ?? 0 };
    }

    if (!row) throw new AmbiguityNotFoundError(input.ambiguityId);
    if (row.version !== input.expectedVersion) throw new AmbiguityVersionConflictError(row.version);

    if (input.decision === 'resolved_to') {
      const candidateIds = ids(row.candidate_ids);
      const body =
        row.revision_id === null
          ? null
          : ((await client.query<{ body: string }>('SELECT body FROM document_revisions WHERE id = $1', [row.revision_id])).rows[0]?.body ?? null);
      const candidates = await loadCandidates(client, row.entity_kind, candidateIds);
      const check = checkAmbiguityChoice({ kind: row.entity_kind, surface: row.surface, body, candidateIds, candidates, chosenId: input.entityId ?? 0 });
      if (check.conflicts.length > 0) throw new AmbiguityChoiceBlockedError(check.conflicts);
    }

    const decisionId = (
      await client.query<{ id: number }>(
        `INSERT INTO ambiguity_decisions (ambiguity_id, decision, entity_id, reason, actor, ambiguity_version, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [row.id, input.decision, input.decision === 'resolved_to' ? input.entityId : null, input.reason.trim(), input.actor, row.version, input.idempotencyKey, hash],
      )
    ).rows[0]!.id;
    const updated = (
      await client.query<{ version: number; status: AmbiguityStatus }>(
        `UPDATE resolution_ambiguities
         SET status = $2, resolved_entity_id = $3, decided_by = $4, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING version, status`,
        [row.id, statusFor(input.decision), input.decision === 'resolved_to' ? input.entityId : null, input.actor],
      )
    ).rows[0]!;
    return { decisionId: Number(decisionId), replayed: false, status: updated.status, version: updated.version };
  });

// ---------------------------------------------------------------------------
// Резолвер

const followTombstone = async (exec: DbExecutor, kind: AmbiguityKind, id: number): Promise<number> => {
  let current = id;
  const seen = new Set<number>();
  for (let hop = 0; hop < 10 && !seen.has(current); hop += 1) {
    seen.add(current);
    const next = (
      await exec.query<{ merged_into_id: number | null }>(
        `SELECT merged_into_id FROM ${kind === 'company' ? 'companies' : 'projects'} WHERE id = $1`,
        [current],
      )
    ).rows[0]?.merged_into_id;
    if (next === null || next === undefined) return current;
    current = Number(next);
  }
  return current;
};

/**
 * Действующее решение аналитика для упоминания в этой редакции. Возвращает живую сущность, только если она всё ещё
 * среди текущих кандидатов: сменился набор кандидатов — неоднозначность записывается снова, а не решается старым выбором.
 * Без редакции решение не применяется (иначе оно распространилось бы на все одноимённые тексты).
 */
export const analystMapping = async (
  exec: DbExecutor,
  kind: AmbiguityKind,
  nameKey: string,
  revisionId: number | null,
  liveCandidateIds: readonly number[],
): Promise<number | null> => {
  if (revisionId === null) return null;
  const last = (
    await exec.query<{ decision: AmbiguityDecisionKind; entity_id: number | null }>(
      `SELECT d.decision, d.entity_id FROM ambiguity_decisions d
       JOIN resolution_ambiguities m ON m.id = d.ambiguity_id
       WHERE m.entity_kind = $1 AND m.name_key = $2 AND m.revision_id = $3
       ORDER BY d.id DESC LIMIT 1`,
      [kind, nameKey, revisionId],
    )
  ).rows[0];
  if (!last || last.decision !== 'resolved_to' || last.entity_id === null) return null;
  const live = await followTombstone(exec, kind, Number(last.entity_id));
  return liveCandidateIds.includes(live) ? live : null;
};
