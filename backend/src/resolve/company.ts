// Резолвинг компаний: имя из текста -> id в canonical-слое.
//
// Главная асимметрия, вокруг которой построен весь алгоритм: слить две компании
// в одну легко, разлить обратно — почти невозможно (упоминания, события и роли
// уже перемешаны, и восстановить, что чьё, неоткуда). Поэтому в серой зоне
// уверенности мы СОЗДАЁМ НОВУЮ компанию и кладём пару в merge_queue, а не
// сливаем. Дубль стоит одной кнопки в админке; ошибочное слияние стоит данных.
//
// Этап 04:
//  - реквизит ищется в реестре entity_identifiers по типу (ИНН ≠ ОГРН), затем в legacy tax_id;
//  - точное имя никогда не обходит реквизиты: упоминание с ИНН не прикрепляется к
//    одноимённой компании без этого ИНН, а упоминание без реквизитов и формы — к
//    юрлицу с реквизитами (бренд не получает ИНН дочернего ООО);
//  - для упоминаний без реквизитов есть одна стабильная provisional-сущность на имя:
//    повтор не плодит «пустых дублей»;
//  - несколько равноправных кандидатов — не выбор первого и не новая сущность, а запись
//    в resolution_ambiguities с якорем-редакцией.

import type { DbExecutor } from '../db/pool.js';
import { addIdentifier, classifyTaxId, findCompanyByIdentifier } from './identifiers.js';
import {
  NORMALIZER_VERSION,
  compareTaxIds,
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
  /** Редакция-основание: якорь реквизита и неоднозначного совпадения. */
  revisionId?: number | null;
}

export type ResolveMethod =
  | 'tax_id'
  | 'alias'
  | 'key'
  | 'provisional'
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

export interface ICandidateRow {
  id: number;
  name: string;
  tax_id: string | null;
  city: string | null;
  legal_form: string | null;
  s_latin: number;
  s_norm: number;
}

/** Организационные формы, означающие группу, а не юрлицо. */
const GROUP_FORMS = new Set(['ГК', 'ГРУППА КОМПАНИЙ', 'ХОЛДИНГ']);

export type CompanyEntityType = 'legal_entity' | 'brand' | 'group' | 'unknown';

/** Тип новой сущности из того, что реально есть в тексте. Бренд ставит только оператор. */
export const inferEntityType = (legalForm: string | null | undefined, hasIdentifier: boolean): CompanyEntityType => {
  const form = (legalForm ?? '').trim().toUpperCase();
  if (form && GROUP_FORMS.has(form)) return 'group';
  if (hasIdentifier || form) return 'legal_entity';
  return 'unknown';
};

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
  const legalForm = input.legalForm ?? normalized.legalForm;
  const res = await exec.query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin, legal_form, tax_id, city, entity_type, normalizer_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      normalized.display,
      normalized.norm,
      normalized.latin,
      legalForm,
      acceptedTaxId,
      input.city ?? null,
      inferEntityType(legalForm, acceptedTaxId !== null),
      NORMALIZER_VERSION,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error(`Не удалось создать компанию «${normalized.display}»`);
  await addAlias(exec, id, input.surface, normalized);
  const typed = acceptedTaxId ? classifyTaxId(acceptedTaxId) : null;
  if (typed) {
    await addIdentifier(exec, { ...typed, companyId: id, origin: 'extraction', sourceRevisionId: input.revisionId ?? null });
  }
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

export interface IScored {
  candidate: ICandidateRow;
  score: number;
  reasons: Record<string, unknown>;
  /** Слияние запрещено навсегда: разные ИНН/ОГРН. */
  forbidden: boolean;
}

/**
 * Экспортируется ради тестов: это самая опасная логика в проекте — от неё
 * зависит, склеятся две компании в одну или останутся раздельными, — а
 * проверить её через БД дорого.
 */
export const scoreCandidate = (
  candidate: ICandidateRow,
  input: IResolveInput,
  acceptedTaxId: string | null,
): IScored => {
  const reasons: Record<string, unknown> = {
    s_latin: Number(candidate.s_latin.toFixed(3)),
    s_norm: Number(candidate.s_norm.toFixed(3)),
  };

  // Разные ИНН (или разные ОГРН) — это разные юрлица, какими бы похожими ни
  // были названия. Пишем пару как отклонённую навсегда. ИНН против ОГРН —
  // разные реквизиты, их несовпадение ничего не доказывает.
  const taxComparison = compareTaxIds(acceptedTaxId, candidate.tax_id);
  if (taxComparison === 'conflict') {
    reasons.tax_id = 'conflict';
    return { candidate, score: 0, reasons, forbidden: true };
  }
  reasons.tax_id = taxComparison;

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
      // ООО против АО — сигнал против слияния, но не запрет: форма в тексте
      // указывается небрежно.
      reasons.legal_form = 'conflict';
      score -= 0.1;
    }
  } else {
    reasons.legal_form = 'unknown';
  }

  return { candidate, score: Math.max(0, Math.min(1, score)), reasons, forbidden: false };
};

