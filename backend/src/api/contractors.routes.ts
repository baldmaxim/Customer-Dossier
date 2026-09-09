// Статистика подрядчиков и генподрядчиков: второй экран MVP.
//
// Отдельный роут, а не фильтр на поиске компаний: здесь другой вопрос —
// не «что известно про эту компанию», а «кого выбрать и кого избегать».

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { query } from '../db/pool.js';

export const contractorsRouter = asyncRouter();

const listSchema = z.object({
  role: z.enum(['general_contractor', 'contractor', 'customer', 'any']).default('any'),
  city: z.string().max(120).optional(),
  /** Компании без данных по умолчанию скрыты: серый светофор ничего не говорит. */
  includeGrey: z.coerce.boolean().default(false),
  sort: z.enum(['risk', 'projects', 'mentions']).default('projects'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

contractorsRouter.get('/', async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const { role, city, includeGrey, sort, limit } = parsed.data;

  const roleColumn =
    role === 'general_contractor'
      ? 'projects_as_gc'
      : role === 'contractor'
        ? 'projects_as_contractor'
        : role === 'customer'
          ? 'projects_as_customer'
          : null;

  // Сортировка подставляется из фиксированного набора, а не из параметра:
  // имя колонки в ORDER BY нельзя передать плейсхолдером.
  const orderBy =
    sort === 'risk'
      ? 'risk_score DESC, projects_total DESC'
      : sort === 'mentions'
        ? 'mentions_90d DESC, projects_total DESC'
        : 'projects_total DESC, risk_score ASC';

  const rows = await query(
    `SELECT company_id AS "companyId", name, city,
            projects_total   AS "projectsTotal",
            active_projects  AS "activeProjects",
            done_projects    AS "doneProjects",
            projects_as_gc   AS "projectsAsGc",
            projects_as_contractor AS "projectsAsContractor",
            projects_as_customer   AS "projectsAsCustomer",
            avg_delay_days   AS "avgDelayDays",
            delayed_projects AS "delayedProjects",
            delay_share      AS "delayShare",
            mentions_90d     AS "mentions90d",
            negative_90d     AS "negative90d",
            negative_share_90d AS "negativeShare90d",
            hard_events_12m  AS "hardEvents12m",
            replaced_count   AS "replacedCount",
            risk_score       AS "riskScore",
            risk_light       AS "riskLight"
     FROM company_risk
     WHERE ($1::text IS NULL OR city = $1::text)
       AND ($2::boolean OR risk_light <> 'grey')
       AND ($3::text IS NULL OR
            CASE $3::text
              WHEN 'projects_as_gc'         THEN projects_as_gc
              WHEN 'projects_as_contractor' THEN projects_as_contractor
              WHEN 'projects_as_customer'   THEN projects_as_customer
            END > 0)
     ORDER BY ${orderBy}
     LIMIT $4`,
    [city ?? null, includeGrey, roleColumn, limit],
  );

  res.json({ items: rows });
});

/** Сводка по рынку для главной: сколько всего и как распределён риск. */
contractorsRouter.get('/summary', async (_req, res) => {
  const rows = await query<{ riskLight: string; n: number }>(
    `SELECT risk_light AS "riskLight", count(*)::int AS n
     FROM company_risk GROUP BY risk_light`,
  );

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
       -- Растёт, значит резолвер стал слишком консервативным.
       (SELECT count(*) FROM (
          SELECT entity_id FROM mentions WHERE entity_kind = 'company'
          GROUP BY entity_id HAVING count(*) = 1
        ) t)::int AS "lonelyCompanies"`,
  );

  res.json({ byRisk: rows, totals: totals[0] ?? null });
});
