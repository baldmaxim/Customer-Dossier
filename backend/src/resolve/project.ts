// Резолвинг объектов (ЖК, БЦ, микрорайоны).
//
// Отличия от компаний, и все три существенные:
//  1. Имена объектов гораздо более омонимичны: «ЖК Астана» есть в трёх городах.
//     Поэтому порог автослияния выше — 0.94.
//  2. Город работает не как бонус, а как запрет: если города известны и разные,
//     автослияние запрещено, максимум очередь.
//  3. Общий заказчик — сильный дополнительный сигнал: два «Самала» с одним и
//     тем же заказчиком почти наверняка один объект.

import type { DbExecutor } from '../db/pool.js';
import { normalizeName, isJunkName, type INormalizedName } from './normalize.js';

const TRGM_THRESHOLD = 0.35;
const MIN_LATIN_SIMILARITY = 0.45;

export const PROJECT_AUTO_MERGE_SCORE = 0.94;
export const PROJECT_QUEUE_SCORE = 0.78;

/** Бонус за общего участника: два объекта с тем же заказчиком — скорее один. */
const SHARED_PARTICIPANT_BONUS = 0.1;

export type ProjectKind =
  | 'residential'
  | 'office'
  | 'industrial'
  | 'infrastructure'
  | 'social'
  | 'other';

export type ProjectStage =
  | 'announced'
  | 'design'
  | 'construction'
  | 'suspended'
  | 'commissioned'
  | 'cancelled'
  | 'unknown';

export interface IResolveProjectInput {
  surface: string;
  kind?: ProjectKind;
  stage?: ProjectStage;
  city?: string | null;
  address?: string | null;
  /** Компании, уже привязанные к этому объекту в текущем документе. */
  relatedCompanyIds?: readonly number[];
  documentId?: number | null;
}

export interface IResolveProjectResult {
  projectId: number;
  method: 'alias' | 'key' | 'auto_merge' | 'created' | 'created_queued';
  confidence: number;
  queued: boolean;
}

interface IProjectCandidate {
  id: number;
  name: string;
  city: string | null;
  s_latin: number;
  s_norm: number;
  shared_participants: number;
}

const addAlias = async (
  exec: DbExecutor,
  projectId: number,
  surface: string,
  normalized: INormalizedName,
): Promise<void> => {
  await exec.query(
    `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source)
     VALUES ('project', $1, $2, $3, $4, 'llm')
     ON CONFLICT (entity_kind, entity_id, alias_norm)
     DO UPDATE SET hits = entity_aliases.hits + 1`,
    [projectId, surface, normalized.norm, normalized.latin],
  );
};

const followTombstone = async (exec: DbExecutor, id: number): Promise<number> => {
  let current = id;
  for (let hop = 0; hop < 10; hop += 1) {
    const res = await exec.query<{ merged_into_id: number | null }>(
      'SELECT merged_into_id FROM projects WHERE id = $1',
      [current],
    );
    const next = res.rows[0]?.merged_into_id;
    if (next == null) return current;
    current = next;
  }
  return current;
};