/**
 * Годится ли единственный точный кандидат для быстрого пути: реквизиты одного
 * вида не расходятся и организационная форма не противоречит.
 */
export const isExactCandidateCompatible = (
  candidate: { tax_id: string | null; legal_form: string | null },
  acceptedTaxId: string | null,
  legalForm: string | null | undefined,
): boolean => {
  if (compareTaxIds(acceptedTaxId, candidate.tax_id) === 'conflict') return false;
  const inputForm = (legalForm ?? '').trim().toUpperCase();
  const candidateForm = (candidate.legal_form ?? '').trim().toUpperCase();
  return !(inputForm && candidateForm && inputForm !== candidateForm);
};

export interface IExactCandidate {
  id: number;
  tax_id: string | null;
  legal_form: string | null;
  entity_type: CompanyEntityType;
  identifiers: number;
}

export type ExactDecision =
  | { kind: 'reuse'; id: number; provisional: boolean }
  | { kind: 'create'; queueWith: number[]; forbidWith: number[]; provisional: boolean }
  | { kind: 'ambiguous'; candidateIds: number[] };

const hasIdentifier = (c: IExactCandidate): boolean => c.identifiers > 0 || c.tax_id !== null;

/**
 * Решение по точным совпадениям имени (алиас или ключ). Чистая функция — ради тестов.
 *
 *  - упоминание с реквизитом сюда попадает, только если реквизит не найден: одноимённые
 *    кандидаты без него — пара в очередь, с другим реквизитом того же вида — запрет;
 *  - упоминание с формой без реквизита: ровно один совместимый по форме кандидат — он;
 *    несколько — неоднозначность;
 *  - упоминание без формы и реквизита: ровно одна provisional-сущность (без реквизитов,
 *    тип unknown/brand) — она; нет — создаём одну provisional и ставим пары; несколько — неоднозначность.
 */
export const decideExact = (
  candidates: readonly IExactCandidate[],
  acceptedTaxId: string | null,
  legalForm: string | null,
): ExactDecision => {
  if (acceptedTaxId) {
    const forbidWith = candidates.filter(c => compareTaxIds(acceptedTaxId, c.tax_id) === 'conflict').map(c => c.id);
    const queueWith = candidates.filter(c => !forbidWith.includes(c.id)).map(c => c.id);
    return { kind: 'create', queueWith, forbidWith, provisional: false };
  }

  const form = (legalForm ?? '').trim().toUpperCase();
  if (form) {
    const compatible = candidates.filter(c => isExactCandidateCompatible(c, null, form));
    if (compatible.length === 1) return { kind: 'reuse', id: compatible[0]!.id, provisional: false };
    if (compatible.length > 1) return { kind: 'ambiguous', candidateIds: compatible.map(c => c.id) };
    return { kind: 'create', queueWith: candidates.map(c => c.id), forbidWith: [], provisional: false };
  }

  const provisional = candidates.filter(c => !hasIdentifier(c) && (c.entity_type === 'unknown' || c.entity_type === 'brand'));
  if (provisional.length === 1) return { kind: 'reuse', id: provisional[0]!.id, provisional: true };
  if (provisional.length > 1) return { kind: 'ambiguous', candidateIds: provisional.map(c => c.id) };
  return { kind: 'create', queueWith: candidates.map(c => c.id), forbidWith: [], provisional: true };
};

