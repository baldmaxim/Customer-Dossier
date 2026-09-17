// Резолвинг объектов (ЖК, БЦ, микрорайоны).
//
// Отличия от компаний:
//  1. Имена объектов гораздо более омонимичны: «ЖК Астана» есть в трёх городах.
//     Поэтому порог автослияния выше — 0.94.
//  2. Город работает не как бонус, а как запрет: если города известны и разные,
//     автослияние запрещено, максимум очередь. Неизвестный город не равен совпавшему.
//  3. Общий участник — только пояснение для оператора, а не довод идентичности (этап 04).
//  4. Иерархия (этап 04): комплекс → очередь → корпус. Корпуса одного ЖК — разные записи
//     со ссылкой на родителя, одноимённые очереди разных ЖК не склеиваются.

import type { DbExecutor } from '../db/pool.js';
import { analystMapping } from './ambiguities.js';
import { recordAmbiguity } from './company.js';
import { parseProjectPath, type ProjectLevel } from './hierarchy.js';
import { NORMALIZER_VERSION, normalizeName, isJunkName, type INormalizedName } from './normalize.js';

const TRGM_THRESHOLD = 0.35;
const MIN_LATIN_SIMILARITY = 0.45;

export const PROJECT_AUTO_MERGE_SCORE = 0.94;
export const PROJECT_QUEUE_SCORE = 0.78;

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
  /** Редакция-основание: источник географии и якорь неоднозначности. */
  revisionId?: number | null;
}

export interface IResolveProjectResult {
  projectId: number;
  method: 'alias' | 'key' | 'auto_merge' | 'created' | 'created_queued' | 'analyst_mapping';
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

/** География ставится только из текста публикации — не из профиля канала или прописки компании. */
const geoSource = (input: IResolveProjectInput): { source: 'text' | null; revisionId: number | null } =>
  input.city || input.address ? { source: 'text', revisionId: input.revisionId ?? null } : { source: null, revisionId: null };

const createProject = async (
  exec: DbExecutor,
  input: IResolveProjectInput,
  normalized: INormalizedName,
): Promise<number> => {
  const geo = geoSource(input);
  const res = await exec.query<{ id: number }>(
    `INSERT INTO projects (name, name_norm, name_latin, kind, stage, city, address, geo_source, geo_revision_id, normalizer_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      normalized.display,
      normalized.norm,
      normalized.latin,
      input.kind ?? 'other',
      input.stage ?? 'unknown',
      input.city ?? null,
      input.address ?? null,
      geo.source,
      geo.revisionId,
      NORMALIZER_VERSION,
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
       WHERE p.merged_into_id IS NULL AND p.project_level = 'complex' AND p.name_latin % $1
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
     JOIN projects p ON p.id = cand.id AND p.merged_into_id IS NULL AND p.project_level = 'complex'
     GROUP BY p.id, p.name, p.city
     ORDER BY max(cand.s_latin) DESC
     LIMIT 25`,
    [normalized.latin, normalized.norm, [...relatedCompanyIds]],
  );
  return res.rows;
};

interface IScoredProject {
  score: number;
  reasons: Record<string, unknown>;
  /** Города известны и разные или неизвестны: автослияние запрещено. */
  cityConflict: boolean;
  candidate: IProjectCandidate;
}

export const scoreProjectCandidate = (
  candidate: IProjectCandidate,
  input: Pick<IResolveProjectInput, 'city'>,
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

  // Общий участник — пояснение для оператора, а не доказательство идентичности: в балл не входит.
  if (candidate.shared_participants > 0) reasons.shared_participants = candidate.shared_participants;

  return { candidate, score: Math.max(0, Math.min(1, score)), reasons, cityConflict };
};

/** Город известен у обоих и совпадает по ключу нормализации. */
export const citiesKnownAndEqual = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  const keyA = normalizeName(a).key;
  const keyB = normalizeName(b).key;
  return keyA.length > 0 && keyA === keyB;
};

