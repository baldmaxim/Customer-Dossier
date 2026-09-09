// API карточки Заказчика — ядро портала.
//
// Карточка собирается тремя независимыми запросами вместо одного большого
// JOIN: лента упоминаний пагинируется отдельно и живёт своей жизнью, а
// склеивать её с агрегатами значит тянуть сотни строк ради одной цифры.

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { query, queryOne } from '../db/pool.js';
import { normalizeName } from '../resolve/normalize.js';

export const companiesRouter = asyncRouter();

interface ICompanyRisk {
  companyId: number;
  name: string;
  city: string | null;
  projectsTotal: number;
  activeProjects: number;
  doneProjects: number;
  projectsAsGc: number;
  projectsAsContractor: number;
  projectsAsCustomer: number;
  avgDelayDays: number | null;
  delayedProjects: number;
  delayShare: number | null;
  mentions90d: number;
  negative90d: number;
  negativeShare90d: number | null;
  lastMentionAt: string | null;
  hardEvents12m: number;
  replacedCount: number;
  riskScore: number;
  riskLight: 'grey' | 'green' | 'yellow' | 'red';
}

const RISK_COLUMNS = `
  company_id            AS "companyId",
  name, city,
  projects_total        AS "projectsTotal",
  active_projects       AS "activeProjects",
  done_projects         AS "doneProjects",
  projects_as_gc        AS "projectsAsGc",
  projects_as_contractor AS "projectsAsContractor",
  projects_as_customer  AS "projectsAsCustomer",
  avg_delay_days        AS "avgDelayDays",
  delayed_projects      AS "delayedProjects",
  delay_share           AS "delayShare",
  mentions_90d          AS "mentions90d",
  negative_90d          AS "negative90d",
  negative_share_90d    AS "negativeShare90d",
  last_mention_at       AS "lastMentionAt",
  hard_events_12m       AS "hardEvents12m",
  replaced_count        AS "replacedCount",
  risk_score            AS "riskScore",
  risk_light            AS "riskLight"
`;

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Поиск по названию. Через pg_trgm, а не через FTS: to_tsvector('russian')
 * не знает казахских словоформ и не помогает на брендах вроде «BI Group».
 * Ищем по той же нормализованной латинице, что используется при резолвинге —
 * иначе «БИ Групп» не найдёт компанию, записанную как «BI Group».
 */
companiesRouter.get('/', async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Укажите параметр q длиной от 2 символов' });
    return;
  }

  const normalized = normalizeName(parsed.data.q, 'company');

  const rows = await query<{
    id: number;
    name: string;
    city: string | null;
    legalForm: string | null;
    score: number;
  }>(
    `SELECT c.id, c.name, c.city, c.legal_form AS "legalForm",
            greatest(
              similarity(c.name_latin, $1),
              coalesce((SELECT max(similarity(a.alias_latin, $1))
                        FROM entity_aliases a
                        WHERE a.entity_kind = 'company' AND a.entity_id = c.id), 0)
            ) AS score
     FROM companies c
     WHERE c.merged_into_id IS NULL
       AND (c.name_latin % $1 OR c.name_key LIKE $2 || '%')
     ORDER BY score DESC, c.name
     LIMIT $3`,
    [normalized.latin, normalized.key, parsed.data.limit],
  );

  res.json({ items: rows });
});

/** Профиль + метрики риска. */
companiesRouter.get('/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const company = await queryOne<{
    id: number;
    name: string;
    legalForm: string | null;
    taxId: string | null;
    city: string | null;
    website: string | null;
    isVerified: boolean;
    mergedIntoId: number | null;
  }>(
    `SELECT id, name, legal_form AS "legalForm", tax_id AS "taxId", city, website,
            is_verified AS "isVerified", merged_into_id AS "mergedIntoId"
     FROM companies WHERE id = $1`,
    [id],
  );

  if (!company) {
    res.status(404).json({ error: 'Компания не найдена' });
    return;
  }

  // Слитая компания не 404: на её id могли остаться внешние ссылки и закладки.
  // Отдаём указатель на живую сущность, фронт делает редирект.
  if (company.mergedIntoId !== null) {
    res.status(200).json({ mergedInto: company.mergedIntoId });
    return;
  }

  const risk = await queryOne<ICompanyRisk>(
    `SELECT ${RISK_COLUMNS} FROM company_risk WHERE company_id = $1`,
    [id],
  );

  const aliases = await query<{ alias: string; hits: number }>(
    `SELECT alias, hits FROM entity_aliases
     WHERE entity_kind = 'company' AND entity_id = $1
     ORDER BY hits DESC LIMIT 10`,
    [id],
  );

  res.json({ company, risk, aliases });
});

