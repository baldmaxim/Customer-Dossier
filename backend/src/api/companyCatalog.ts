// Каталог компаний от юрлица (ADR-016, этап 23B): главная портала.
//
// Раньше каталог читал снимок сигналов, посчитанный по публикациям, и прятал компании без публикаций —
// компания существовала, только если о ней написали. Теперь основа — реквизит:
//  - legal        — юрлица: действующий ИНН/ОГРН/ОГРНИП с верной контрольной суммой или «на контроле»;
//  - groups       — группы компаний (entity_type = 'group'): у группы нет своего ИНН, это круг юрлиц;
//  - unidentified — «Без ИНН»: имена из публикаций без реквизита. Это не компании, а упоминания, которые
//                   ждут решения человека (ADR-016 п. 3); сначала те, о ком больше пишут. Отмеченные
//                   «не компания» (этап 23D) не показываются ни в одном виде — только числом;
//                   у строки — сколько кандидатов ждёт решения (подсказки Фокуса и пары «возможный дубль»).
//
// Числа строки — из тех же источников, что карточка: объекты и роли — card_participations_v (текущие),
// публикации — опубликованные утверждения и legacy-упоминания, статус и наименование — последний ответ
// Контур.Фокуса по реквизиту (снимок вне канона, ADR-015). Виды — только MATERIALIZED: иначе планировщик
// пересчитывает card_participations_v на каждую компанию (урок 01.10.2026).

import { z } from 'zod';

import { query } from '../db/pool.js';
import { egrulNamesOf } from '../focus/identity.js';
import { mapReq, summaryOf } from '../focus/map.js';
import { asyncRouter } from '../utils/asyncRouter.js';

export const CATALOG_VIEWS = ['legal', 'groups', 'unidentified'] as const;
export type CatalogView = (typeof CATALOG_VIEWS)[number];

/** Сколько строк отдаём: каталог — обзор, а не выгрузка; под списком — «показаны первые N из M». */
export const CATALOG_LIMIT = 200;

export const catalogSchema = z.object({
  view: z.enum(CATALOG_VIEWS).default('legal'),
  watch: z.enum(['1', 'true', '0', 'false']).default('0').transform(v => v === '1' || v === 'true'),
  // Роль на объекте (participation_role) или any; имя роли — из фиксированного словаря базы, в SQL идёт параметром.
  role: z.string().regex(/^[a-z_]{2,40}$/).default('any'),
  // Сортировка — по объёму сведений или имени; «надёжности» и «риска» нет (ADR-009).
  sort: z.enum(['objects', 'publications', 'recent', 'name']).default('objects'),
});

export type CatalogQuery = z.infer<typeof catalogSchema>;

export interface ICatalogRow {
  companyId: number;
  name: string;
  /** Краткое наименование по ЕГРЮЛ (Контур.Фокус); null — сведений нет. */
  egrulName: string | null;
  egrulStatus: string | null;
  inn: string | null;
  ogrn: string | null;
  city: string | null;
  entityType: string;
  roles: string[];
  objects: number;
  publications: number;
  lastPublishedAt: string | null;
  watched: boolean;
  namePending: boolean;
  /** Кандидатов для назначения: подсказки Фокуса по названию и пары «возможный дубль». */
  hints: number;
}

export interface ICatalogResponse {
  view: CatalogView;
  items: ICatalogRow[];
  /** Строк в виде с фильтрами; показано не больше CATALOG_LIMIT. */
  total: number;
  /** Сколько в каждом виде без фильтров роли и контроля — подписи вкладок. */
  counts: Record<CatalogView, number> & { watched: number; dismissed: number };
}