const createProject = async (
  exec: DbExecutor,
  input: IResolveProjectInput,
  normalized: INormalizedName,
): Promise<number> => {
  const res = await exec.query<{ id: number }>(
    `INSERT INTO projects (name, name_norm, name_latin, kind, stage, city, address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      normalized.display,
      normalized.norm,
      normalized.latin,
      input.kind ?? 'other',
      input.stage ?? 'unknown',
      input.city ?? null,
      input.address ?? null,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error(`Не удалось создать объект «${normalized.display}»`);
  await addAlias(exec, id, input.surface, normalized);
  return id;
};

const fetchCandidates = async (
  exec: DbExecutor,
  normalized: INormalizedName,
  relatedCompanyIds: readonly number[],
): Promise<IProjectCandidate[]> => {
  await exec.query(`SET LOCAL pg_trgm.similarity_threshold = ${TRGM_THRESHOLD}`);

  const res = await exec.query<IProjectCandidate>(
    `WITH cand AS (
       SELECT p.id,
              similarity(p.name_latin, $1) AS s_latin,
              similarity(p.name_norm,  $2) AS s_norm
       FROM projects p
       WHERE p.merged_into_id IS NULL AND p.name_latin % $1
       UNION ALL
       SELECT a.entity_id,
              similarity(a.alias_latin, $1),
              similarity(a.alias_norm,  $2)
       FROM entity_aliases a
       WHERE a.entity_kind = 'project' AND a.alias_latin % $1
     )
     SELECT p.id, p.name, p.city,
            max(cand.s_latin) AS s_latin,
            max(cand.s_norm)  AS s_norm,
            (SELECT count(*)::int FROM project_participants pp
             WHERE pp.project_id = p.id AND pp.company_id = ANY($3::bigint[])) AS shared_participants
     FROM cand
     JOIN projects p ON p.id = cand.id AND p.merged_into_id IS NULL
     GROUP BY p.id, p.name, p.city
     ORDER BY max(cand.s_latin) DESC
     LIMIT 25`,
    [normalized.latin, normalized.norm, [...relatedCompanyIds]],
  );
  return res.rows;
};

interface IScoredProject {
  candidate: IProjectCandidate;
  score: number;
  reasons: Record<string, unknown>;
  /** Города известны и разные: автослияние запрещено. */
  cityConflict: boolean;
}

const scoreCandidate = (
  candidate: IProjectCandidate,
  input: IResolveProjectInput,
): IScoredProject => {
  const reasons: Record<string, unknown> = {
    s_latin: Number(candidate.s_latin.toFixed(3)),
    s_norm: Number(candidate.s_norm.toFixed(3)),
  };

  let score = 0.55 * candidate.s_latin + 0.25 * candidate.s_norm;
  let cityConflict = false;

  if (input.city && candidate.city) {
    const match = normalizeName(input.city).key === normalizeName(candidate.city).key;
    reasons.city = match ? 'match' : 'conflict';
    if (match) {
      score += 0.1;
    } else {
      // «ЖК Астана» в Астане и «ЖК Астана» в Шымкенте — разные объекты.
      cityConflict = true;
      score -= 0.2;
    }
  } else {
    // Город неизвестен хотя бы у одного — сливать вслепую нельзя.
    reasons.city = 'unknown';
    cityConflict = true;
  }

  if (candidate.shared_participants > 0) {
    reasons.shared_participants = candidate.shared_participants;
    score += SHARED_PARTICIPANT_BONUS;
  }

  return { candidate, score: Math.max(0, Math.min(1, score)), reasons, cityConflict };
};

const enqueueMerge = async (
  exec: DbExecutor,
  sourceId: number,
  targetId: number,
  scored: IScoredProject,
  documentId: number | null,
): Promise<void> => {
  await exec.query(
    `INSERT INTO merge_queue
       (entity_kind, source_entity_id, target_entity_id, score, reasons, sample_document_id, status)
     VALUES ('project', $1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
     DO NOTHING`,
    [sourceId, targetId, scored.score, JSON.stringify(scored.reasons), documentId],
  );
};

export const resolveProject = async (
  exec: DbExecutor,
  input: IResolveProjectInput,
): Promise<IResolveProjectResult | null> => {
  const normalized = normalizeName(input.surface, 'project');
  if (isJunkName(normalized)) return null;

  const byAlias = await exec.query<{ entity_id: number }>(
    `SELECT entity_id FROM entity_aliases
     WHERE entity_kind = 'project' AND alias_norm = $1
     LIMIT 1`,
    [normalized.norm],
  );
  const aliasId = byAlias.rows[0]?.entity_id;
  if (aliasId !== undefined) {
    const live = await followTombstone(exec, aliasId);
    await addAlias(exec, live, input.surface, normalized);
    return { projectId: live, method: 'alias', confidence: 0.98, queued: false };
  }

  // Точное совпадение ключа принимаем только при согласии по городу: иначе
  // одноимённые ЖК из разных городов схлопнутся молча.
  const byKey = await exec.query<{ id: number; city: string | null }>(
    'SELECT id, city FROM projects WHERE name_key = $1 AND merged_into_id IS NULL LIMIT 1',
    [normalized.key],
  );
  const keyRow = byKey.rows[0];
  if (keyRow) {
    const citiesAgree =
      !input.city ||
      !keyRow.city ||
      normalizeName(input.city).key === normalizeName(keyRow.city).key;
    if (citiesAgree) {
      await addAlias(exec, keyRow.id, input.surface, normalized);
      return { projectId: keyRow.id, method: 'key', confidence: 0.95, queued: false };
    }
  }

  const candidates = await fetchCandidates(exec, normalized, input.relatedCompanyIds ?? []);
  const scored = candidates
    .filter(c => c.s_latin >= MIN_LATIN_SIMILARITY)
    .map(c => scoreCandidate(c, input))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best && !best.cityConflict && best.score >= PROJECT_AUTO_MERGE_SCORE) {
    await addAlias(exec, best.candidate.id, input.surface, normalized);
    return {
      projectId: best.candidate.id,
      method: 'auto_merge',
      confidence: best.score,
      queued: false,
    };
  }

  const newId = await createProject(exec, input, normalized);

  if (!best || best.score < PROJECT_QUEUE_SCORE) {
    return { projectId: newId, method: 'created', confidence: 1, queued: false };
  }

  await enqueueMerge(exec, newId, best.candidate.id, best, input.documentId ?? null);
  return { projectId: newId, method: 'created_queued', confidence: best.score, queued: true };
};