const enqueueMerge = async (
  exec: DbExecutor,
  sourceId: number,
  targetId: number,
  scored: Pick<IScoredProject, 'score' | 'reasons'>,
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

export type ProjectExactDecision =
  | { kind: 'reuse'; id: number }
  | { kind: 'create'; queueWith: number[] }
  | { kind: 'ambiguous'; candidateIds: number[] };

/**
 * Решение по точным совпадениям имени комплекса. Чистая функция — ради тестов.
 *  - город известен: ровно один кандидат с тем же известным городом — он; несколько — неоднозначность;
 *    нет — новый объект и пары с кандидатами без города (город в чужой объект не подставляется);
 *  - город неизвестен: ровно один кандидат тоже без города — он (стабильная provisional-запись,
 *    а не новый дубль на каждый повтор); несколько — неоднозначность; только с известным городом —
 *    новый объект и пары: неизвестный город не равен совпавшему.
 */
export const decideProjectExact = (
  candidates: ReadonlyArray<{ id: number; city: string | null }>,
  city: string | null | undefined,
): ProjectExactDecision => {
  if (city) {
    const equal = candidates.filter(c => citiesKnownAndEqual(city, c.city));
    if (equal.length === 1) return { kind: 'reuse', id: equal[0]!.id };
    if (equal.length > 1) return { kind: 'ambiguous', candidateIds: equal.map(c => c.id) };
    return { kind: 'create', queueWith: candidates.filter(c => !c.city).map(c => c.id) };
  }
  const unknown = candidates.filter(c => !c.city);
  if (unknown.length === 1) return { kind: 'reuse', id: unknown[0]!.id };
  if (unknown.length > 1) return { kind: 'ambiguous', candidateIds: unknown.map(c => c.id) };
  return { kind: 'create', queueWith: candidates.map(c => c.id) };
};

const resolveComplex = async (
  exec: DbExecutor,
  input: IResolveProjectInput,
  normalized: INormalizedName,
): Promise<IResolveProjectResult | null> => {
  for (const step of ['alias', 'key'] as const) {
    const ids =
      step === 'alias'
        ? (
            await exec.query<{ entity_id: number }>(
              `SELECT DISTINCT entity_id FROM entity_aliases
               WHERE entity_kind = 'project' AND alias_norm = $1`,
              [normalized.norm],
            )
          ).rows.map(r => r.entity_id)
        : (
            await exec.query<{ id: number }>(
              `SELECT id FROM projects WHERE name_key = $1 AND merged_into_id IS NULL AND project_level = 'complex'`,
              [normalized.key],
            )
          ).rows.map(r => r.id);
    if (ids.length === 0) continue;

    const live = [...new Set(await Promise.all(ids.map(id => followTombstone(exec, id))))];
    const rows = (
      await exec.query<{ id: number; city: string | null }>(
        `SELECT id, city FROM projects
         WHERE id = ANY($1::bigint[]) AND merged_into_id IS NULL AND project_level = 'complex' ORDER BY id`,
        [live],
      )
    ).rows;
    if (rows.length === 0) continue;

    const decision = decideProjectExact(rows, input.city);
    if (decision.kind === 'reuse') {
      await addAlias(exec, decision.id, input.surface, normalized);
      return step === 'alias'
        ? { projectId: decision.id, method: 'alias', confidence: 0.98, queued: false }
        : { projectId: decision.id, method: 'key', confidence: 0.95, queued: false };
    }
    if (decision.kind === 'ambiguous') {
      const mapped = await analystMapping(exec, 'project', normalized.key, input.revisionId ?? null, decision.candidateIds);
      if (mapped !== null) return { projectId: mapped, method: 'analyst_mapping', confidence: 0.95, queued: false };
      await recordAmbiguity(exec, {
        kind: 'project',
        surface: input.surface,
        nameKey: normalized.key,
        candidateIds: decision.candidateIds,
        revisionId: input.revisionId ?? null,
      });
      return null;
    }
    const newId = await createProject(exec, input, normalized);
    for (const id of decision.queueWith) {
      await enqueueMerge(exec, newId, id, { score: 0.9, reasons: { exact_name: step, city: 'unknown' } }, input.documentId ?? null);
    }
    const queued = decision.queueWith.length > 0;
    return { projectId: newId, method: queued ? 'created_queued' : 'created', confidence: 1, queued };
  }

  const candidates = await fetchCandidates(exec, normalized, input.relatedCompanyIds ?? []);
  const scored = candidates
    .filter(c => c.s_latin >= MIN_LATIN_SIMILARITY)
    .map(c => scoreProjectCandidate(c, input))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best && !best.cityConflict && best.score >= PROJECT_AUTO_MERGE_SCORE) {
    await addAlias(exec, best.candidate.id, input.surface, normalized);
    return { projectId: best.candidate.id, method: 'auto_merge', confidence: best.score, queued: false };
  }

  const newId = await createProject(exec, input, normalized);

  if (!best || best.score < PROJECT_QUEUE_SCORE) {
    return { projectId: newId, method: 'created', confidence: 1, queued: false };
  }

  await enqueueMerge(exec, newId, best.candidate.id, best, input.documentId ?? null);
  return { projectId: newId, method: 'created_queued', confidence: best.score, queued: true };
};

