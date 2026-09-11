// Контроль качества канона: аудит, пересчёт нормализации, переразбор.
//
// Появилось после ручного аудита живой базы, который нашёл две проблемы:
//
//  1. Скрытые дубли. «ГК Консоль» и «Консоль» жили двумя карточками. Причина —
//     не резолвер, а устаревшая нормализация: первое название записали до того,
//     как «ГК» попало в список организационных форм, и его ключ остался
//     `gkkonsol`, тогда как новое даёт `konsol`. Нормализация при записи
//     разошлась с нормализацией при поиске.
//
//  2. Путаница ролей. Роль часто означала «кого упомянула пресс-служба», а не
//     роль на стройке: аналитики записывались проектировщиками, районы и корпуса
//     — генподрядчиками и заказчиками.

import { env } from '../config/env.js';
import { getPool, query, withTransaction } from '../db/pool.js';
import { normalizeName, type EntityKindForNormalize } from '../resolve/normalize.js';

// --- Переразбор ----------------------------------------------------------

/**
 * Вернуть в очередь документы, которые текущая модель при текущем промпте
 * ещё не оценивала — и разобранные, и отброшенные.
 *
 * Нужно после смены промпта: исправленные роли попадут в карточки только при
 * переразборе, а apply теперь сначала убирает прежний вклад документа.
 * Переразбирать стоит всё, а не выборочно: роль на объекте удаляется вместе
 * с документом, который её создал, и при частичном переразборе может пропасть
 * до переразбора другого документа, который её подтверждал.
 */
export const requeueForReextraction = async (sourceKey: string | null): Promise<number> => {
  const res = await getPool().query(
    `UPDATE raw_documents d
     SET status = 'queued', attempts = 0, updated_at = now()
     WHERE d.status IN ('extracted', 'skipped')
       AND ($3::text IS NULL OR d.source_id IN (SELECT id FROM sources WHERE key = $3::text))
       AND NOT EXISTS (
         SELECT 1 FROM extractions e
         WHERE e.document_id = d.id
           AND e.model = $1
           AND e.prompt_version = $2
           AND e.status = 'ok'
       )`,
    [env.LMSTUDIO_MODEL, env.PROMPT_VERSION, sourceKey],
  );
  return res.rowCount ?? 0;
};

// --- Пересчёт нормализации -----------------------------------------------

export interface IRenormalizeResult {
  companiesChanged: number;
  projectsChanged: number;
  aliasesChanged: number;
  aliasesMerged: number;
  /** Пары, у которых после пересчёта совпал ключ. Отправлены в очередь, не слиты. */
  duplicatePairs: Array<{ a: string; b: string }>;
}

/**
 * Пересчитать ключи поиска всех сущностей текущей версией normalizeName.
 *
 * Правка normalize.ts не трогает уже записанные строки: name_norm и name_latin
 * вычисляются один раз при вставке. После любой правки нормализатора (новая
 * организационная форма, синоним, транслитерация) старые и новые записи
 * перестают сравниваться, и резолвер молча плодит дубли.
 *
 * Отображаемое имя (name) не меняется — это подпись для человека, «ГК Консоль»
 * информативнее «Консоль». Меняются только ключи.
 *
 * Совпавшие после пересчёта пары уходят в очередь слияний, а не сливаются:
 * асимметрия прежняя — ошибочное слияние не разлить.
 */