const enqueueMerge = async (
  exec: DbExecutor,
  sourceId: number,
  targetId: number,
  scored: Pick<IScored, 'score' | 'reasons'>,
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

/** Неоднозначность с якорем-редакцией: повтор той же публикации только увеличивает счётчик. */
export const recordAmbiguity = async (
  exec: DbExecutor,
  input: { kind: 'company' | 'project'; surface: string; nameKey: string; candidateIds: number[]; revisionId: number | null },
): Promise<void> => {
  await exec.query(
    `INSERT INTO resolution_ambiguities (entity_kind, surface, name_key, candidate_ids, revision_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entity_kind, name_key, coalesce(revision_id, 0))
     DO UPDATE SET occurrences = resolution_ambiguities.occurrences + 1, candidate_ids = EXCLUDED.candidate_ids,
                   updated_at = now()`,
    [input.kind, input.surface, input.nameKey, input.candidateIds, input.revisionId],
  );
};

const loadExactCandidates = async (exec: DbExecutor, ids: readonly number[]): Promise<IExactCandidate[]> => {
  const live = [...new Set(await Promise.all(ids.map(id => followTombstone(exec, id))))];
  return (
    await exec.query<IExactCandidate>(
      `SELECT c.id, c.tax_id, c.legal_form, c.entity_type,
              (SELECT count(*)::int FROM entity_identifiers i WHERE i.company_id = c.id AND i.status = 'active') AS identifiers
       FROM companies c WHERE c.id = ANY($1::bigint[]) AND c.merged_into_id IS NULL ORDER BY c.id`,
      [live],
    )
  ).rows;
};

/**
 * Полный резолвинг. Возвращает null, если имя признано мусором (роль вместо
 * названия, слишком короткое) или совпадение неоднозначно (записано в
 * resolution_ambiguities) — такую сущность создавать или выбирать нельзя.
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
  const legalForm = input.legalForm ?? normalized.legalForm;

  // Ш1. Реквизит по типу — сильный идентификатор, отменяет всё остальное.
  const typed = acceptedTaxId ? classifyTaxId(acceptedTaxId) : null;
  if (typed) {
    const id = await findCompanyByIdentifier(exec, typed);
    if (id !== null) {
      await addAlias(exec, id, input.surface, normalized);
      return { companyId: id, method: 'tax_id', confidence: 1, queued: false };
    }
  }

  // Ш2. Точный алиас — это имя уже встречалось. Ш3. Точный ключ — та же графика.
  for (const step of ['alias', 'key'] as const) {
    const ids =
      step === 'alias'
        ? (
            await exec.query<{ entity_id: number }>(
              `SELECT DISTINCT entity_id FROM entity_aliases
               WHERE entity_kind = 'company' AND alias_norm = $1`,
              [normalized.norm],
            )
          ).rows.map(r => r.entity_id)
        : (
            await exec.query<{ id: number }>(
              'SELECT id FROM companies WHERE name_key = $1 AND merged_into_id IS NULL',
              [normalized.key],
            )
          ).rows.map(r => r.id);
    if (ids.length === 0) continue;

    const candidates = await loadExactCandidates(exec, ids);
    if (candidates.length === 0) continue;
    const decision = decideExact(candidates, acceptedTaxId, legalForm);

    if (decision.kind === 'reuse') {
      await addAlias(exec, decision.id, input.surface, normalized);
      return {
        companyId: decision.id,
        method: decision.provisional ? 'provisional' : step,
        confidence: step === 'alias' ? 0.98 : 0.95,
        queued: false,
      };
    }
    if (decision.kind === 'ambiguous') {
      await recordAmbiguity(exec, {
        kind: 'company',
        surface: input.surface,
        nameKey: normalized.key,
        candidateIds: decision.candidateIds,
        revisionId: input.revisionId ?? null,
      });
      return null;
    }

    const newId = await createCompany(exec, input, normalized, acceptedTaxId);
    for (const id of decision.forbidWith) {
      await enqueueMerge(exec, newId, id, { score: 0, reasons: { tax_id: 'conflict', exact_name: true } }, input.documentId ?? null, 'rejected');
    }
    for (const id of decision.queueWith) {
      await enqueueMerge(
        exec,
        newId,
        id,
        { score: 0.9, reasons: { exact_name: step, tax_id: acceptedTaxId ? 'only_one_side' : 'none', note: 'бренд, юрлицо или одна компания — решает оператор' } },
        input.documentId ?? null,
        'pending',
      );
    }
    return {
      companyId: newId,
      method: decision.queueWith.length > 0 ? 'created_queued' : 'created',
      confidence: 1,
      queued: decision.queueWith.length > 0,
    };
  }

  // Ш4-5. Кандидаты и скоринг.
  const candidates = await fetchCandidates(exec, normalized);
  const scored = candidates
    .filter(c => c.s_latin >= MIN_LATIN_SIMILARITY)
    .map(c => scoreCandidate(c, input, acceptedTaxId))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  // Ш6. Пороги. Автослияние по похожести — только когда реквизиты не противоречат
  // и имя не короткое; упоминание без реквизитов не прикрепляется к юрлицу с реквизитами.
  if (
    best &&
    !best.forbidden &&
    best.score >= AUTO_MERGE_SCORE &&
    !isShortAmbiguousName(normalized) &&
    !(acceptedTaxId === null && best.candidate.tax_id !== null) &&
    !(acceptedTaxId !== null && best.candidate.tax_id === null)
  ) {
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

  // Серая зона, короткое имя или разная полнота реквизитов: создали отдельную
  // компанию, решение о слиянии оставили человеку.
  await enqueueMerge(exec, newId, best.candidate.id, best, input.documentId ?? null, 'pending');
  return { companyId: newId, method: 'created_queued', confidence: best.score, queued: true };
};
