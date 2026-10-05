// Назначение имени без ИНН компании (ADR-016, этап 23D): «публикации разбираются и назначаются
// существующим компаниям; спорное решает человек».
//
// Карточка без реквизита — упоминание (provisional-сущность резолвера). Человек выбирает одно из трёх:
//  - «это компания X» — слияние упоминания в X существующим путём: предпросмотр и применение с токеном
//    (resolve/entityMerge.ts, /api/entities/merge*); утверждения и публикации переходят к X;
//  - «это юрлицо с ИНН …» — реквизит origin = 'manual' на саму карточку (identifyCompany): она становится
//    компанией каталога; реквизит уже у другой карточки — значит, это «компания X», и экран предлагает слияние;
//  - «не компания» — отметка с причиной (company_dismissals): упоминание уходит из очереди «Без ИНН».
//
// Кандидаты — подсказки, а не решения: похожие юрлица портала (pg_trgm, бесплатно), пары «возможный дубль»
// из merge_queue с вердиктом модели, если он есть, и подсказки Контур.Фокуса по названию (focus/suggest.ts).

import type { PoolClient } from 'pg';

import type { DbExecutor } from '../db/pool.js';
import { addIdentifier, classifyTaxId, type ITypedIdentifier } from '../resolve/identifiers.js';
import { suggestionView, type ISuggestionView } from '../focus/suggest.js';

/** Похожесть названия, ниже которой юрлицо портала кандидатом не предлагается. */
const SIMILARITY_MIN = 0.45;
const PORTAL_CANDIDATES_MAX = 5;

export type AssignmentState = 'unidentified' | 'identified' | 'group' | 'dismissed';

export interface IPortalCandidate {
  companyId: number;
  name: string;
  inn: string | null;
  ogrn: string | null;
  city: string | null;
  entityType: string;
  /** Похожесть названия 0..1; null — кандидат пришёл только из пары «возможный дубль». */
  similarity: number | null;
  /** Пара в «Проверка → Дубли»: её id и вердикт модели, если модель смотрела. */
  mergeQueueId: number | null;
  modelVerdict: 'same' | 'different' | 'unsure' | null;
  modelReason: string | null;
}

export interface IEgrulCandidate extends ISuggestionView {
  /** Карточка портала с этим реквизитом: тогда выбор — слияние с ней, а не новый реквизит. */
  existingCompanyId: number | null;
  existingCompanyName: string | null;
}

export interface IAssignmentView {
  state: AssignmentState;
  dismissal: { reason: string; by: string; at: string } | null;
  portal: IPortalCandidate[];
  egrul: IEgrulCandidate[];
  search: { query: string; searchedAt: string | null; nextSearchAt: string; lastError: string | null } | null;
}

const LEGAL_TYPES = ['inn', 'ogrn', 'ogrnip'];

export const loadAssignment = async (db: DbExecutor, companyId: number): Promise<IAssignmentView | null> => {
  const company = (
    await db.query<{ name: string; name_latin: string; entity_type: string; identified: boolean }>(
      `SELECT c.name, c.name_latin, c.entity_type,
              EXISTS (SELECT 1 FROM entity_identifiers i WHERE i.company_id = c.id AND i.status = 'active'
                        AND i.validation_status = 'checksum_valid' AND i.identifier_type = ANY($2::text[])) AS identified
       FROM companies c WHERE c.id = $1 AND c.merged_into_id IS NULL`,
      [companyId, LEGAL_TYPES],
    )
  ).rows[0];
  if (!company) return null;

  const dismissal = (
    await db.query<{ reason: string; dismissed_by: string; dismissed_at: Date }>(
      'SELECT reason, dismissed_by, dismissed_at FROM company_dismissals WHERE company_id = $1 AND revoked_at IS NULL',
      [companyId],
    )
  ).rows[0];
  const state: AssignmentState = company.identified
    ? 'identified'
    : company.entity_type === 'group'
      ? 'group'
      : dismissal
        ? 'dismissed'
        : 'unidentified';
  const base = {
    state,
    dismissal: dismissal ? { reason: dismissal.reason, by: dismissal.dismissed_by, at: dismissal.dismissed_at.toISOString() } : null,
  };
  if (state === 'identified' || state === 'group') return { ...base, portal: [], egrul: [], search: null };

  return { ...base, portal: await portalCandidates(db, companyId, company.name_latin), ...(await egrulCandidates(db, companyId)) };
};