export const renormalizeEntities = async (dryRun: boolean): Promise<IRenormalizeResult> => {
  const result: IRenormalizeResult = {
    companiesChanged: 0,
    projectsChanged: 0,
    aliasesChanged: 0,
    aliasesMerged: 0,
    duplicatePairs: [],
  };

  await withTransaction(async client => {
    for (const kind of ['company', 'project'] as const) {
      const rows = await client.query<{
        id: number;
        name: string;
        name_norm: string;
        name_latin: string;
        legal_form?: string | null;
      }>(
        kind === 'company'
          ? `SELECT id, name, name_norm, name_latin, legal_form FROM companies WHERE merged_into_id IS NULL`
          : `SELECT id, name, name_norm, name_latin FROM projects WHERE merged_into_id IS NULL`,
      );

      for (const row of rows.rows) {
        const next = normalizeName(row.name, kind);
        if (next.norm === row.name_norm && next.latin === row.name_latin) continue;

        if (kind === 'company') result.companiesChanged += 1;
        else result.projectsChanged += 1;

        if (dryRun) continue;
        if (kind === 'company') {
          await client.query(
            `UPDATE companies
             SET name_norm = $2, name_latin = $3,
                 legal_form = coalesce(legal_form, $4), updated_at = now()
             WHERE id = $1`,
            [row.id, next.norm, next.latin, next.legalForm],
          );
        } else {
          await client.query(
            `UPDATE projects SET name_norm = $2, name_latin = $3, updated_at = now() WHERE id = $1`,
            [row.id, next.norm, next.latin],
          );
        }
      }
    }

    await renormalizeAliases(client, dryRun, result);

    // Совпавшие ключи ищем уже после пересчёта. В режиме предпросмотра строки
    // не изменены, поэтому пересчитываем ключи здесь же, в памяти.
    const live = await client.query<{ id: number; name: string; name_key: string }>(
      `SELECT id, name, name_key FROM companies WHERE merged_into_id IS NULL ORDER BY id`,
    );
    const byKey = new Map<string, Array<{ id: number; name: string }>>();
    for (const row of live.rows) {
      const key = dryRun ? normalizeName(row.name, 'company').key : row.name_key;
      if (key.length < 3) continue;
      const group = byKey.get(key) ?? [];
      group.push({ id: row.id, name: row.name });
      byKey.set(key, group);
    }

    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const [first, ...rest] = group as [{ id: number; name: string }, ...{ id: number; name: string }[]];
      for (const other of rest) {
        result.duplicatePairs.push({ a: first.name, b: other.name });
        if (dryRun) continue;
        await client.query(
          `INSERT INTO merge_queue
             (entity_kind, source_entity_id, target_entity_id, score, reasons, status)
           VALUES ('company', $1, $2, 0.95, $3, 'pending')
           ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id),
                        greatest(source_entity_id, target_entity_id))
           DO NOTHING`,
          [other.id, first.id, JSON.stringify({ key: 'exact_after_renormalize' })],
        );
      }
    }

    // Предпросмотр не должен ничего записать даже случайно.
    if (dryRun) throw new DryRunRollback();
  }).catch(err => {
    if (!(err instanceof DryRunRollback)) throw err;
  });

  return result;
};

/** Маркер отката транзакции предпросмотра. */
class DryRunRollback extends Error {}

/**
 * Алиасы пересчитываются отдельно: у таблицы уникальный индекс
 * (entity_kind, entity_id, alias_norm), и два алиаса одной сущности могут
 * после пересчёта совпасть. Такие склеиваем со сложением счётчиков, иначе
 * UPDATE упрётся в уникальность на середине пересчёта.
 */
const renormalizeAliases = async (
  client: import('pg').PoolClient,
  dryRun: boolean,
  result: IRenormalizeResult,
): Promise<void> => {
  const aliases = await client.query<{
    id: number;
    entity_kind: EntityKindForNormalize;
    entity_id: number;
    alias: string;
    alias_norm: string;
    alias_latin: string;
    hits: number;
  }>(
    `SELECT id, entity_kind, entity_id, alias, alias_norm, alias_latin, hits
     FROM entity_aliases ORDER BY id`,
  );

  const groups = new Map<string, Array<(typeof aliases.rows)[number] & { norm: string; latin: string }>>();
  for (const row of aliases.rows) {
    const next = normalizeName(row.alias, row.entity_kind);
    const key = `${row.entity_kind}|${row.entity_id}|${next.norm}`;
    const group = groups.get(key) ?? [];
    group.push({ ...row, norm: next.norm, latin: next.latin });
    groups.set(key, group);
  }

  const toDelete: number[] = [];
  const toUpdate: Array<{ id: number; norm: string; latin: string; hits: number }> = [];

  for (const group of groups.values()) {
    const [keep, ...duplicates] = group as [(typeof group)[number], ...(typeof group)[number][]];
    const totalHits = group.reduce((sum, a) => sum + a.hits, 0);
    const changed = keep.norm !== keep.alias_norm || keep.latin !== keep.alias_latin;

    if (changed) result.aliasesChanged += 1;
    result.aliasesMerged += duplicates.length;

    toDelete.push(...duplicates.map(d => d.id));
    if (changed || duplicates.length > 0) {
      toUpdate.push({ id: keep.id, norm: keep.norm, latin: keep.latin, hits: totalHits });
    }
  }

  if (dryRun) return;

  // Порядок из трёх шагов не случаен. Уникальный индекс — на
  // (entity_kind, entity_id, alias_norm). Если у одной сущности алиас A меняет
  // ключ НА прежний ключ алиаса B, а B свой ключ меняет С него, прямое
  // обновление A упрётся в ещё не обновлённый B, и откатится весь пересчёт.
  // Поэтому: убрать дубли, увести ключи во временные значения, затем
  // проставить итоговые. Временный ключ уникален, потому что содержит id.
  if (toDelete.length > 0) {
    await client.query('DELETE FROM entity_aliases WHERE id = ANY($1::bigint[])', [toDelete]);
  }

  if (toUpdate.length === 0) return;
  const ids = toUpdate.map(u => u.id);

  await client.query(
    `UPDATE entity_aliases SET alias_norm = '~renorm~' || id::text WHERE id = ANY($1::bigint[])`,
    [ids],
  );

  for (const u of toUpdate) {
    await client.query(
      `UPDATE entity_aliases SET alias_norm = $2, alias_latin = $3, hits = $4 WHERE id = $1`,
      [u.id, u.norm, u.latin, u.hits],
    );
  }
};

