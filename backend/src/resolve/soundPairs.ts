// Пары «возможный дубль» по звучанию названия (06.10.2026). Резолвер не ставил в очередь «Сминекс»,
// «Смайнекс» и «Sminex»: у имён в разных алфавитах триграммы norm не совпадают, и балл не дотягивает до
// серой зоны (0.75). Этот проход находит живые компании с общим звуковым ключом
// (normalize.ts::soundKeys — полный и без падежного окончания) по названию и всем написаниям и ставит пару в merge_queue — решает модель
// (entity-match), а не ключ. Слияния здесь нет: только очередь; ON CONFLICT — отклонённая пара не всплывает.
//
// Не ставятся: обе стороны с действующим реквизитом (разные юрлица — правило, не вопрос модели), карточки,
// отмеченные «не компания», временное имя «ИНН …», общий ключ больше SOUND_GROUP_MAX компаний.

import { query, queryOne } from '../db/pool.js';
import { isJunkName, normalizeName, soundKeys } from './normalize.js';

/** Серая зона резолвера (QUEUE_SCORE…AUTO_MERGE_SCORE): пара ждёт вердикта и сама не сливается. */
export const SOUND_PAIR_SCORE = 0.8;

/** Больше компаний на один ключ — это общий ключ («Строй-Инвест»), а не одно имя: пары не ставим. */
export const SOUND_GROUP_MAX = 5;

const LEGAL_TYPES = ['inn', 'ogrn', 'ogrnip'];

export interface ISoundName {
  companyId: number;
  /** Название или одно из написаний (алиас) — как записано. */
  name: string;
  /** Есть действующий реквизит с верной контрольной суммой. */
  identified: boolean;
}

export interface ISoundPair {
  /** Новичок — больший id, как у резолвера. */
  sourceId: number;
  targetId: number;
  sound: string;
  sourceName: string;
  targetName: string;
}

export interface ISoundPairsPlan {
  pairs: ISoundPair[];
  /** Ключи, пропущенные как общие: в отчёт CLI. */
  tooCommon: Array<{ sound: string; companies: number }>;
}

/** Чистая часть: названия и написания → пары по одинаковому звуковому ключу. */
export const buildSoundPairs = (names: readonly ISoundName[]): ISoundPairsPlan => {
  const groups = new Map<string, Map<number, ISoundName>>();
  for (const n of names) {
    const normalized = normalizeName(n.name);
    if (isJunkName(normalized)) continue;
    // Полный ключ и ключ без падежного окончания («Сминексом» → и smnksm, и smnks).
    for (const sound of soundKeys(normalized.key)) {
      const group = groups.get(sound) ?? new Map<number, ISoundName>();
      if (!group.has(n.companyId)) group.set(n.companyId, n);
      groups.set(sound, group);
    }
  }

  const pairs = new Map<string, ISoundPair>();
  const tooCommon: ISoundPairsPlan['tooCommon'] = [];
  for (const [sound, group] of groups) {
    if (group.size < 2) continue;
    if (group.size > SOUND_GROUP_MAX) {
      tooCommon.push({ sound, companies: group.size });
      continue;
    }
    const members = [...group.values()].sort((a, b) => a.companyId - b.companyId);
    members.forEach((target, i) => {
      for (const source of members.slice(i + 1)) {
        if (source.identified && target.identified) continue;
        const key = `${target.companyId}:${source.companyId}`;
        if (pairs.has(key)) continue;
        pairs.set(key, { sourceId: source.companyId, targetId: target.companyId, sound, sourceName: source.name, targetName: target.name });
      }
    });
  }
  return {
    pairs: [...pairs.values()].sort((a, b) => a.targetId - b.targetId || a.sourceId - b.sourceId),
    tooCommon: tooCommon.sort((a, b) => b.companies - a.companies),
  };
};

export interface ISoundPairsResult extends ISoundPairsPlan {
  /** Пары, которых ещё нет в очереди ни в каком состоянии. */
  fresh: ISoundPair[];
  inserted: number;
  /** Каталог не менялся с прошлого полного прохода — ничего не читали. */
  skipped: boolean;
}