/** Похожие юрлица и группы портала и пары «возможный дубль» с этим упоминанием. */
const portalCandidates = async (db: DbExecutor, companyId: number, latin: string): Promise<IPortalCandidate[]> => {
  const rows = (
    await db.query<{
      id: number; name: string; city: string | null; entity_type: string; inn: string | null; ogrn: string | null;
      similarity: number | null; queue_id: number | null; model_verdict: IPortalCandidate['modelVerdict']; model_reason: string | null;
    }>(
      // «similar» — ключевое слово PostgreSQL (SIMILAR TO): имя CTE — alike.
      `WITH alike AS (
         SELECT c.id, greatest(similarity(c.name_latin, $2),
                  coalesce((SELECT max(similarity(a.alias_latin, $2)) FROM entity_aliases a
                            WHERE a.entity_kind = 'company' AND a.entity_id = c.id), 0)) AS similarity
         FROM companies c
         WHERE c.merged_into_id IS NULL AND c.id <> $1
           AND (c.name_latin % $2 OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_kind = 'company'
                                               AND a.entity_id = c.id AND a.alias_latin % $2))
       ),
       pairs AS (
         SELECT DISTINCT ON (other) q.id, CASE WHEN q.source_entity_id = $1 THEN q.target_entity_id ELSE q.source_entity_id END AS other,
                q.model_verdict, q.model_reason
         FROM merge_queue q
         WHERE q.entity_kind = 'company' AND q.status = 'pending' AND $1 IN (q.source_entity_id, q.target_entity_id)
         ORDER BY other, q.id DESC
       ),
       ids AS (
         SELECT company_id,
                min(value) FILTER (WHERE identifier_type = 'inn') AS inn,
                min(value) FILTER (WHERE identifier_type IN ('ogrn', 'ogrnip')) AS ogrn
         FROM entity_identifiers WHERE status = 'active' AND validation_status = 'checksum_valid' AND identifier_type = ANY($3::text[])
         GROUP BY company_id
       )
       SELECT c.id, c.name, c.city, c.entity_type, ids.inn, ids.ogrn, s.similarity, p.id AS queue_id, p.model_verdict, p.model_reason
       FROM companies c
       LEFT JOIN alike s ON s.id = c.id
       LEFT JOIN pairs p ON p.other = c.id
       LEFT JOIN ids ON ids.company_id = c.id
       WHERE c.merged_into_id IS NULL
         -- Пара из «Дублей» — всегда; похожее имя — только у юрлица с реквизитом или группы: назначать
         -- упоминание другому упоминанию незачем, это решается в «Дублях».
         AND (p.id IS NOT NULL OR (s.similarity >= $4 AND (ids.company_id IS NOT NULL OR c.entity_type = 'group')))
       ORDER BY (p.model_verdict = 'same') DESC NULLS LAST, (ids.company_id IS NOT NULL) DESC, s.similarity DESC NULLS LAST, c.id
       LIMIT $5`,
      [companyId, latin, LEGAL_TYPES, SIMILARITY_MIN, PORTAL_CANDIDATES_MAX],
    )
  ).rows;
  return rows.map(r => ({
    companyId: r.id,
    name: r.name,
    inn: r.inn,
    ogrn: r.ogrn,
    city: r.city,
    entityType: r.entity_type,
    similarity: r.similarity === null ? null : Math.round(r.similarity * 100) / 100,
    mergeQueueId: r.queue_id,
    modelVerdict: r.model_verdict,
    modelReason: r.model_reason,
  }));
};

/** Подсказки Контур.Фокуса по названию и состояние поиска. */
const egrulCandidates = async (db: DbExecutor, companyId: number): Promise<Pick<IAssignmentView, 'egrul' | 'search'>> => {
  const suggestions = (
    await db.query<{ inn: string | null; ogrn: string | null; payload: Record<string, unknown>; existing_id: number | null; existing_name: string | null }>(
      `SELECT s.inn, s.ogrn, s.payload, e.company_id AS existing_id, c.name AS existing_name
       FROM company_name_suggestions s
       LEFT JOIN LATERAL (
         SELECT i.company_id FROM entity_identifiers i JOIN companies x ON x.id = i.company_id AND x.merged_into_id IS NULL
         WHERE i.status = 'active' AND ((s.inn IS NOT NULL AND i.identifier_type = 'inn' AND i.value = s.inn)
                                     OR (s.inn IS NULL AND i.identifier_type IN ('ogrn', 'ogrnip') AND i.value = s.ogrn))
         ORDER BY i.id LIMIT 1
       ) e ON true
       LEFT JOIN companies c ON c.id = e.company_id
       WHERE s.company_id = $1 ORDER BY s.rank`,
      [companyId],
    )
  ).rows;
  const search = (
    await db.query<{ query: string; searched_at: Date | null; next_search_at: Date; last_error: string | null }>(
      'SELECT query, searched_at, next_search_at, last_error FROM company_name_searches WHERE company_id = $1',
      [companyId],
    )
  ).rows[0];
  return {
    egrul: suggestions.map(s => ({
      ...suggestionView(s.payload, s.inn, s.ogrn),
      existingCompanyId: s.existing_id === companyId ? null : s.existing_id,
      existingCompanyName: s.existing_id === companyId ? null : s.existing_name,
    })),
    search: search
      ? { query: search.query, searchedAt: search.searched_at?.toISOString() ?? null, nextSearchAt: search.next_search_at.toISOString(), lastError: search.last_error }
      : null,
  };
};

