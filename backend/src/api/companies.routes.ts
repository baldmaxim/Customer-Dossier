// API карточки Заказчика — ядро портала.
//
// Карточка собирается тремя независимыми запросами вместо одного большого
// JOIN: лента упоминаний пагинируется отдельно и живёт своей жизнью, а
// склеивать её с агрегатами значит тянуть сотни строк ради одной цифры.

import { asyncRouter } from '../utils/asyncRouter.js';
import { z } from 'zod';

import { getPool, query, queryOne } from '../db/pool.js';
import { normalizeName } from '../resolve/normalize.js';
import { loadCardExtras } from '../companies/cardExtras.js';
import { membershipCtes } from '../companies/groupMembership.js';
import { loadCompanyBuilders } from './companyBuilders.js';
import { loadCompanyDelivery } from '../registry/delivery.js';
import { loadCompanyObjects } from './companyObjects.js';
import { loadCompanyPartners } from './companyPartners.js';
import { loadCompanyPublications } from './companyPublications.js';
import { loadCompanyRegistry } from '../registry/read.js';
import { loadProjectContext } from '../signals/context.js';
import { refreshState } from '../signals/refresh.js';

export const companiesRouter = asyncRouter();

/** Событий в карточке — не больше; общее число отдаётся отдельно (total). */
const EVENTS_LIMIT = 100;

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
  // ИНН/ОГРН ищем точным совпадением: похожесть цифр ничего не значит.
  const digits = parsed.data.q.replace(/[\s-]/g, '');
  const taxId = /^[0-9]{10,15}$/.test(digits) ? digits : null;

  const rows = await query<{
    id: number;
    name: string;
    city: string | null;
    legalForm: string | null;
    score: number;
  }>(
    // Кандидаты с контекстом для осознанного выбора (этап 08A): вид сущности, реквизиты, совпавший алиас,
    // объекты и публикации из последнего снимка сигналов. Одноимённые юрлица различаются реквизитами, а не
    // порядком строк; с 02.10.2026 — ещё группой и юридическим адресом со страницы застройщика ДОМ.РФ и
    // группой, в которую компания входит: четыре «СЗ ДОНСТРОЙ» из Самары, Иркутска и Ростова иначе неотличимы.
    // Порядок: совпадение по началу названия — раньше похожих по написанию, внутри — более полные карточки.
    `WITH ${membershipCtes()},
     mem_of AS MATERIALIZED (
       SELECT m.member, string_agg(DISTINCT g.name, ', ') AS names
       FROM mem m JOIN companies g ON g.id = m.head AND g.merged_into_id IS NULL GROUP BY m.member
     ),
     mem_count AS MATERIALIZED (SELECT head, count(DISTINCT member)::int AS n FROM mem GROUP BY head)
     SELECT * FROM (
       SELECT c.id, c.name, c.city, c.legal_form AS "legalForm", c.entity_type AS "entityType",
              coalesce((SELECT array_agg(i.identifier_type || ' ' || i.value ORDER BY i.id) FROM entity_identifiers i
                        WHERE i.company_id = c.id AND i.status = 'active'), '{}') AS identifiers,
              snap.projects, snap.publications,
              reg.group_name AS "registryGroup", reg.address AS "registryAddress",
              -- Группа и её участники — общим правилом портала (companies/groupMembership.ts), как у каталога и карточки.
              mo.names AS "memberOf", mc.n AS members,
              (SELECT a.alias FROM entity_aliases a WHERE a.entity_kind = 'company' AND a.entity_id = c.id
                 AND a.alias_latin % $1 ORDER BY similarity(a.alias_latin, $1) DESC LIMIT 1) AS "matchedAlias",
              (SELECT count(*)::int FROM companies h WHERE h.merged_into_id IS NULL AND h.name_key = c.name_key AND h.id <> c.id) AS homonyms,
              ($2 <> '' AND c.name_key LIKE $2 || '%') AS exact,
              CASE WHEN $4::text IS NOT NULL AND (c.tax_id = $4::text OR EXISTS (
                     SELECT 1 FROM entity_identifiers i WHERE i.company_id = c.id AND i.value = $4::text AND i.status = 'active'))
                   THEN 1 ELSE
              greatest(
                similarity(c.name_latin, $1),
                coalesce((SELECT max(similarity(a.alias_latin, $1))
                          FROM entity_aliases a
                          WHERE a.entity_kind = 'company' AND a.entity_id = c.id), 0)
              ) END AS score
       FROM companies c
       LEFT JOIN mem_of mo ON mo.member = c.id
       LEFT JOIN mem_count mc ON mc.head = c.id
       LEFT JOIN LATERAL (
         SELECT s.projects, s.publications FROM company_signal_snapshots s
         WHERE s.company_id = c.id AND s.refresh_id = (SELECT id FROM signal_active_refresh_v)
       ) snap ON true
       LEFT JOIN LATERAL (
         SELECT r.payload->'identity'->>'groupName' AS group_name, r.payload->'identity'->>'address' AS address
         FROM registry_records r WHERE r.company_id = c.id AND r.record_type = 'developer'
         ORDER BY r.fetched_at DESC LIMIT 1
       ) reg ON true
       WHERE c.merged_into_id IS NULL
         AND (
           c.name_latin % $1
           OR ($2 <> '' AND c.name_key LIKE $2 || '%')
           -- Альтернативные написания участвуют не только в оценке, но и в отборе:
           -- иначе компанию не найти по имени, под которым её знают.
           OR EXISTS (
             SELECT 1 FROM entity_aliases a
             WHERE a.entity_kind = 'company' AND a.entity_id = c.id
               AND (a.alias_latin % $1 OR ($2 <> '' AND replace(a.alias_latin, ' ', '') LIKE $2 || '%'))
           )
           OR ($4::text IS NOT NULL AND c.tax_id = $4::text)
           -- Типизированный реестр реквизитов (этап 04): ИНН, ОГРН, ОГРНИП.
           OR ($4::text IS NOT NULL AND EXISTS (
             SELECT 1 FROM entity_identifiers i WHERE i.company_id = c.id AND i.value = $4::text AND i.status = 'active'))
         )
     ) found
     ORDER BY (score = 1) DESC, exact DESC, score DESC,
              coalesce(members, 0) + coalesce(projects, 0) + coalesce(publications, 0) DESC, name
     LIMIT $3`,
    [normalized.latin, normalized.key, parsed.data.limit, taxId],
  );

  res.json({ items: rows });
});