const LEVEL_TITLES: Record<Exclude<ProjectLevel, 'complex'>, string> = { phase: 'очередь', building: 'корпус' };

const findChild = async (
  exec: DbExecutor,
  parentId: number,
  level: Exclude<ProjectLevel, 'complex'>,
  label: string,
): Promise<number | null> =>
  (
    await exec.query<{ id: number }>(
      `SELECT id FROM projects
       WHERE parent_project_id = $1 AND project_level = $2 AND level_label = $3 AND merged_into_id IS NULL`,
      [parentId, level, label],
    )
  ).rows[0]?.id ?? null;

/** Очередь или корпус внутри родителя: идентичность — (родитель, уровень, обозначение). */
const resolveChild = async (
  exec: DbExecutor,
  parentId: number,
  level: Exclude<ProjectLevel, 'complex'>,
  label: string,
  input: IResolveProjectInput,
): Promise<number> => {
  const existing = await findChild(exec, parentId, level, label);
  if (existing !== null) return existing;

  const parent = (await exec.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [parentId])).rows[0];
  const name = `${parent?.name ?? ''}, ${LEVEL_TITLES[level]} ${label}`;
  const normalized = normalizeName(name, 'project');
  const geo = geoSource(input);
  const inserted = (
    await exec.query<{ id: number }>(
      `INSERT INTO projects (name, name_norm, name_latin, kind, stage, city, address, project_level, parent_project_id,
                             level_label, geo_source, geo_revision_id, normalizer_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (parent_project_id, project_level, level_label) WHERE parent_project_id IS NOT NULL AND merged_into_id IS NULL
       DO NOTHING
       RETURNING id`,
      [
        name,
        normalized.norm,
        normalized.latin,
        input.kind ?? 'other',
        input.stage ?? 'unknown',
        input.city ?? null,
        input.address ?? null,
        level,
        parentId,
        label,
        geo.source,
        geo.revisionId,
        NORMALIZER_VERSION,
      ],
    )
  ).rows[0];
  if (inserted) return inserted.id;
  // Параллельная вставка того же корпуса: берём её.
  const raced = await findChild(exec, parentId, level, label);
  if (raced === null) throw new Error(`Не удалось создать ${LEVEL_TITLES[level]} ${label}`);
  return raced;
};

/**
 * Резолвинг объекта с иерархией: «ЖК Берег, корпус 3» → комплекс «ЖК Берег» → корпус «3».
 * Возвращается самый глубокий уровень. null — мусорное имя или неоднозначность комплекса.
 */
export const resolveProject = async (
  exec: DbExecutor,
  input: IResolveProjectInput,
): Promise<IResolveProjectResult | null> => {
  const path = parseProjectPath(input.surface);
  const normalized = normalizeName(path.complex, 'project');
  if (isJunkName(normalized)) return null;

  const complex = await resolveComplex(exec, { ...input, surface: path.complex }, normalized);
  if (!complex) return null;

  let projectId = complex.projectId;
  if (path.phase) projectId = await resolveChild(exec, projectId, 'phase', path.phase, input);
  if (path.building) projectId = await resolveChild(exec, projectId, 'building', path.building, input);
  return { ...complex, projectId };
};