export type IdentifyResult =
  | { ok: true; identifier: ITypedIdentifier }
  | { ok: false; reason: 'bad_format' | 'bad_checksum' | 'not_found' }
  | { ok: false; reason: 'identifier_taken'; companyId: number; companyName: string }
  | { ok: false; reason: 'identifier_conflict'; value: string };

/**
 * «Это юрлицо с ИНН …»: реквизит на саму карточку. Те же проверки, что у POST /entities/companies/:id/identifiers:
 * чужой реквизит не переписывается (это слияние), второй ИНН у карточки не добавляется. Вид «не установлен»
 * становится «юрлицо». Вызывать в транзакции.
 */
export const identifyCompany = async (client: PoolClient, input: { companyId: number; raw: string; actor: string }): Promise<IdentifyResult> => {
  const typed = classifyTaxId(input.raw);
  if (!typed || !LEGAL_TYPES.includes(typed.identifierType)) return { ok: false, reason: 'bad_format' };
  if (typed.validationStatus !== 'checksum_valid') return { ok: false, reason: 'bad_checksum' };
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`company-identifier:${typed.identifierType}:${typed.value}`]);
  const company = (
    await client.query<{ id: number }>('SELECT id FROM companies WHERE id = $1 AND merged_into_id IS NULL FOR UPDATE', [input.companyId])
  ).rows[0];
  if (!company) return { ok: false, reason: 'not_found' };

  const owner = (
    await client.query<{ company_id: number; name: string }>(
      `SELECT i.company_id, c.name FROM entity_identifiers i JOIN companies c ON c.id = i.company_id
       WHERE i.jurisdiction = $1 AND i.identifier_type = $2 AND i.value = $3 AND i.status = 'active'`,
      [typed.jurisdiction, typed.identifierType, typed.value],
    )
  ).rows[0];
  if (owner && owner.company_id !== input.companyId) return { ok: false, reason: 'identifier_taken', companyId: owner.company_id, companyName: owner.name };
  const sameType = (
    await client.query<{ value: string }>(
      `SELECT value FROM entity_identifiers WHERE company_id = $1 AND jurisdiction = $2 AND identifier_type = $3 AND status = 'active'`,
      [input.companyId, typed.jurisdiction, typed.identifierType],
    )
  ).rows[0];
  if (sameType && sameType.value !== typed.value) return { ok: false, reason: 'identifier_conflict', value: sameType.value };

  await addIdentifier(client, { ...typed, companyId: input.companyId, origin: 'manual', createdBy: input.actor });
  await client.query(
    `UPDATE companies SET entity_type = 'legal_entity', version = version + 1, updated_at = now()
     WHERE id = $1 AND entity_type = 'unknown'`,
    [input.companyId],
  );
  return { ok: true, identifier: typed };
};

/** «Не компания» с причиной. true — отметили сейчас, false — уже стояла. */
export const dismissCompany = async (db: DbExecutor, companyId: number, reason: string, actor: string): Promise<boolean> => {
  const res = await db.query(
    `INSERT INTO company_dismissals (company_id, reason, dismissed_by) VALUES ($1, $2, $3)
     ON CONFLICT (company_id) WHERE revoked_at IS NULL DO NOTHING`,
    [companyId, reason, actor],
  );
  return (res.rowCount ?? 0) > 0;
};

/** Вернуть в очередь «Без ИНН». true — сняли сейчас. */
export const restoreCompany = async (db: DbExecutor, companyId: number, actor: string): Promise<boolean> => {
  const res = await db.query(
    'UPDATE company_dismissals SET revoked_by = $2, revoked_at = now() WHERE company_id = $1 AND revoked_at IS NULL',
    [companyId, actor],
  );
  return (res.rowCount ?? 0) > 0;
};
