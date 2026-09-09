// Резолвинг компаний: имя из текста -> id в canonical-слое.
//
// Главная асимметрия, вокруг которой построен весь алгоритм: слить две компании
// в одну легко, разлить обратно — почти невозможно (упоминания, события и роли
// уже перемешаны, и восстановить, что чьё, неоткуда). Поэтому в серой зоне
// уверенности мы СОЗДАЁМ НОВУЮ компанию и кладём пару в merge_queue, а не
// сливаем. Дубль стоит одной кнопки в админке; ошибочное слияние стоит данных.

import type { DbExecutor } from '../db/pool.js';
import {
  normalizeName,
  isJunkName,
  isShortAmbiguousName,
  isValidTaxId,
  type INormalizedName,
} from './normalize.js';

/** Порог отбора кандидатов в pg_trgm. Ниже — шум, выше — теряем опечатки. */
const TRGM_THRESHOLD = 0.35;

/** Кандидат с латиницей ниже этого не рассматривается вовсе. */
const MIN_LATIN_SIMILARITY = 0.45;

export const AUTO_MERGE_SCORE = 0.92;
export const QUEUE_SCORE = 0.75;

export interface IResolveInput {
  /** Имя ровно как в тексте. */
  surface: string;
  legalForm?: string | null;
  taxId?: string | null;
  city?: string | null;
  /** Документ-основание: попадёт в merge_queue как образец. */
  documentId?: number | null;
}

export type ResolveMethod =
  | 'tax_id'
  | 'alias'
  | 'key'
  | 'auto_merge'
  | 'created'
  | 'created_queued';

export interface IResolveResult {
  companyId: number;
  method: ResolveMethod;
  confidence: number;
  /** Пара ушла на ручное подтверждение. */
  queued: boolean;
}

interface ICandidateRow {
  id: number;
  name: string;
  tax_id: string | null;
  city: string | null;
  legal_form: string | null;
  s_latin: number;
  s_norm: number;
}

/**
 * Слияние оставляет tombstone (merged_into_id). Любая найденная ссылка должна
 * вести на живую компанию, иначе упоминания повиснут на удалённой.
 */
const followTombstone = async (exec: DbExecutor, id: number): Promise<number> => {
  let current = id;
  // Цепочка A->B->C возможна, если сливали дважды. Ограничение защищает от
  // цикла, которого быть не должно, но проверять дешевле, чем зависнуть.
  for (let hop = 0; hop < 10; hop += 1) {
    const res = await exec.query<{ merged_into_id: number | null }>(
      'SELECT merged_into_id FROM companies WHERE id = $1',
      [current],
    );
    const next = res.rows[0]?.merged_into_id;
    if (next == null) return current;
    current = next;
  }
  return current;
};

const addAlias = async (
  exec: DbExecutor,
  companyId: number,
  surface: string,
  normalized: INormalizedName,
): Promise<void> => {
  await exec.query(
    `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source)
     VALUES ('company', $1, $2, $3, $4, 'llm')
     ON CONFLICT (entity_kind, entity_id, alias_norm)
     DO UPDATE SET hits = entity_aliases.hits + 1`,
    [companyId, surface, normalized.norm, normalized.latin],
  );
};

const createCompany = async (
  exec: DbExecutor,
  input: IResolveInput,
  normalized: INormalizedName,
  acceptedTaxId: string | null,
): Promise<number> => {
  const res = await exec.query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin, legal_form, tax_id, city)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      normalized.display,
      normalized.norm,
      normalized.latin,
      input.legalForm ?? normalized.legalForm,
      acceptedTaxId,
      input.city ?? null,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error(`Не удалось создать компанию «${normalized.display}»`);
  await addAlias(exec, id, input.surface, normalized);
  return id;
};