/** Профиль компании. Сигналы — отдельно (/:id/signals); старый индекс риска в карточку не входит. */
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
            is_verified AS "isVerified", merged_into_id AS "mergedIntoId",
            entity_type AS "entityType", version, name_pending AS "namePending"
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

  // Части карточки друг от друга не зависят — параллельно (07.10.2026): с ответа на этот запрос
  // экран начинает грузить остальные блоки.
  const [aliases, identifiers, relations, registry, { watch, egrul }] = await Promise.all([
    query<{ alias: string; hits: number }>(
      `SELECT alias, hits FROM entity_aliases
       WHERE entity_kind = 'company' AND entity_id = $1
       ORDER BY hits DESC LIMIT 10`,
      [id],
    ),
    // Реквизиты по типу с происхождением; явные связи (бренд, группа, правопреемник).
    query(
      `SELECT jurisdiction, identifier_type AS "type", value, validation_status AS "validationStatus", origin,
              source_revision_id AS "sourceRevisionId", valid_from AS "validFrom", valid_to AS "validTo"
       FROM entity_identifiers WHERE company_id = $1 AND status = 'active' ORDER BY identifier_type, id`,
      [id],
    ),
    query(
      `SELECT r.id, r.relation_type AS "relationType", r.status,
              CASE WHEN r.from_company_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction,
              c.id AS "otherCompanyId", c.name AS "otherCompanyName"
       FROM company_relations r
       JOIN companies c ON c.id = CASE WHEN r.from_company_id = $1 THEN r.to_company_id ELSE r.from_company_id END
       WHERE (r.from_company_id = $1 OR r.to_company_id = $1) AND r.status <> 'rejected'
       ORDER BY r.id`,
      [id],
    ),
    // Реестр: карточка застройщика (этап 20B). Его объекты — во вкладке «Объекты» и в «Сроках и продажах» по домам.
    loadCompanyRegistry(getPool(), id),
    // ADR-016: «На контроле» и наименование со статусом по ЕГРЮЛ (заголовок карточки); null — нет.
    loadCardExtras(getPool(), id),
  ]);
  res.json({ company, aliases, identifiers, relations, registry, watch, egrul });
});

/**
 * Объяснимые сигналы (этап 07): последний успешный снимок, срез, версия правил и признак устаревания.
 * Нет снимка — status not_computed, а не пустые «хорошие» значения.
 */
