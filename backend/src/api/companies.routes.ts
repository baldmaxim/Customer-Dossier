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
import { loadCompanyCounters } from '../companies/counters.js';
import { loadGroupHeads, loadGroupMembers } from '../companies/groupMembership.js';
import { loadCompanyBuilders } from './companyBuilders.js';
import { loadEgrulNames } from './companyCatalog.js';
import { loadCompanyDelivery } from '../registry/delivery.js';
import { loadCompanyObjects } from './companyObjects.js';
import { loadCompanyPartners } from './companyPartners.js';
import { loadCompanyPublications } from './companyPublications.js';
import { loadEventStats, loadPublicationStats } from './companyStats.js';
import { loadCompanyRegistry } from '../registry/read.js';
import { loadProjectContext } from '../signals/context.js';
import { refreshState } from '../signals/refresh.js';

export const companiesRouter = asyncRouter();

/** Событий в карточке — не больше; общее число отдаётся отдельно (total). */
const EVENTS_LIMIT = 100;

/** Кандидатов берём с запасом: порядок внутри совпадения — по полноте карточки, а она считается после отбора. */
const SEARCH_OVERFETCH = 3;
const SEARCH_CANDIDATES_MAX = 150;

interface ISearchRow {
  id: number;
  name: string;
  city: string | null;
  legalForm: string | null;
  entityType: string;
  identifiers: string[];
  registryGroup: string | null;
  registryAddress: string | null;
  matchedAlias: string | null;
  homonyms: number;
  exact: boolean;
  score: number;
}

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

  // Кандидаты — с запасом: порядок внутри одинакового совпадения — по полноте карточки, а её числа считаются ниже.
  const candidates = await query<ISearchRow>(
    // Кандидаты с контекстом для осознанного выбора (этап 08A): вид сущности, реквизиты, совпавший алиас.
    // Одноимённые юрлица различаются реквизитами, а не порядком строк; с 02.10.2026 — ещё группой и юридическим
    // адресом со страницы застройщика ДОМ.РФ и группой, в которую компания входит: четыре «СЗ ДОНСТРОЙ» из Самары,
    // Иркутска и Ростова иначе неотличимы. Порядок: совпадение по началу названия — раньше похожих по написанию,
    // внутри — более полные карточки.
    `SELECT * FROM (
       SELECT c.id, c.name, c.city, c.legal_form AS "legalForm", c.entity_type AS "entityType",
              coalesce((SELECT array_agg(i.identifier_type || ' ' || i.value ORDER BY i.id) FROM entity_identifiers i
                        WHERE i.company_id = c.id AND i.status = 'active'), '{}') AS identifiers,
              reg.group_name AS "registryGroup", reg.address AS "registryAddress",
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
     ORDER BY (score = 1) DESC, exact DESC, score DESC, name
     LIMIT $3`,
    [normalized.latin, normalized.key, Math.min(parsed.data.limit * SEARCH_OVERFETCH, SEARCH_CANDIDATES_MAX), taxId],
  );

  // Числа, группа и наименование — общими правилами (07.10.2026): объекты и публикации — как каталог и вкладки карточки
  // (companies/counters.ts, с семьёй), группа — companies/groupMembership.ts, имя — по ЕГРЮЛ, как заголовок карточки.
  // Раньше числа брались из снимка показателей (на дату расчёта, без семьи), и у одной компании в поиске и каталоге
  // стояли разные числа.
  const ids = candidates.map(c => c.id);
  const [counters, heads, members, egrul] = await Promise.all([
    loadCompanyCounters(getPool(), ids),
    loadGroupHeads(getPool(), ids),
    loadGroupMembers(getPool(), ids),
    loadEgrulNames(ids),
  ]);
  const memberOf = new Map<number, string[]>();
  for (const h of heads) memberOf.set(h.member, [...new Set([...(memberOf.get(h.member) ?? []), h.name])]);
  const memberCount = new Map<number, Set<number>>();
  for (const m of members) memberCount.set(m.head, (memberCount.get(m.head) ?? new Set()).add(m.member));

  const items = candidates.map(c => {
    const counts = counters.get(c.id);
    return {
      ...c,
      egrulName: egrul.get(c.id)?.name ?? null,
      egrulStatus: egrul.get(c.id)?.status ?? null,
      projects: counts?.objects ?? 0,
      publications: counts?.publications ?? 0,
      memberOf: memberOf.get(c.id)?.join(', ') ?? null,
      members: memberCount.get(c.id)?.size ?? 0,
    };
  });
  const weight = (i: (typeof items)[number]): number => i.members + i.projects + i.publications;
  items.sort((a, b) => Number(b.score === 1) - Number(a.score === 1) || Number(b.exact) - Number(a.exact) || b.score - a.score || weight(b) - weight(a) || a.name.localeCompare(b.name, 'ru'));

  res.json({ items: items.slice(0, parsed.data.limit) });
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

/** Итоги ленты публикаций (тот же набор, что лента и каталог): число, 90 дней, последняя, тексты, ряд по месяцам. */
companiesRouter.get('/:id/publication-stats', async (req, res) => {
  const id = Number.parseInt(req.params.id ?? '', 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  res.json(await loadPublicationStats(id));
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
  res.json(await loadCompanyPartners(id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 12));
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
  // Итоги — по тому же набору, что список (плитка «События», виды и ряд по месяцам), а не снимком показателей.
  const stats = await loadEventStats(id);
  res.json({ items: rows.map(({ total: _total, ...row }) => row), total, truncated: total > rows.length, stats });
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
