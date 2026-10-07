// Итоги карточки компании — по тем же наборам, что её списки (07.10.2026, «одно сведение — один источник»).
//
// Раньше плитки, полосы «Роли, события и тексты» и ряды по месяцам брали снимок показателей (signals, на дату расчёта,
// пересчёт вручную), а вкладки — живые списки: плитка «Публикации» считала и снимки реестра ДОМ.РФ, плитка «События» —
// события, где компания контрагент, и числа на одной вкладке расходились. Теперь итог публикаций — набор ленты
// (companies/counters.ts::touchedCte, семья компании), итог событий — набор списка событий (card_events_v, компания —
// сторона события). Правила подписаны в ответе словами, оценки нет (ADR-009): числа — что известно, а не «хорошо ли».

import { touchedCte } from '../companies/counters.js';
import { query } from '../db/pool.js';
import { originFamilies } from '../signals/rules.js';
import { monthlySeries } from '../signals/series.js';
import type { IMonthlySeries, ISignalPublication } from '../signals/types.js';
import { companyFamilyIds } from './companyPublications.js';

const DAY = 86_400_000;

export interface IPublicationStats {
  /** Публикаций в ленте компании (с семьёй) — то же число, что каталог и поиск. */
  total: number;
  /** Без даты публикации — ни в какое окно не входят. */
  undated: number;
  /** С датой публикации за последние 90 дней. */
  last90: number;
  /** Последняя: дата поста, без неё — момент наблюдения (как порядок ленты и каталог). */
  latestAt: string | null;
  sources: number;
  /** Полнота текста последней редакции — по происхождению, а не по длине. */
  completeness: Record<string, number>;
  /** Разные тексты (перепечатки одного текста — одна семья) и происхождение семьи (signals/rules.ts::originFamilies). */
  families: { total: number; established: number; named: number; unknown: number };
  /** Публикации по месяцам за 24 месяца (по дате публикации, месяц UTC). */
  byMonth: IMonthlySeries;
}

const PUBLICATIONS_SQL = `
  WITH ${touchedCte('$1::bigint[]')},
  items AS (SELECT DISTINCT item_id FROM touched)
  SELECT si.id AS "sourceItemId", s.key AS "sourceKey", si.source_id AS "sourceId",
         to_char(si.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt",
         coalesce(si.published_at, si.first_observed_at) AS "sortAt",
         coalesce(lr.completeness::text, 'unknown') AS completeness, coalesce(encode(lr.dedup_hash, 'hex'), 'item:' || si.id) AS "dedupHash",
         (SELECT o.forward_origin FROM source_observations o
           WHERE o.source_item_id = si.id AND o.forward_origin IS NOT NULL ORDER BY o.id LIMIT 1) AS "forwardOrigin"
  FROM items t
  JOIN source_items si ON si.id = t.item_id
  JOIN sources s ON s.id = si.source_id
  LEFT JOIN document_revisions lr ON lr.id = si.latest_revision_id`;

export const loadPublicationStats = async (companyId: number, now: Date = new Date()): Promise<IPublicationStats> => {
  const rows = await query<{
    sourceItemId: number;
    sourceKey: string;
    sourceId: number;
    publishedAt: string | null;
    sortAt: Date;
    completeness: string;
    dedupHash: string;
    forwardOrigin: string | null;
  }>(PUBLICATIONS_SQL, [await companyFamilyIds(companyId)]);
  const from90 = new Date(now.getTime() - 90 * DAY).toISOString();
  const completeness: Record<string, number> = {};
  for (const r of rows) completeness[r.completeness] = (completeness[r.completeness] ?? 0) + 1;
  const families = originFamilies(
    rows.map((r): ISignalPublication => ({ sourceItemId: r.sourceItemId, sourceKey: r.sourceKey, publishedAt: r.publishedAt, completeness: r.completeness, dedupHash: r.dedupHash, forwardOrigin: r.forwardOrigin, observations: 1 })),
  );
  const latest = rows.reduce<Date | null>((max, r) => (max === null || r.sortAt > max ? r.sortAt : max), null);
  return {
    total: rows.length,
    undated: rows.filter(r => !r.publishedAt).length,
    last90: rows.filter(r => r.publishedAt && r.publishedAt >= from90 && r.publishedAt <= now.toISOString()).length,
    latestAt: latest?.toISOString() ?? null,
    sources: new Set(rows.map(r => r.sourceId)).size,
    completeness,
    families: {
      total: families.length,
      established: families.filter(f => f.origin === 'established').length,
      named: families.filter(f => f.origin === 'named').length,
      unknown: families.filter(f => f.origin === 'unknown').length,
    },
    byMonth: monthlySeries(
      rows.map(r => ({ id: r.sourceItemId, date: r.publishedAt })),
      now,
      'публикации ленты компании по месяцу даты публикации (UTC); без даты — не в ряду',
      'publication_date',
    ),
  };
};

export interface IEventStats {
  /** Событий в списке «Подробно → События» — то же число. */
  total: number;
  /** С датой события за последние 12 месяцев. */
  dated12m: number;
  undated: number;
  /** По видам, больше — раньше. */
  byType: Array<{ type: string; count: number }>;
  /** По месяцам даты события за 24 месяца; дата до квартала или года — не в месяцах. */
  byMonth: IMonthlySeries;
}

/** Набор списка событий (тот же WHERE, что GET /companies/:id/events) с точностью даты утверждения. */
const EVENTS_SQL = `
  SELECT e.id, e.type, e.occurred_on::text AS "occurredOn", a.period_precision AS precision
  FROM card_events_v e
  LEFT JOIN assertions a ON e.origin = 'published' AND a.id = -e.id
  WHERE e.company_id = $1 AND e.status <> 'rejected'`;

const COARSE = new Set(['quarter', 'year']);

export const loadEventStats = async (companyId: number, now: Date = new Date()): Promise<IEventStats> => {
  const rows = await query<{ id: number; type: string; occurredOn: string | null; precision: string | null }>(EVENTS_SQL, [companyId]);
  const today = now.toISOString().slice(0, 10);
  const from12 = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  return {
    total: rows.length,
    dated12m: rows.filter(r => r.occurredOn && r.occurredOn >= from12 && r.occurredOn <= today).length,
    undated: rows.filter(r => !r.occurredOn).length,
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    byMonth: monthlySeries(
      rows.map(r => ({ id: r.id, date: r.occurredOn, coarse: r.precision !== null && COARSE.has(r.precision) })),
      now,
      'события списка компании по месяцу даты события (UTC); без даты и с датой до квартала или года — не в месяцах',
      'event_date',
    ),
  };
};