companiesRouter.get('/:id/signals', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const state = await refreshState();
  const row = state.active
    ? await queryOne<{ payload: unknown }>(
        'SELECT payload FROM company_signal_snapshots WHERE refresh_id = $1 AND company_id = $2',
        [state.active.id, id],
      )
    : null;
  res.json({
    status: !state.active ? 'not_computed' : row ? 'ok' : 'not_in_snapshot',
    refresh: state,
    signals: row?.payload ?? null,
  });
});

const contextSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  /** Явный срез (для воспроизводимости); по умолчанию — срез активного снимка или текущий момент. */
  cutoff: z.string().datetime({ offset: true }).optional(),
});

/** Контекст выбранного объекта: участие компании и события объекта с пересечением периодов. */
companiesRouter.get('/:id/context', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = contextSchema.safeParse(req.query);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Укажите projectId' });
    return;
  }
  const state = await refreshState();
  const cutoff = parsed.data.cutoff ? new Date(parsed.data.cutoff) : state.active ? new Date(state.active.cutoffAt) : new Date();
  res.json(await loadProjectContext(getPool(), id, parsed.data.projectId, cutoff));
});

/**
 * Объекты, связанные с компанией участием или событием. Событие без утверждения
 * об участии показывает объект в карточке, но не создаёт компании роль.
 */
companiesRouter.get('/:id/projects', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const rows = await query(
    `SELECT p.id, p.name, p.kind, p.stage, p.city,
            p.project_level AS "projectLevel", p.parent_project_id AS "parentProjectId",
            p.planned_completion AS "plannedCompletion",
            p.actual_completion  AS "actualCompletion",
            link.role, link.confidence, link.is_current AS "isCurrent",
            link.evidence_document_id AS "evidenceDocumentId", link.origin, link.assertion_id AS "assertionId",
            link.basis,
            -- контрагенты на том же объекте: кто ещё там работает
            (SELECT json_agg(json_build_object('id', c2.id, 'name', c2.name, 'role', pp2.role))
             FROM card_participations_v pp2
             JOIN companies c2 ON c2.id = pp2.company_id AND c2.merged_into_id IS NULL
             WHERE pp2.project_id = p.id AND pp2.company_id <> $1 AND pp2.is_current
            ) AS counterparties
     FROM (
       SELECT pp.project_id, pp.role, pp.confidence, pp.is_current, pp.evidence_document_id,
              pp.origin, pp.assertion_id, 'participation'::text AS basis
       FROM card_participations_v pp
       WHERE pp.company_id = $1
       UNION ALL
       SELECT DISTINCT e.project_id, NULL::text, NULL::numeric, NULL::boolean,
              NULL::bigint, 'event'::text, NULL::bigint, 'event'::text
       FROM card_events_v e
       WHERE e.company_id = $1 AND e.project_id IS NOT NULL AND e.status <> 'rejected'
         AND NOT EXISTS (
           SELECT 1 FROM card_participations_v pp
           WHERE pp.company_id = e.company_id AND pp.project_id = e.project_id
         )
     ) link
     JOIN projects p ON p.id = link.project_id AND p.merged_into_id IS NULL
     ORDER BY (link.basis = 'event'), link.is_current DESC NULLS LAST, p.stage, p.name`,
    [id],
  );

  res.json({ items: rows });
});

/**
 * Вкладка «Объекты»: объекты компании и застройщиков её группы со сводкой ДОМ.РФ (02.10.2026).
 * /projects остаётся для «Подробно» и прежних клиентов.
 */
companiesRouter.get('/:id/objects', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json(await loadCompanyObjects(id));
});

/** Сроки и продажи по снимкам ДОМ.РФ (этап 24E): по каждому дому, переносы срока и продажи между снимками. */
companiesRouter.get('/:id/delivery', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json(await loadCompanyDelivery(getPool(), id));
});

/** «Кто строит для компании» (этап 24D): генподрядчики из ДОМ.РФ и из публикаций на объектах заказчика. */
companiesRouter.get('/:id/builders', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json(await loadCompanyBuilders(id));
});

const publicationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(15),
  cursor: z.string().max(80).optional(),
});

/**
 * Лента публикаций о компании (этап 22): что о ней писали и что из этого взято в карточку.
 *
 * Заменяет для карточки ленту /mentions: та читает legacy-таблицу `mentions`, в которую
 * новый конвейер не пишет вовсе, поэтому на свежих данных она всегда пуста.
 */