const fetchCandidates = async (
  exec: DbExecutor,
  normalized: INormalizedName,
): Promise<ICandidateRow[]> => {
  // Порог живёт до конца транзакции. Без него оператор % использует значение
  // по умолчанию 0.3 и тянет заметно больше шума.
  await exec.query(`SET LOCAL pg_trgm.similarity_threshold = ${TRGM_THRESHOLD}`);

  // Полный скан запрещён: отбор идёт оператором %, который умеет GIN-индекс.
  const res = await exec.query<ICandidateRow>(
    `WITH cand AS (
       SELECT c.id,
              similarity(c.name_latin, $1) AS s_latin,
              similarity(c.name_norm,  $2) AS s_norm
       FROM companies c
       WHERE c.merged_into_id IS NULL AND c.name_latin % $1
       UNION ALL
       SELECT a.entity_id,
              similarity(a.alias_latin, $1),
              similarity(a.alias_norm,  $2)
       FROM entity_aliases a
       WHERE a.entity_kind = 'company' AND a.alias_latin % $1
     )
     SELECT c.id, c.name, c.tax_id, c.city, c.legal_form,
            max(cand.s_latin) AS s_latin,
            max(cand.s_norm)  AS s_norm
     FROM cand
     JOIN companies c ON c.id = cand.id AND c.merged_into_id IS NULL
     GROUP BY c.id, c.name, c.tax_id, c.city, c.legal_form
     ORDER BY max(cand.s_latin) DESC
     LIMIT 25`,
    [normalized.latin, normalized.norm],
  );
  return res.rows;
};

interface IScored {
  candidate: ICandidateRow;
  score: number;
  reasons: Record<string, unknown>;
  /** Слияние запрещено навсегда: разные ИНН/ОГРН. */
  forbidden: boolean;
}

const scoreCandidate = (
  candidate: ICandidateRow,
  input: IResolveInput,
  acceptedTaxId: string | null,
): IScored => {
  const reasons: Record<string, unknown> = {
    s_latin: Number(candidate.s_latin.toFixed(3)),
    s_norm: Number(candidate.s_norm.toFixed(3)),
  };

  // Разные ИНН/ОГРН — это разные юрлица, какими бы похожими ни были названия.
  // Пишем пару как отклонённую навсегда, чтобы она не всплывала в очереди.
  if (acceptedTaxId && candidate.tax_id && acceptedTaxId !== candidate.tax_id) {
    reasons.tax_id = 'conflict';
    return { candidate, score: 0, reasons, forbidden: true };
  }
  reasons.tax_id = acceptedTaxId && candidate.tax_id ? 'match' : 'none';

  let score = 0.55 * candidate.s_latin + 0.25 * candidate.s_norm;

  if (input.city && candidate.city) {
    const match = normalizeName(input.city).key === normalizeName(candidate.city).key;
    reasons.city = match ? 'match' : 'differ';
    if (match) score += 0.1;
  } else {
    reasons.city = 'unknown';
  }

  const inputForm = (input.legalForm ?? '').toUpperCase();
  const candidateForm = (candidate.legal_form ?? '').toUpperCase();
  if (inputForm && candidateForm) {
    if (inputForm === candidateForm) {
      reasons.legal_form = 'match';
      score += 0.1;
    } else {
      // ТОО против АО — сигнал против слияния, но не запрет: форма в тексте
      // указывается небрежно.
      reasons.legal_form = 'conflict';
      score -= 0.1;
    }
  } else {
    reasons.legal_form = 'unknown';
  }

  return { candidate, score: Math.max(0, Math.min(1, score)), reasons, forbidden: false };
};

const enqueueMerge = async (
  exec: DbExecutor,
  sourceId: number,
  targetId: number,
  scored: IScored,
  documentId: number | null,
  status: 'pending' | 'rejected',
): Promise<void> => {
  await exec.query(
    `INSERT INTO merge_queue
       (entity_kind, source_entity_id, target_entity_id, score, reasons, sample_document_id, status)
     VALUES ('company', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
     DO NOTHING`,
    [sourceId, targetId, scored.score, JSON.stringify(scored.reasons), documentId, status],
  );
};