const BASE_SQL = `
  ids AS MATERIALIZED (
    SELECT ei.company_id,
           min(ei.value) FILTER (WHERE ei.identifier_type = 'inn') AS inn,
           min(ei.value) FILTER (WHERE ei.identifier_type IN ('ogrn', 'ogrnip')) AS ogrn
    FROM entity_identifiers ei
    WHERE ei.status = 'active' AND ei.validation_status = 'checksum_valid' AND ei.identifier_type IN ('inn', 'ogrn', 'ogrnip')
    GROUP BY ei.company_id
  ),
  watched AS MATERIALIZED (
    SELECT company_id FROM company_watch WHERE removed_at IS NULL
  ),
  dismissed AS MATERIALIZED (
    SELECT company_id FROM company_dismissals WHERE revoked_at IS NULL
  ),
  base AS MATERIALIZED (
    SELECT c.id, c.name, c.city, c.entity_type, c.name_pending, ids.inn, ids.ogrn, (w.company_id IS NOT NULL) AS watched,
           CASE WHEN c.entity_type = 'group' THEN 'groups'
                WHEN ids.company_id IS NOT NULL OR w.company_id IS NOT NULL THEN 'legal'
                WHEN d.company_id IS NOT NULL THEN 'dismissed'
                ELSE 'unidentified' END AS view
    FROM companies c
    LEFT JOIN ids ON ids.company_id = c.id
    LEFT JOIN watched w ON w.company_id = c.id
    LEFT JOIN dismissed d ON d.company_id = c.id
    WHERE c.merged_into_id IS NULL
  )`;

const ROWS_SQL = `
  WITH ${BASE_SQL},
  parts AS MATERIALIZED (
    SELECT company_id, array_agg(DISTINCT role ORDER BY role) AS roles, count(DISTINCT project_id)::int AS objects
    FROM card_participations_v WHERE is_current GROUP BY company_id
  ),
  touched AS MATERIALIZED (
    SELECT x.company_id, pa.source_item_id AS item_id
    FROM published_assertions_v pa
    CROSS JOIN LATERAL (VALUES (pa.subject_company_id), (pa.object_company_id), (pa.counterparty_company_id)) x(company_id)
    WHERE x.company_id IS NOT NULL
    UNION
    SELECT m.entity_id, r.source_item_id
    FROM mentions m JOIN document_revisions r ON r.legacy_document_id = m.document_id
    WHERE m.entity_kind = 'company'
  ),
  pubs AS MATERIALIZED (
    SELECT t.company_id, count(*)::int AS publications, max(coalesce(si.published_at, si.first_observed_at)) AS last_at
    FROM touched t JOIN source_items si ON si.id = t.item_id
    GROUP BY t.company_id
  ),
  hints AS MATERIALIZED (
    SELECT company_id, count(*)::int AS n FROM (
      SELECT company_id FROM company_name_suggestions
      UNION ALL
      SELECT source_entity_id FROM merge_queue WHERE entity_kind = 'company' AND status = 'pending'
      UNION ALL
      SELECT target_entity_id FROM merge_queue WHERE entity_kind = 'company' AND status = 'pending'
    ) x GROUP BY company_id
  ),
  filtered AS (
    SELECT b.*, coalesce(p.roles, '{}') AS roles, coalesce(p.objects, 0) AS objects,
           coalesce(u.publications, 0) AS publications, u.last_at, coalesce(h.n, 0) AS hints
    FROM base b
    LEFT JOIN parts p ON p.company_id = b.id
    LEFT JOIN pubs u ON u.company_id = b.id
    LEFT JOIN hints h ON h.company_id = b.id
    WHERE b.view = $1
      AND (NOT $2::boolean OR b.watched)
      AND ($3::text IS NULL OR $3::text = ANY(p.roles))
  )
  SELECT f.id AS "companyId", f.name, f.city, f.entity_type AS "entityType", f.name_pending AS "namePending",
         f.inn, f.ogrn, f.watched, f.roles, f.objects, f.publications, f.last_at AS "lastAt", f.hints,
         count(*) OVER ()::int AS total,
         fr.legal_name, fr.ul_status, fr.ip
  FROM filtered f
  LEFT JOIN LATERAL (
    SELECT r.payload->'UL'->'legalName' AS legal_name, r.payload->'UL'->'status' AS ul_status, r.payload->'IP' AS ip
    FROM focus_records r
    WHERE r.method = 'req'
      AND ((f.inn IS NOT NULL AND r.identifier_type = 'inn' AND r.identifier = f.inn)
        OR (f.inn IS NULL AND f.ogrn IS NOT NULL AND r.identifier_type = 'ogrn' AND r.identifier = f.ogrn))
    ORDER BY r.fetched_at DESC, r.id DESC
    LIMIT 1
  ) fr ON true
  ORDER BY %ORDER%
  LIMIT $4`;