companiesRouter.get('/:id/publications', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const parsed = publicationsSchema.safeParse(req.query);
  if (!Number.isFinite(id) || !parsed.success) {
    res.status(400).json({ error: 'Некорректные параметры' });
    return;
  }
  const page = await loadCompanyPublications(id, parsed.data.limit, parsed.data.cursor);
  res.json(page);
});

/**
 * Прямые связи компаний: договоры и корпоративные отношения с утверждением-основанием.
 * Совместное участие находится в списке объектов и не считается связью компаний.
 */
companiesRouter.get('/:id/partners', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  const limit = Number.parseInt(String(req.query.limit ?? '12'), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const items = await loadCompanyPartners(id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12);
  res.json({ items });
});

/**
 * События компании: проекция card_events_v (legacy + опубликованные утверждения). Последние 100 по дате события
 * (без даты — в конце) и общее число: до 05.10.2026 порядок был по severity, и при 100+ событиях «все события»
 * показывали самые тяжёлые, а плитка сводки — длину урезанного списка вместо числа.
 */
companiesRouter.get('/:id/events', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }

  const rows = await query<Record<string, unknown> & { total: number }>(
    `SELECT e.id, e.type, e.occurred_on AS "occurredOn", e.severity,
            e.amount_rub AS "amountRub", e.quote, e.confidence, e.status,
            p.id AS "projectId", p.name AS "projectName",
            cp.id AS "counterpartyId", cp.name AS "counterpartyName",
            d.url, s.title AS "sourceTitle", s.key AS "sourceKey", s.kind AS "sourceKind", e.origin,
            count(*) OVER ()::int AS total
     FROM card_events_v e
     LEFT JOIN projects  p  ON p.id  = e.project_id
     LEFT JOIN companies cp ON cp.id = e.counterparty_id
     LEFT JOIN raw_documents d ON d.id = e.document_id
     LEFT JOIN sources s ON s.id = d.source_id
     WHERE e.company_id = $1 AND e.status <> 'rejected'
     ORDER BY e.occurred_on DESC NULLS LAST, e.severity DESC, e.id DESC
     LIMIT ${EVENTS_LIMIT}`,
    [id],
  );

  const total = rows[0]?.total ?? 0;
  res.json({ items: rows.map(({ total: _total, ...row }) => row), total, truncated: total > rows.length });
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

  // Похожие по триграммам и ждущие пары очереди: «Sminex» и «Смайнекс» по триграммам не видят друг друга,
  // их пару ставит проход по звучанию (resolve/soundPairs.ts). Пара, которую модель назвала разными
  // компаниями, «возможно, это она же» не показывается; названная одной — первой и с вердиктом.
  const rows = await query(
    `WITH me AS (SELECT id, name_latin FROM companies WHERE id = $1 AND merged_into_id IS NULL),
     queued AS (
       SELECT CASE WHEN q.source_entity_id = me.id THEN q.target_entity_id ELSE q.source_entity_id END AS other_id,
              q.model_verdict
       FROM merge_queue q JOIN me ON me.id IN (q.source_entity_id, q.target_entity_id)
       WHERE q.entity_kind = 'company' AND q.status = 'pending'
     ),
     trgm AS (
       SELECT c2.id AS other_id, similarity(me.name_latin, c2.name_latin) AS score
       FROM me JOIN companies c2 ON c2.id <> me.id AND c2.merged_into_id IS NULL AND c2.name_latin % me.name_latin
       -- пары, уже разобранные вручную, показывать не нужно
       WHERE NOT EXISTS (
         SELECT 1 FROM merge_queue q
         WHERE q.entity_kind = 'company' AND q.status <> 'pending'
           AND least(q.source_entity_id, q.target_entity_id) = least(me.id, c2.id)
           AND greatest(q.source_entity_id, q.target_entity_id) = greatest(me.id, c2.id)
       )
     )
     SELECT c.id, c.name, c.city, c.tax_id AS "taxId", t.score, q.model_verdict AS "modelVerdict"
     FROM (SELECT other_id FROM queued UNION SELECT other_id FROM trgm) o
     JOIN companies c ON c.id = o.other_id AND c.merged_into_id IS NULL
     LEFT JOIN queued q ON q.other_id = o.other_id
     LEFT JOIN trgm t ON t.other_id = o.other_id
     WHERE q.model_verdict IS DISTINCT FROM 'different'
     ORDER BY (q.model_verdict = 'same') IS TRUE DESC, (q.other_id IS NOT NULL) DESC, t.score DESC NULLS LAST, c.id
     LIMIT 5`,
    [id],
  );

  res.json({ items: rows });
});
