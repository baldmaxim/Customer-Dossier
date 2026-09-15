// Статистика подрядчиков и генподрядчиков: второй экран MVP.
//
// С этапа 07 список читает снимок объяснимых сигналов (миграция 018), а не company_risk:
// нет итоговой оценки и сортировки по индексу риска. Числа — те же, что в карточке, с тем же срезом.

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { query } from '../db/pool.js';
import { refreshState } from '../signals/refresh.js';

export const contractorsRouter = asyncRouter();

/**
 * Булев параметр строки запроса. z.coerce.boolean() превращал любую непустую
 * строку — в том числе "false" — в true, и фильтр не работал никогда.
 */
export const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform(value => value === 'true' || value === '1');

export const listSchema = z.object({
  role: z.enum(['general_contractor', 'contractor', 'subcontractor', 'customer', 'any']).default('any'),
  /** Компании без публикаций по умолчанию скрыты: о них в выборке ничего нет. */
  includeInsufficient: queryBoolean,
  // Сортировка — только по объёму опыта или имени: новостная активность не размер и не надёжность.
  sort: z.enum(['projects', 'name']).default('projects'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

contractorsRouter.get('/', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const { role, includeInsufficient, sort, limit } = parsed.data;
  const state = await refreshState();
  if (!state.active) {
    res.json({ status: 'not_computed', refresh: state, items: [] });
    return;
  }
  const orderBy = sort === 'name' ? 'c.name, s.company_id' : 'coalesce(s.projects, 0) DESC, c.name, s.company_id';

  const items = await query(
    `SELECT s.company_id AS "companyId", c.name, c.city,
            s.identity_status AS "identityStatus", s.projects, s.roles,
            s.events_dated_12m AS "eventsDated12m", s.events_undated AS "eventsUndated",
            s.publications, s.families,
            s.payload->'experience'->'byRole' AS "byRole",
            s.payload->'media'->'courtRoles' AS "courtRoles"
     FROM company_signal_snapshots s
     JOIN companies c ON c.id = s.company_id AND c.merged_into_id IS NULL
     WHERE s.refresh_id = $1
       AND ($2::boolean OR s.publications IS NOT NULL)
       AND ($3::text IS NULL OR $3::text = ANY(s.roles))
     ORDER BY ${orderBy}
     LIMIT $4`,
    [state.active.id, includeInsufficient, role === 'any' ? null : role, limit],
  );
  res.json({ status: 'ok', refresh: state, items });
});

/** Сводка по базе для главной: объём и статус идентификации — без распределения «по риску». */
contractorsRouter.get('/summary', async (_req, res) => {
  const state = await refreshState();
  const byIdentity = state.active
    ? await query<{ identityStatus: string; n: number }>(
        `SELECT identity_status AS "identityStatus", count(*)::int AS n
         FROM company_signal_snapshots WHERE refresh_id = $1 GROUP BY identity_status ORDER BY identity_status`,
        [state.active.id],
      )
    : [];

  const totals = await query<{
    companies: number;
    projects: number;
    documents: number;
    pendingMerges: number;
    lonelyCompanies: number;
  }>(
    `SELECT
       (SELECT count(*) FROM companies WHERE merged_into_id IS NULL)::int AS companies,
       (SELECT count(*) FROM projects  WHERE merged_into_id IS NULL)::int AS projects,
       (SELECT count(*) FROM raw_documents WHERE status = 'extracted')::int AS documents,
       (SELECT count(*) FROM merge_queue WHERE status = 'pending')::int AS "pendingMerges",
       -- Доля компаний ровно с одним упоминанием — индикатор непойманных дублей.
       (SELECT count(*) FROM (
          SELECT entity_id FROM mentions WHERE entity_kind = 'company'
          GROUP BY entity_id HAVING count(*) = 1
        ) t)::int AS "lonelyCompanies"`,
  );

  res.json({ byIdentity, refresh: state, totals: totals[0] ?? null });
});