/** Порядок: на контроле — первыми (кроме «по названию»), «Без ИНН» — по числу публикаций: о ком больше пишут. */
export const orderBy = (view: CatalogView, sort: CatalogQuery['sort']): string => {
  if (sort === 'name') return 'f.name, f.id';
  const lead = view === 'unidentified' ? '' : 'f.watched DESC, ';
  const key =
    sort === 'publications' ? 'f.publications DESC'
      : sort === 'recent' ? 'f.last_at DESC NULLS LAST'
        : view === 'unidentified' ? 'f.publications DESC, f.objects DESC'
          : 'f.objects DESC, f.publications DESC';
  return `${lead}${key}, f.name, f.id`;
};

interface IRowSql {
  companyId: number;
  name: string;
  city: string | null;
  entityType: string;
  namePending: boolean;
  inn: string | null;
  ogrn: string | null;
  watched: boolean;
  roles: string[];
  objects: number;
  publications: number;
  lastAt: Date | null;
  hints: number;
  total: number;
  legal_name: unknown;
  ul_status: unknown;
  ip: unknown;
}

/** Наименование и статус из урезанного ответа req: в строку каталога идут только они. */
export const egrulOf = (row: Pick<IRowSql, 'legal_name' | 'ul_status' | 'ip'>): { name: string | null; status: string | null } => {
  if (row.legal_name === null && row.ul_status === null && row.ip === null) return { name: null, status: null };
  const payload: Record<string, unknown> =
    row.legal_name !== null || row.ul_status !== null ? { UL: { legalName: row.legal_name, status: row.ul_status } } : { IP: row.ip };
  return { name: egrulNamesOf(payload).short, status: summaryOf(mapReq(payload)).status };
};

export const loadCatalog = async (params: CatalogQuery): Promise<ICatalogResponse> => {
  const sql = ROWS_SQL.replace('%ORDER%', orderBy(params.view, params.sort));
  const rows = await query<IRowSql>(sql, [params.view, params.watch, params.role === 'any' ? null : params.role, CATALOG_LIMIT]);
  const counts = await query<{ view: CatalogView; n: number; watched: number }>(
    `WITH ${BASE_SQL}
     SELECT view, count(*)::int AS n, count(*) FILTER (WHERE watched)::int AS watched FROM base GROUP BY view`,
  );
  const byView = Object.fromEntries(CATALOG_VIEWS.map(v => [v, counts.find(c => c.view === v)?.n ?? 0])) as Record<CatalogView, number>;
  return {
    view: params.view,
    items: rows.map(row => {
      const egrul = egrulOf(row);
      return {
        companyId: row.companyId,
        name: row.name,
        egrulName: egrul.name,
        egrulStatus: egrul.status,
        inn: row.inn,
        ogrn: row.ogrn,
        city: row.city,
        entityType: row.entityType,
        roles: row.roles,
        objects: row.objects,
        publications: row.publications,
        lastPublishedAt: row.lastAt?.toISOString() ?? null,
        watched: row.watched,
        namePending: row.namePending,
        hints: row.hints,
      };
    }),
    total: rows[0]?.total ?? 0,
    counts: {
      ...byView,
      watched: counts.reduce((sum, c) => sum + c.watched, 0),
      dismissed: counts.find(c => (c.view as string) === 'dismissed')?.n ?? 0,
    },
  };
};

export const catalogRouter = asyncRouter();

catalogRouter.get('/companies', async (req, res) => {
  const parsed = catalogSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры каталога', code: 'bad_query' });
    return;
  }
  res.json(await loadCatalog(parsed.data));
});