/**
 * Полный резолвинг. Возвращает null, если имя признано мусором (роль вместо
 * названия, слишком короткое) — такую сущность создавать нельзя, она склеит
 * десятки разных компаний.
 *
 * Обязательно вызывать внутри транзакции: между поиском кандидатов и вставкой
 * параллельный воркер может создать ту же компанию.
 */
export const resolveCompany = async (
  exec: DbExecutor,
  input: IResolveInput,
): Promise<IResolveResult | null> => {
  const normalized = normalizeName(input.surface, 'company');
  if (isJunkName(normalized)) return null;

  const acceptedTaxId = input.taxId && isValidTaxId(input.taxId) ? input.taxId : null;

  // Ш1. ИНН/ОГРН — сильный идентификатор, отменяет всё остальное.
  if (acceptedTaxId) {
    const byTaxId = await exec.query<{ id: number }>(
      'SELECT id FROM companies WHERE tax_id = $1 AND merged_into_id IS NULL',
      [acceptedTaxId],
    );
    const id = byTaxId.rows[0]?.id;
    if (id !== undefined) {
      await addAlias(exec, id, input.surface, normalized);
      return { companyId: id, method: 'tax_id', confidence: 1, queued: false };
    }
  }

  // Ш2. Точный алиас — это имя уже встречалось.
  const byAlias = await exec.query<{ entity_id: number }>(
    `SELECT entity_id FROM entity_aliases
     WHERE entity_kind = 'company' AND alias_norm = $1
     LIMIT 1`,
    [normalized.norm],
  );
  const aliasId = byAlias.rows[0]?.entity_id;
  if (aliasId !== undefined) {
    const live = await followTombstone(exec, aliasId);
    await addAlias(exec, live, input.surface, normalized);
    return { companyId: live, method: 'alias', confidence: 0.98, queued: false };
  }

  // Ш3. Точный ключ — та же компания, записанная другой графикой.
  const byKey = await exec.query<{ id: number }>(
    'SELECT id FROM companies WHERE name_key = $1 AND merged_into_id IS NULL LIMIT 1',
    [normalized.key],
  );
  const keyId = byKey.rows[0]?.id;
  if (keyId !== undefined) {
    await addAlias(exec, keyId, input.surface, normalized);
    return { companyId: keyId, method: 'key', confidence: 0.95, queued: false };
  }

  // Ш4-5. Кандидаты и скоринг.
  const candidates = await fetchCandidates(exec, normalized);
  const scored = candidates
    .filter(c => c.s_latin >= MIN_LATIN_SIMILARITY)
    .map(c => scoreCandidate(c, input, acceptedTaxId))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  // Ш6. Пороги.
  if (best && !best.forbidden && best.score >= AUTO_MERGE_SCORE && !isShortAmbiguousName(normalized)) {
    await addAlias(exec, best.candidate.id, input.surface, normalized);
    return {
      companyId: best.candidate.id,
      method: 'auto_merge',
      confidence: best.score,
      queued: false,
    };
  }

  const newId = await createCompany(exec, input, normalized, acceptedTaxId);

  // Запреты фиксируем сразу: пара с конфликтом ИНН не должна всплывать в очереди.
  for (const forbidden of scored.filter(s => s.forbidden)) {
    await enqueueMerge(exec, newId, forbidden.candidate.id, forbidden, input.documentId ?? null, 'rejected');
  }

  if (!best || best.forbidden || best.score < QUEUE_SCORE) {
    return { companyId: newId, method: 'created', confidence: 1, queued: false };
  }

  // Серая зона либо короткое неоднозначное имя: создали отдельную компанию,
  // решение о слиянии оставили человеку.
  await enqueueMerge(exec, newId, best.candidate.id, best, input.documentId ?? null, 'pending');
  return { companyId: newId, method: 'created_queued', confidence: best.score, queued: true };
};