/** Объекты компании с её ролью на каждом. */
companiesRouter.get('/:id/projects', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const rows = await query(
    `SELECT p.id, p.name, p.kind, p.stage, p.city,
            p.planned_completion AS "plannedCompletion",
            p.actual_completion  AS "actualCompletion",
            pp.role, pp.confidence, pp.is_current AS "isCurrent",
            pp.evidence_document_id AS "evidenceDocumentId",
            -- контрагенты на том же объекте: кто ещё там работает
            (SELECT json_agg(json_build_object('id', c2.id, 'name', c2.name, 'role', pp2.role))
             FROM project_participants pp2
             JOIN companies c2 ON c2.id = pp2.company_id AND c2.merged_into_id IS NULL
             WHERE pp2.project_id = p.id AND pp2.company_id <> $1 AND pp2.is_current
            ) AS counterparties
     FROM project_participants pp
     JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL
     WHERE pp.company_id = $1
     ORDER BY pp.is_current DESC, p.stage, p.name`,
    [id],
  );

  res.json({ items: rows });
});

const feedSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** Keyset-пагинация: курсор вида "<iso>|<id>". */
  cursor: z.string().max(80).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
});

/**
 * Лента упоминаний. Keyset, а не OFFSET: лента постоянно пополняется сверху,
 * и OFFSET на второй странице показал бы уже виденное.
 */
companiesRouter.get('/:id/mentions', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = feedSchema.safeParse(req.query);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }

  const { limit, cursor, sentiment } = parsed.data;
  const [cursorAt, cursorId] = cursor ? cursor.split('|') : [null, null];

  const rows = await query<{ publishedAt: string; id: number }>(
    `SELECT m.id, m.surface_form AS "surfaceForm", m.role, m.quote,
            m.quote_verified AS "quoteVerified", m.sentiment, m.confidence,
            m.published_at   AS "publishedAt",
            d.url, d.body, s.title AS "sourceTitle", s.kind AS "sourceKind"
     FROM mentions m
     JOIN raw_documents d ON d.id = m.document_id
     JOIN sources s       ON s.id = d.source_id
     WHERE m.entity_kind = 'company' AND m.entity_id = $1
       AND ($3::timestamptz IS NULL OR (m.published_at, m.id) < ($3::timestamptz, $4::bigint))
       AND ($5::text IS NULL OR m.sentiment = $5::sentiment)
     ORDER BY m.published_at DESC, m.id DESC
     LIMIT $2`,
    [id, limit, cursorAt, cursorId, sentiment ?? null],
  );

  const last = rows[rows.length - 1];
  res.json({
    items: rows,
    nextCursor: rows.length === limit && last ? `${last.publishedAt}|${last.id}` : null,
  });
});

/** События компании — то, что формирует светофор. */
companiesRouter.get('/:id/events', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const rows = await query(
    `SELECT e.id, e.type, e.occurred_on AS "occurredOn", e.severity,
            e.amount_rub AS "amountRub", e.quote, e.confidence, e.status,
            p.id AS "projectId", p.name AS "projectName",
            cp.id AS "counterpartyId", cp.name AS "counterpartyName",
            d.url
     FROM events e
     LEFT JOIN projects  p  ON p.id  = e.project_id
     LEFT JOIN companies cp ON cp.id = e.counterparty_id
     JOIN raw_documents  d  ON d.id  = e.document_id
     WHERE e.company_id = $1 AND e.status <> 'rejected'
     ORDER BY e.severity DESC, e.occurred_on DESC NULLS LAST, e.id DESC
     LIMIT 100`,
    [id],
  );

  res.json({ items: rows });
});

/**
 * Похожие компании — обратная защита от непойманных дублей. Резолвер
 * консервативен и охотно создаёт новую компанию; без этого блока дубли
 * копились бы молча.
 */
companiesRouter.get('/:id/similar', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const rows = await query(
    `SELECT c2.id, c2.name, c2.city, c2.tax_id AS "taxId",
            similarity(c1.name_latin, c2.name_latin) AS score
     FROM companies c1
     JOIN companies c2 ON c2.id <> c1.id AND c2.merged_into_id IS NULL
                       AND c2.name_latin % c1.name_latin
     WHERE c1.id = $1 AND c1.merged_into_id IS NULL
       -- пары, уже разобранные вручную, показывать не нужно
       AND NOT EXISTS (
         SELECT 1 FROM merge_queue q
         WHERE q.entity_kind = 'company' AND q.status <> 'pending'
           AND least(q.source_entity_id, q.target_entity_id) = least(c1.id, c2.id)
           AND greatest(q.source_entity_id, q.target_entity_id) = greatest(c1.id, c2.id)
       )
     ORDER BY score DESC
     LIMIT 5`,
    [id],
  );

  res.json({ items: rows });
});