/** Отпечаток каталога последнего полного прохода: не изменился — проход в тике не нужен. */
let lastSignature: string | null = null;

const catalogSignature = async (): Promise<string> =>
  (
    await queryOne<{ sig: string }>(
      `SELECT concat_ws(':', (SELECT max(id) FROM companies), (SELECT max(id) FROM entity_aliases),
                        (SELECT count(*) FROM companies WHERE merged_into_id IS NULL)) AS sig`,
    )
  )?.sig ?? '';

const loadNames = async (): Promise<ISoundName[]> =>
  query<ISoundName>(
    `SELECT c.id::int AS "companyId", n.name,
            EXISTS (SELECT 1 FROM entity_identifiers i WHERE i.company_id = c.id AND i.status = 'active'
                      AND i.validation_status = 'checksum_valid' AND i.identifier_type = ANY($1::text[])) AS identified
     FROM companies c
     CROSS JOIN LATERAL (
       SELECT c.name WHERE NOT c.name_pending
       UNION
       SELECT a.alias FROM entity_aliases a WHERE a.entity_kind = 'company' AND a.entity_id = c.id
     ) AS n(name)
     WHERE c.merged_into_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM company_dismissals d WHERE d.company_id = c.id AND d.revoked_at IS NULL)`,
    [LEGAL_TYPES],
  );

/** Пары, уже стоящие в очереди в любом состоянии (отклонённая не всплывает снова). */
const knownPairs = async (ids: number[]): Promise<Set<string>> => {
  if (ids.length === 0) return new Set();
  const rows = await query<{ k: string }>(
    `SELECT least(source_entity_id, target_entity_id) || ':' || greatest(source_entity_id, target_entity_id) AS k
     FROM merge_queue
     WHERE entity_kind = 'company' AND (source_entity_id = ANY($1::bigint[]) OR target_entity_id = ANY($1::bigint[]))`,
    [ids],
  );
  return new Set(rows.map(r => r.k));
};

/**
 * Проход: план пар и запись до `limit` новых в merge_queue (pending, score SOUND_PAIR_SCORE,
 * reasons {key: 'sound_key', sound}). dryRun — только план. В тике (`force` = false) каталог без изменений
 * с прошлого полного прохода не перечитывается.
 */
export const enqueueSoundPairs = async (opts: { limit: number; dryRun: boolean; force?: boolean }): Promise<ISoundPairsResult> => {
  const signature = await catalogSignature();
  if (!opts.force && !opts.dryRun && signature === lastSignature) {
    return { pairs: [], tooCommon: [], fresh: [], inserted: 0, skipped: true };
  }

  const plan = buildSoundPairs(await loadNames());
  const ids = [...new Set(plan.pairs.flatMap(p => [p.sourceId, p.targetId]))];
  const known = await knownPairs(ids);
  const fresh = plan.pairs.filter(p => !known.has(`${p.targetId}:${p.sourceId}`));
  if (opts.dryRun) return { ...plan, fresh, inserted: 0, skipped: false };

  const batch = fresh.slice(0, opts.limit);
  const inserted =
    batch.length === 0
      ? []
      : await query<{ id: string }>(
          `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons, status)
           SELECT 'company', p.source_id, p.target_id, $4, jsonb_build_object('key', 'sound_key', 'sound', p.sound), 'pending'
           FROM unnest($1::bigint[], $2::bigint[], $3::text[]) AS p(source_id, target_id, sound)
           ON CONFLICT (entity_kind, least(source_entity_id, target_entity_id), greatest(source_entity_id, target_entity_id))
           DO NOTHING
           RETURNING id`,
          [batch.map(p => p.sourceId), batch.map(p => p.targetId), batch.map(p => p.sound), SOUND_PAIR_SCORE],
        );
  // Отпечаток запоминается только после полного прохода: урезанный лимитом продолжится в следующем тике.
  if (fresh.length <= opts.limit) lastSignature = signature;
  return { ...plan, fresh, inserted: inserted.length, skipped: false };
};
