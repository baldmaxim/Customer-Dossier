// Каталог компаний от юрлица (ADR-016, этап 23B): главная портала.
//
// Раньше каталог читал снимок сигналов, посчитанный по публикациям, и прятал компании без публикаций —
// компания существовала, только если о ней написали. Теперь основа — реквизит:
//  - legal        — «Компании»: юрлица (действующий ИНН/ОГРН/ОГРНИП с верной контрольной суммой или «на контроле»)
//                   и те, в кого входят СЗ; СЗ — не отдельной строкой, а внутри главной компании или группы;
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
import { shareInFlight } from '../utils/shareInFlight.js';
import { ttlCache } from '../utils/ttlCache.js';

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

export interface ICatalogMember {
  companyId: number;
  name: string;
  inn: string | null;
}

export interface ICatalogRow {
  /** company — карточка портала; registry_group — группа только по реестру ДОМ.РФ, своей карточки нет. */
  kind: 'company' | 'registry_group';
  companyId: number | null;
  /** Страница группы в реестре ДОМ.РФ — у строки registry_group. */
  groupRef: string | null;
  name: string;
  /** Краткое наименование по ЕГРЮЛ (Контур.Фокус); null — сведений нет. */
  egrulName: string | null;
  egrulStatus: string | null;
  inn: string | null;
  ogrn: string | null;
  city: string | null;
  entityType: string;
  /** Роли, объекты и публикации — компании вместе с её СЗ (юрлицами, которые входят в неё). */
  roles: string[];
  objects: number;
  publications: number;
  lastPublishedAt: string | null;
  watched: boolean;
  namePending: boolean;
  /** Кандидатов для назначения: подсказки Фокуса по названию и пары «возможный дубль». */
  hints: number;
  /** Юрлица, которые входят в эту компанию или группу: в общем списке их нет, они здесь. */
  members: ICatalogMember[];
  /** Куда входит сама компания — видно, когда СЗ показаны плоско (фильтр «на контроле»). */
  parents: string[];
}

export interface ICatalogResponse {
  view: CatalogView;
  items: ICatalogRow[];
  /** Строк в виде с фильтрами; показано не больше CATALOG_LIMIT. */
  total: number;
  /** Сколько в каждом виде без фильтров роли и контроля — подписи вкладок. */
  counts: Record<CatalogView, number> & { watched: number; dismissed: number };
}