// --- Аудит ---------------------------------------------------------------

export interface IAuditResult {
  /** Похожие компании, не разобранные в очереди слияний. */
  similarPairs: Array<{ a: string; b: string; score: number; sameKey: boolean }>;
  /** Сколько упоминаний с каждой ролью. */
  roleCounts: Array<{ role: string; mentions: number; companies: number }>;
  /** Компании, чьё название совпадает с объектом — вероятно, объект записан компанией. */
  companiesNamedLikeProjects: Array<{ company: string; project: string }>;
  /** Выборка «компания — роль — цитата» для проверки глазами. */
  roleSample: Array<{ company: string; role: string; quote: string; documentId: number }>;
}

export const runAudit = async (sampleSize: number): Promise<IAuditResult> => {
  const similarPairs = await withTransaction(async client => {
    await client.query('SET LOCAL pg_trgm.similarity_threshold = 0.55');
    const res = await client.query<{ a: string; b: string; score: number; same_key: boolean }>(
      `SELECT a.name AS a, b.name AS b,
              similarity(a.name_latin, b.name_latin) AS score,
              a.name_key = b.name_key               AS same_key
       FROM companies a
       JOIN companies b
         ON a.id < b.id
        AND b.merged_into_id IS NULL
        AND (a.name_latin % b.name_latin OR a.name_key = b.name_key)
       WHERE a.merged_into_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM merge_queue q
           WHERE q.entity_kind = 'company'
             AND least(q.source_entity_id, q.target_entity_id) = a.id
             AND greatest(q.source_entity_id, q.target_entity_id) = b.id
         )
       ORDER BY score DESC
       LIMIT 50`,
    );
    return res.rows.map(r => ({ a: r.a, b: r.b, score: Number(r.score), sameKey: r.same_key }));
  });

  const roleCounts = await query<{ role: string; mentions: number; companies: number }>(
    `SELECT coalesce(role, '— без роли') AS role,
            count(*)::int                  AS mentions,
            count(DISTINCT entity_id)::int AS companies
     FROM mentions
     WHERE entity_kind = 'company'
     GROUP BY role
     ORDER BY mentions DESC`,
  );

  // Объект, записанный компанией, ловится прямо в базе: у компании тот же
  // ключ названия, что у существующего объекта.
  const companiesNamedLikeProjects = await query<{ company: string; project: string }>(
    `SELECT c.name AS company, p.name AS project
     FROM companies c
     JOIN projects p ON p.name_key = c.name_key AND p.merged_into_id IS NULL
     WHERE c.merged_into_id IS NULL
     ORDER BY c.name`,
  );

  const roleSample = await query<{
    company: string;
    role: string;
    quote: string;
    documentId: number;
  }>(
    `SELECT c.name AS company, m.role, m.quote, m.document_id AS "documentId"
     FROM mentions m
     JOIN companies c ON c.id = m.entity_id
     WHERE m.entity_kind = 'company' AND m.role IS NOT NULL
     ORDER BY random()
     LIMIT $1`,
    [sampleSize],
  );

  return { similarPairs, roleCounts, companiesNamedLikeProjects, roleSample };
};
