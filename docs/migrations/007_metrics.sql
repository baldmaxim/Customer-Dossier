-- 007: агрегаты карточки Заказчика и статистики подрядчика.
--
-- MATERIALIZED VIEW + UNIQUE-индекс -> REFRESH CONCURRENTLY не блокирует чтение.
-- Формулы «светофора» вынесены в обычную VIEW сверху: пороги правятся без пересчёта.

CREATE MATERIALIZED VIEW company_metrics AS
WITH part AS (
  SELECT pp.company_id, pp.project_id, pp.role,
         p.stage, p.planned_completion, p.actual_completion
  FROM project_participants pp
  JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL
  WHERE pp.is_current AND pp.confidence >= 0.7
),
proj AS (
  SELECT company_id,
    count(DISTINCT project_id)                                                   AS projects_total,
    count(DISTINCT project_id) FILTER (WHERE stage IN ('construction','design'))  AS active_projects,
    count(DISTINCT project_id) FILTER (WHERE stage = 'commissioned')              AS done_projects,
    count(DISTINCT project_id) FILTER (WHERE role = 'general_contractor')         AS projects_as_gc,
    count(DISTINCT project_id) FILTER (WHERE role = 'contractor')                 AS projects_as_contractor,
    count(DISTINCT project_id) FILTER (WHERE role = 'customer')                   AS projects_as_customer,
    avg(CASE
          WHEN actual_completion IS NOT NULL AND planned_completion IS NOT NULL
            THEN (actual_completion - planned_completion)
          WHEN actual_completion IS NULL AND planned_completion < current_date
            THEN (current_date - planned_completion)
        END)::numeric(8,1)                                                        AS avg_delay_days
  FROM part
  GROUP BY company_id
),
delayed AS (
  SELECT pp.company_id, count(DISTINCT e.project_id) AS delayed_projects
  FROM events e
  JOIN project_participants pp ON pp.project_id = e.project_id AND pp.is_current
  WHERE e.type IN ('delay','deadline_missed')
    AND e.status <> 'rejected' AND e.confidence >= 0.8
    AND coalesce(e.occurred_on, current_date) > current_date - interval '24 months'
  GROUP BY pp.company_id
),
ment AS (
  SELECT entity_id AS company_id,
    count(*) FILTER (WHERE published_at > now() - interval '90 days')            AS mentions_90d,
    count(*) FILTER (WHERE published_at > now() - interval '90 days'
                       AND sentiment = 'negative')                               AS negative_90d,
    max(published_at)                                                            AS last_mention_at
  FROM mentions
  WHERE entity_kind = 'company' AND confidence >= 0.7
  GROUP BY entity_id
),
hard AS (
  SELECT company_id, count(*) AS hard_events_12m
  FROM events
  WHERE type IN ('bankruptcy','court_case','license_revoked')
    AND status <> 'rejected' AND confidence >= 0.8 AND company_id IS NOT NULL
    AND coalesce(occurred_on, current_date) > current_date - interval '12 months'
  GROUP BY company_id
),
repl AS (
  SELECT counterparty_id AS company_id, count(*) AS replaced_count
  FROM events
  WHERE type = 'contractor_change' AND status <> 'rejected' AND counterparty_id IS NOT NULL
  GROUP BY counterparty_id
)
SELECT
  c.id AS company_id, c.name, c.city,
  coalesce(pr.projects_total, 0)         AS projects_total,
  coalesce(pr.active_projects, 0)        AS active_projects,
  coalesce(pr.done_projects, 0)          AS done_projects,
  coalesce(pr.projects_as_gc, 0)         AS projects_as_gc,
  coalesce(pr.projects_as_contractor, 0) AS projects_as_contractor,
  coalesce(pr.projects_as_customer, 0)   AS projects_as_customer,
  pr.avg_delay_days,
  coalesce(d.delayed_projects, 0)        AS delayed_projects,
  round(coalesce(d.delayed_projects, 0)::numeric / nullif(pr.projects_total, 0), 3) AS delay_share,
  coalesce(m.mentions_90d, 0)            AS mentions_90d,
  coalesce(m.negative_90d, 0)            AS negative_90d,
  round(coalesce(m.negative_90d, 0)::numeric / nullif(m.mentions_90d, 0), 3)        AS negative_share_90d,
  m.last_mention_at,
  coalesce(h.hard_events_12m, 0)         AS hard_events_12m,
  coalesce(rp.replaced_count, 0)         AS replaced_count
FROM companies c
LEFT JOIN proj    pr ON pr.company_id = c.id
LEFT JOIN delayed d  ON d.company_id  = c.id
LEFT JOIN ment    m  ON m.company_id  = c.id
LEFT JOIN hard    h  ON h.company_id  = c.id
LEFT JOIN repl    rp ON rp.company_id = c.id
WHERE c.merged_into_id IS NULL;

-- Обязателен для REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX company_metrics_pk ON company_metrics (company_id);

-- Светофор отдельно от MV: пороги правятся без пересчёта агрегатов.
-- Состояние 'grey' («мало данных») обязательно: без него любая новая компания
-- с одним негативным постом мгновенно краснеет, и портал теряет доверие.
CREATE VIEW company_risk AS
SELECT m.*,
  round(
      40 * least(coalesce(m.negative_share_90d, 0), 1)
    + 30 * least(coalesce(m.delay_share, 0), 1)
    + 30 * (CASE WHEN m.hard_events_12m > 0 THEN 1 ELSE 0 END)
  )::int AS risk_score,
  CASE
    WHEN m.mentions_90d < 3 AND m.hard_events_12m = 0 THEN 'grey'
    WHEN 40 * least(coalesce(m.negative_share_90d, 0), 1)
       + 30 * least(coalesce(m.delay_share, 0), 1)
       + 30 * (CASE WHEN m.hard_events_12m > 0 THEN 1 ELSE 0 END) >= 60 THEN 'red'
    WHEN 40 * least(coalesce(m.negative_share_90d, 0), 1)
       + 30 * least(coalesce(m.delay_share, 0), 1)
       + 30 * (CASE WHEN m.hard_events_12m > 0 THEN 1 ELSE 0 END) >= 25 THEN 'yellow'
    ELSE 'green'
  END AS risk_light
FROM company_metrics m;