// Кто в чью «семью» входит (05.10.2026, просьба владельца: «СЗ — под главную группу или компанию»):
//  - mem       — «входит в группу» (corporate_relation/member_of_group) из реестра с действующим доказательством или
//                из опубликованных наборов, плюс СЗ, чья страница группы в ДОМ.РФ подтверждена как компания портала;
//  - vgroups   — группы только по реестру ДОМ.РФ: страница группы есть у СЗ, но как компания портала не подтверждена
//                (решение «Это он» на экране ДОМ.РФ) — показываются строкой без своей карточки;
//  - base.nested — юрлицо входит в семью: в «Компаниях» оно не отдельной строкой, а внутри главной.
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
  reg_dev AS MATERIALIZED (
    SELECT DISTINCT ON (r.company_id) r.company_id, d.group_ref,
           coalesce(d.group_name, r.payload->'identity'->>'groupName') AS group_name
    FROM registry_records r
    JOIN domrf_cards d ON d.kind = 'developer' AND d.external_ref = r.external_ref
    JOIN companies c ON c.id = r.company_id AND c.merged_into_id IS NULL
    WHERE r.record_type = 'developer'
    ORDER BY r.company_id, r.fetched_at DESC
  ),
  group_heads AS MATERIALIZED (
    SELECT l.external_ref AS group_ref, min(coalesce(c.merged_into_id, c.id)) AS head,
           count(DISTINCT coalesce(c.merged_into_id, c.id)) AS n
    FROM domrf_company_links l JOIN companies c ON c.id = l.company_id
    WHERE l.kind = 'group' AND l.state = 'confirmed'
    GROUP BY l.external_ref
  ),
  mem AS MATERIALIZED (
    SELECT a.subject_company_id AS member, a.object_company_id AS head
    FROM assertions a
    WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group' AND a.subject_company_id <> a.object_company_id
      AND a.status <> 'rejected' AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'claim', 'unknown')
      AND ((a.origin = 'registry' AND EXISTS (
              SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'))
        OR EXISTS (SELECT 1 FROM published_assertions_v pa WHERE pa.id = a.id))
    UNION
    SELECT rd.company_id, gh.head FROM reg_dev rd JOIN group_heads gh ON gh.group_ref = rd.group_ref AND gh.n = 1
    WHERE rd.company_id <> gh.head
  ),
  vgroups AS MATERIALIZED (
    SELECT rd.group_ref, max(rd.group_name) AS group_name, array_agg(rd.company_id) AS members
    FROM reg_dev rd
    WHERE rd.group_ref IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM group_heads gh WHERE gh.group_ref = rd.group_ref)
      AND NOT EXISTS (SELECT 1 FROM mem WHERE mem.member = rd.company_id)
    GROUP BY rd.group_ref
  ),
  vmem AS MATERIALIZED (
    SELECT group_ref, unnest(members) AS member FROM vgroups
  ),
  -- Признаки «головная» и «внутри семьи» — соединением, а не EXISTS по CTE на каждую компанию (07.10.2026):
  -- подзапрос в CASE не становится полусоединением и перебирал mem целиком для каждой строки companies.
  mem_heads AS MATERIALIZED (
    SELECT DISTINCT head FROM mem
  ),
  nested_members AS MATERIALIZED (
    SELECT member FROM mem UNION SELECT member FROM vmem
  ),
  base AS MATERIALIZED (
    SELECT c.id, c.name, c.city, c.entity_type, c.name_pending, ids.inn, ids.ogrn, (w.company_id IS NOT NULL) AS watched,
           CASE WHEN c.entity_type = 'group' THEN 'groups'
                WHEN ids.company_id IS NOT NULL OR w.company_id IS NOT NULL OR mh.head IS NOT NULL THEN 'legal'
                WHEN d.company_id IS NOT NULL THEN 'dismissed'
                ELSE 'unidentified' END AS view,
           (nm.member IS NOT NULL) AS nested
    FROM companies c
    LEFT JOIN ids ON ids.company_id = c.id
    LEFT JOIN watched w ON w.company_id = c.id
    LEFT JOIN dismissed d ON d.company_id = c.id
    LEFT JOIN mem_heads mh ON mh.head = c.id
    LEFT JOIN nested_members nm ON nm.member = c.id
    WHERE c.merged_into_id IS NULL
  )`;

const ROWS_SQL = `
  WITH ${BASE_SQL},
  part_rows AS MATERIALIZED (
    SELECT company_id, project_id, role FROM card_participations_v WHERE is_current
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
  fam AS MATERIALIZED (
    SELECT 'c' || id AS head, id AS member FROM base
    UNION
    SELECT 'c' || head, member FROM mem
    UNION
    SELECT 'g' || group_ref, member FROM vmem
  ),
  fam_parts AS MATERIALIZED (
    SELECT f.head, array_agg(DISTINCT pr.role ORDER BY pr.role) AS roles, count(DISTINCT pr.project_id)::int AS objects
    FROM fam f JOIN part_rows pr ON pr.company_id = f.member
    GROUP BY f.head
  ),
  fam_pubs AS MATERIALIZED (
    SELECT f.head, count(DISTINCT t.item_id)::int AS publications, max(coalesce(si.published_at, si.first_observed_at)) AS last_at
    FROM fam f JOIN touched t ON t.company_id = f.member JOIN source_items si ON si.id = t.item_id
    GROUP BY f.head
  ),
  fam_list AS MATERIALIZED (
    SELECT f.head, jsonb_agg(jsonb_build_object('companyId', c.id, 'name', c.name, 'inn', i.inn) ORDER BY c.name, c.id) AS list
    FROM fam f
    JOIN companies c ON c.id = f.member AND c.merged_into_id IS NULL
    LEFT JOIN ids i ON i.company_id = c.id
    WHERE f.head <> 'c' || f.member
    GROUP BY f.head
  ),
  -- «Входит в …» — заранее по участнику, а не подзапросом на каждую строку каталога (07.10.2026).
  parents_of AS MATERIALIZED (
    SELECT m.member, array_agg(DISTINCT hc.name) AS names
    FROM mem m JOIN companies hc ON hc.id = m.head
    GROUP BY m.member
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
  rows_all AS (
    SELECT 'company'::text AS kind, b.id AS company_id, NULL::text AS group_ref, b.name, b.city, b.entity_type, b.name_pending,
           b.inn, b.ogrn, b.watched, coalesce(fp.roles, '{}') AS roles, coalesce(fp.objects, 0) AS objects,
           coalesce(fu.publications, 0) AS publications, fu.last_at, coalesce(h.n, 0) AS hints,
           coalesce(fl.list, '[]'::jsonb) AS members,
           coalesce(po.names, '{}') AS parents
    FROM base b
    LEFT JOIN fam_parts fp ON fp.head = 'c' || b.id
    LEFT JOIN fam_pubs fu ON fu.head = 'c' || b.id
    LEFT JOIN fam_list fl ON fl.head = 'c' || b.id
    LEFT JOIN hints h ON h.company_id = b.id
    LEFT JOIN parents_of po ON po.member = b.id
    WHERE b.view = $1
      AND (NOT $2::boolean OR b.watched)
      -- СЗ — внутри своей семьи; плоско — только в фильтре «на контроле»: там отмечена сама компания.
      AND ($2::boolean OR b.view <> 'legal' OR NOT b.nested)
    UNION ALL
    SELECT 'registry_group', NULL, g.group_ref, coalesce(g.group_name, 'Группа по реестру ДОМ.РФ'), NULL, 'group', false,
           NULL, NULL, false, coalesce(fp.roles, '{}'), coalesce(fp.objects, 0), coalesce(fu.publications, 0), fu.last_at, 0,
           coalesce(fl.list, '[]'::jsonb), '{}'
    FROM vgroups g
    LEFT JOIN fam_parts fp ON fp.head = 'g' || g.group_ref
    LEFT JOIN fam_pubs fu ON fu.head = 'g' || g.group_ref
    LEFT JOIN fam_list fl ON fl.head = 'g' || g.group_ref
    WHERE $1 = 'legal' AND NOT $2::boolean
  ),
  filtered AS (
    SELECT * FROM rows_all r WHERE $3::text IS NULL OR $3::text = ANY(r.roles)
  ),
  -- Сначала страница, потом Фокус (07.10.2026): порядок от ЕГРЮЛ не зависит, а LATERAL до LIMIT искал снимок
  -- для каждой отфильтрованной строки. total — по всем отфильтрованным: окно считается до LIMIT.
  page AS (
    SELECT f.*, count(*) OVER ()::int AS total
    FROM filtered f
    ORDER BY %ORDER%
    LIMIT $4
  )
  SELECT f.kind, f.company_id AS "companyId", f.group_ref AS "groupRef", f.name, f.city, f.entity_type AS "entityType",
         f.name_pending AS "namePending", f.inn, f.ogrn, f.watched, f.roles, f.objects, f.publications, f.last_at AS "lastAt",
         f.hints, f.members, f.parents,
         f.total,
         fr.legal_name, fr.ul_status, fr.ip
  FROM page f
  LEFT JOIN LATERAL (
    SELECT r.payload->'UL'->'legalName' AS legal_name, r.payload->'UL'->'status' AS ul_status, r.payload->'IP' AS ip
    FROM focus_records r
    WHERE r.method = 'req'
      AND ((f.inn IS NOT NULL AND r.identifier_type = 'inn' AND r.identifier = f.inn)
        OR (f.inn IS NULL AND f.ogrn IS NOT NULL AND r.identifier_type = 'ogrn' AND r.identifier = f.ogrn))
    ORDER BY r.fetched_at DESC, r.id DESC
    LIMIT 1
  ) fr ON true
  ORDER BY %ORDER%`;

/** Порядок: на контроле — первыми (кроме «по названию»), «Без ИНН» — по числу публикаций: о ком больше пишут. */
export const orderBy = (view: CatalogView, sort: CatalogQuery['sort']): string => {
  const tail = 'f.name, f.company_id NULLS LAST, f.group_ref';
  if (sort === 'name') return tail;
  const lead = view === 'unidentified' ? '' : 'f.watched DESC, ';
  const key =
    sort === 'publications' ? 'f.publications DESC'
      : sort === 'recent' ? 'f.last_at DESC NULLS LAST'
        : view === 'unidentified' ? 'f.publications DESC, f.objects DESC'
          : 'f.objects DESC, f.publications DESC';
  return `${lead}${key}, ${tail}`;
};

interface IRowSql {
  kind: ICatalogRow['kind'];
  companyId: number | null;
  groupRef: string | null;
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
  members: ICatalogMember[];
  parents: string[];
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

/**
 * Числа вкладок от параметров не зависят. Число на вкладке «Компании» — строк верхнего уровня: СЗ внутри семьи
 * не считаются, группы только по ДОМ.РФ — да. Одновременные запросы каталога делят расчёт (shareInFlight).
 */
const loadCatalogCounts = shareInFlight(
  (_all: 'all'): Promise<Array<{ view: string; n: number; watched: number }>> =>
    query<{ view: string; n: number; watched: number }>(
      `WITH ${BASE_SQL}
       SELECT view, count(*) FILTER (WHERE view <> 'legal' OR NOT nested)::int AS n, count(*) FILTER (WHERE watched)::int AS watched
       FROM base GROUP BY view
       UNION ALL
       SELECT 'registry_groups', count(*)::int, 0 FROM vgroups`,
    ),
);

export const loadCatalog = async (params: CatalogQuery): Promise<ICatalogResponse> => {
  const sql = ROWS_SQL.replaceAll('%ORDER%', orderBy(params.view, params.sort));
  // Строки и числа вкладок друг от друга не зависят — параллельно (07.10.2026): каждый запрос считает базу заново.
  const [rows, counts] = await Promise.all([
    query<IRowSql>(sql, [params.view, params.watch, params.role === 'any' ? null : params.role, CATALOG_LIMIT]),
    loadCatalogCounts('all'),
  ]);
  const byView = Object.fromEntries(CATALOG_VIEWS.map(v => [v, counts.find(c => c.view === v)?.n ?? 0])) as Record<CatalogView, number>;
  byView.legal += counts.find(c => c.view === 'registry_groups')?.n ?? 0;
  return {
    view: params.view,
    items: rows.map(row => {
      const egrul = egrulOf(row);
      return {
        kind: row.kind,
        companyId: row.companyId,
        groupRef: row.groupRef,
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
        members: row.members,
        parents: row.parents,
      };
    }),
    total: rows[0]?.total ?? 0,
    counts: {
      ...byView,
      watched: counts.reduce((sum, c) => sum + c.watched, 0),
      dismissed: counts.find(c => c.view === 'dismissed')?.n ?? 0,
    },
  };
};

/**
 * Каталог считается по всей базе, а вкладки и сортировки главной перебирают одни и те же наборы: одинаковый запрос
 * 30 с отдаётся из памяти (07.10.2026). Любое изменение через API (не GET, ответ < 400) сбрасывает кэш сразу —
 * «На контроле», заведение компании, слияние видны без ожидания (app.ts); фоновые сбор и разбор — не позже 30 с.
 */
const catalogCache = ttlCache(loadCatalog, {
  ttlMs: 30_000,
  max: 32,
  keyOf: q => JSON.stringify([q.view, q.watch, q.role, q.sort]),
});

export const invalidateCatalogCache = (): void => catalogCache.clear();

export const catalogRouter = asyncRouter();

catalogRouter.get('/companies', async (req, res) => {
  const parsed = catalogSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры каталога', code: 'bad_query' });
    return;
  }
  res.json(await catalogCache.get(parsed.data));
});
