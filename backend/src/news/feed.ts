// «Новое» на портале (этап 24F, news@1): что появилось за окно дней — считается на чтении из уже собранного.
//
//  new_project    — новый объект портала с названным заказчиком, застройщиком или инвестором (из публикации или ДОМ.РФ):
//                   к такому заказчику генподрядчик может выйти первым;
//  deadline_shift — срок сдачи дома ДОМ.РФ сменился между снимками (смена формата того же квартала — не перенос);
//  court_case     — в новом снимке картотеки появились дела, которых не было в прошлом снимке этой компании;
//  fssp           — то же для исполнительных производств ФССП;
//  bankruptcy     — компания появилась в ЕФРСБ или в списке её сообщений появилось новое «Сообщение о судебном акте»
//                   (bankruptcy-map@2). Первый список сообщений после снимка без них (bankruptcy-map@1) — начальная
//                   загрузка, а не новость; акт, чью карточку получили позже, — тоже не новость: сравнивается список.
// Первый снимок компании новостями не считается: это начальная загрузка, а не «появилось». Ленты в базе нет — второй
// источник правды о тех же фактах разошёлся бы с первым. «Просмотрено до» — в браузере читателя (localStorage):
// это его удобство, а не данные портала, и читатель по-прежнему ничего не записывает на сервер.
// Слова — фактами (ADR-009): «срок сдачи сменился», «новое дело», без оценок.

import type { DbExecutor } from '../db/pool.js';
import { domRfObjectUrl } from '../ingest/registry/domrfCards.js';
import type { IDatasetPayload } from '../parserApi/datasets.js';
import { mapCourts } from '../parserApi/map/courts.js';
import { efrsbMessageList, mapBankruptcy } from '../parserApi/map/bankruptcy.js';
import { fsspProceedings } from '../parserApi/map/fssp.js';
import { CUSTOMER_SIDE_ROLES } from '../api/companyBuilders.js';
import { HOUSE_LABELS } from '../registry/houses.js';
import { completionChange } from '../registry/values.js';

export const NEWS_VERSION = 'news@1';
export const NEWS_KINDS = ['new_project', 'deadline_shift', 'court_case', 'fssp', 'bankruptcy'] as const;
export type NewsKind = (typeof NEWS_KINDS)[number];
export type NewsScope = 'all' | 'watched';

/** Сторона заказчика (к ней генподрядчик и приходит) — то же множество ролей, что у «Кто строит» и «Сроков и продаж». */
const CUSTOMER_SIDE = CUSTOMER_SIDE_ROLES;
/** Новых объектов в окне — не больше: лента, а не каталог. */
const PROJECTS_LIMIT = 500;
/** Номеров дел/производств в подробностях одной новости. */
const NUMBERS_SHOWN = 3;

export interface INewsCompany {
  id: number;
  name: string;
  role: string | null;
}

export interface INewsItem {
  key: string;
  kind: NewsKind;
  /** Когда портал узнал: создание объекта или снимка. */
  at: string;
  title: string;
  detail: string | null;
  /** Суммы по строкам (производство ФССП — долг по документу) числом; текст денег — на экране, суммы не складываются. */
  amounts?: Array<{ label: string; rub: number | null }>;
  companies: INewsCompany[];
  project: { id: number; name: string } | null;
  /** Основание: публикация (id документа), страница ДОМ.РФ, раздел карточки компании. */
  source: { kind: 'publication' | 'registry' | 'kad' | 'fssp' | 'efrsb'; documentId: number | null; href: string | null };
  /** Касается компании «на контроле». */
  watched: boolean;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

interface IProjectRow {
  id: number;
  name: string;
  city: string | null;
  createdAt: Date;
  parts: Array<{ id: number; name: string; role: string; origin: string; doc: number | null }>;
}

const NEW_PROJECTS_SQL = `
  WITH recent AS MATERIALIZED (
    SELECT id, name, city, created_at FROM projects
    WHERE merged_into_id IS NULL AND created_at >= $1
    ORDER BY created_at DESC LIMIT $2
  ),
  parts AS MATERIALIZED (
    SELECT pp.project_id, pp.company_id, c.name, pp.role, pp.origin, pp.evidence_document_id
    FROM card_participations_v pp
    JOIN companies c ON c.id = pp.company_id AND c.merged_into_id IS NULL
    WHERE pp.project_id IN (SELECT id FROM recent) AND pp.role <> 'not_participant'
  )
  SELECT r.id, r.name, r.city, r.created_at AS "createdAt",
         coalesce(json_agg(json_build_object('id', p.company_id, 'name', p.name, 'role', p.role, 'origin', p.origin, 'doc', p.evidence_document_id))
                  FILTER (WHERE p.company_id IS NOT NULL), '[]') AS parts
  FROM recent r LEFT JOIN parts p ON p.project_id = r.id
  GROUP BY r.id, r.name, r.city, r.created_at
  ORDER BY r.created_at DESC`;

/** Новые объекты: в «все» — только с названной стороной заказчика; в «на контроле» — где участвует отмеченная компания. */
export const newProjectItems = (rows: readonly IProjectRow[], watched: ReadonlySet<number>, scope: NewsScope): INewsItem[] =>
  rows.flatMap((row): INewsItem[] => {
    const byCompany = new Map<number, INewsCompany>();
    for (const p of row.parts) if (!byCompany.has(p.id)) byCompany.set(p.id, { id: p.id, name: p.name, role: p.role });
    const companies = [...byCompany.values()].sort((a, b) => Number(CUSTOMER_SIDE.has(b.role ?? '')) - Number(CUSTOMER_SIDE.has(a.role ?? '')));
    const hasCustomer = companies.some(c => CUSTOMER_SIDE.has(c.role ?? ''));
    const isWatched = companies.some(c => watched.has(c.id));
    if (scope === 'all' ? !hasCustomer : !isWatched) return [];
    const docs = row.parts.filter(p => p.origin !== 'registry' && p.doc !== null).map(p => p.doc!);
    const fromRegistry = row.parts.length > 0 && row.parts.every(p => p.origin === 'registry');
    return [
      {
        key: `project:${row.id}`,
        kind: 'new_project',
        at: iso(row.createdAt),
        title: `Новый объект «${row.name}»${row.city ? `, ${row.city}` : ''}`,
        detail: null,
        companies,
        project: { id: row.id, name: row.name },
        source: { kind: fromRegistry ? 'registry' : 'publication', documentId: docs.length > 0 ? Math.min(...docs) : null, href: null },
        watched: isWatched,
      },
    ];
  });

interface IShiftRow {
  externalRef: string;
  projectId: number | null;
  projectName: string | null;
  name: string | null;
  fetchedAt: Date;
  completion: string;
  prev: string;
  /** Застройщик дома по снимку (registry_records.company_id) — как в «Сроках и продажах». */
  developerId: number | null;
  developerName: string | null;
}

// Снимки окна и по одному последнему до окна на дом (07.10.2026): lag по ним даёт тот же prev, что по всей истории,
// а JSON разбирается только у них. Раньше разбирались все снимки всех домов окна — при перечитывании карточек раз
// в 7 дней это почти весь реестр на каждый запрос ленты. Индексы — миграция 051.
const SHIFTS_SQL = `
  WITH houses AS (
    SELECT DISTINCT source_id, external_ref FROM registry_records WHERE record_type = 'object' AND fetched_at >= $1
  ),
  picked AS (
    SELECT r.id FROM registry_records r WHERE r.record_type = 'object' AND r.fetched_at >= $1
    UNION ALL
    SELECT b.id FROM houses h
    CROSS JOIN LATERAL (
      SELECT r.id FROM registry_records r
      WHERE r.record_type = 'object' AND r.source_id = h.source_id AND r.external_ref = h.external_ref AND r.fetched_at < $1
      ORDER BY r.fetched_at DESC, r.id DESC LIMIT 1
    ) b
  ),
  snaps AS (
    SELECT r.id, r.source_id, r.external_ref, r.project_id, r.company_id, r.fetched_at, r.payload->'identity'->>'name' AS name,
           -- Подпись срока — по приоритету общей таблицы (registry/houses.ts::HOUSE_LABELS.completion), как у карточки.
           (SELECT f->>'value' FROM jsonb_array_elements(r.payload->'fields') f
             WHERE f->>'label' = ANY($2::text[]) AND coalesce(f->>'value', '') <> ''
             ORDER BY array_position($2::text[], f->>'label') LIMIT 1) AS completion
    FROM registry_records r JOIN picked USING (id)
  ),
  ordered AS (
    SELECT *, lag(completion) OVER (PARTITION BY source_id, external_ref ORDER BY fetched_at, id) AS prev FROM snaps
  )
  SELECT o.external_ref AS "externalRef", o.project_id AS "projectId", p.name AS "projectName", o.name,
         o.fetched_at AS "fetchedAt", o.completion, o.prev, dev.id AS "developerId", dev.name AS "developerName"
  FROM ordered o
  LEFT JOIN projects p ON p.id = o.project_id
  LEFT JOIN companies dev0 ON dev0.id = o.company_id
  LEFT JOIN companies dev ON dev.id = coalesce(dev0.merged_into_id, dev0.id)
  WHERE o.fetched_at >= $1 AND o.prev IS NOT NULL AND o.completion IS NOT NULL AND o.prev <> o.completion`;

const DEVELOPERS_SQL = `
  SELECT DISTINCT pp.project_id AS "projectId", c.id, c.name, pp.role
  FROM card_participations_v pp JOIN companies c ON c.id = pp.company_id AND c.merged_into_id IS NULL
  WHERE pp.project_id = ANY($1::bigint[]) AND pp.role = ANY($2::text[])`;

export const shiftItems = (
  rows: readonly IShiftRow[],
  developers: ReadonlyMap<number, INewsCompany[]>,
  watched: ReadonlySet<number>,
  scope: NewsScope,
): INewsItem[] =>
  rows.flatMap((row): INewsItem[] => {
    // Тот же квартал другим форматом — не перенос: одно правило с «Сроками и продажами» (values.ts::completionChange).
    const change = completionChange(row.prev, row.completion);
    if (!change) return [];
    // Компании дома — как в «Сроках и продажах»: сторона заказчика на объекте и застройщик самого дома по снимку.
    const companies = [...(row.projectId !== null ? (developers.get(row.projectId) ?? []) : [])];
    if (row.developerId !== null && row.developerName && !companies.some(c => c.id === row.developerId)) {
      companies.push({ id: row.developerId, name: row.developerName, role: 'developer' });
    }
    const isWatched = companies.some(c => watched.has(c.id));
    if (scope === 'watched' && !isWatched) return [];
    const direction = change.direction === 'later' ? 'позже' : change.direction === 'earlier' ? 'раньше' : null;
    return [
      {
        key: `shift:${row.externalRef}:${iso(row.fetchedAt)}`,
        kind: 'deadline_shift',
        at: iso(row.fetchedAt),
        title: `Срок сдачи сменился: «${row.name ?? row.externalRef}»`,
        detail: `${row.prev} → ${row.completion}${direction ? ` (${direction})` : ''}`,
        companies,
        project: row.projectId !== null && row.projectName ? { id: row.projectId, name: row.projectName } : null,
        source: { kind: 'registry', documentId: null, href: domRfObjectUrl(row.externalRef) },
        watched: isWatched,
      },
    ];
  });

interface IRecordPairRow {
  inn: string;
  dataset: 'courts' | 'fssp' | 'bankruptcy';
  fetchedAt: Date;
  complete: boolean;
  payload: IDatasetPayload;
  prev: IDatasetPayload | null;
}

const RECORD_PAIRS_SQL = `
  SELECT r.inn, r.dataset, r.fetched_at AS "fetchedAt", r.complete, r.payload,
         (SELECT p.payload FROM parser_api_records p
           WHERE p.inn = r.inn AND p.dataset = r.dataset AND (p.fetched_at, p.id) < (r.fetched_at, r.id)
           ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1) AS prev
  FROM parser_api_records r
  WHERE r.dataset IN ('courts', 'fssp', 'bankruptcy') AND r.fetched_at >= $1
  ORDER BY r.fetched_at DESC`;

const COMPANIES_BY_INN_SQL = `
  SELECT DISTINCT ei.value AS inn, c.id, c.name
  FROM entity_identifiers ei JOIN companies c ON c.id = ei.company_id AND c.merged_into_id IS NULL
  WHERE ei.identifier_type = 'inn' AND ei.status = 'active' AND ei.validation_status = 'checksum_valid' AND ei.value = ANY($1::text[])`;


/** ЕФРСБ: появление компании или новые сообщения о судебных актах — заголовок и подробности; null — нового нет. */
export const efrsbItem = (prevPayload: IDatasetPayload, payload: IDatasetPayload): { title: string; detail: string | null } | null => {
  const prev = mapBankruptcy(prevPayload);
  const cur = mapBankruptcy(payload);
  if (!cur.found) return null;
  const actText = (a: { act: string | null; date: string | null }): string => `«${a.act ?? 'акт не указан'}»${a.date ? ` от ${a.date.split('-').reverse().join('.')}` : ''}`;
  if (!prev.found) {
    return { title: 'Компания появилась в ЕФРСБ', detail: cur.procedureAct ? `процедура по последнему акту: ${actText(cur.procedureAct)}` : null };
  }
  const before = efrsbMessageList(prevPayload);
  const now = efrsbMessageList(payload);
  if (!before || !now) return null;
  const known = new Set(before.map(m => m.id));
  const fresh = now.filter(m => m.id !== null && !m.annulled && m.kind === 'court_act' && !known.has(m.id));
  if (fresh.length === 0) return null;
  const acts = new Map((cur.courtActs ?? []).map(a => [a.messageId, a]));
  const described = fresh.map(m => acts.get(m.id!)).filter(a => a !== undefined);
  return {
    title: `ЕФРСБ: новые сообщения о судебных актах — ${fresh.length}`,
    detail: described.length > 0 ? `${described.slice(0, NUMBERS_SHOWN).map(actText).join('; ')}${described.length > NUMBERS_SHOWN ? ' и другие' : ''}` : null,
  };
};

/** Новые дела и производства — разница с прошлым снимком той же компании; первый снимок — не новость. */
export const recordItems = (
  rows: readonly IRecordPairRow[],
  byInn: ReadonlyMap<string, INewsCompany[]>,
  watched: ReadonlySet<number>,
  scope: NewsScope,
): INewsItem[] =>
  rows.flatMap((row): INewsItem[] => {
    if (!row.prev) return [];
    const companies = byInn.get(row.inn) ?? [];
    const isWatched = companies.some(c => watched.has(c.id));
    if (scope === 'watched' && !isWatched) return [];
    const at = iso(row.fetchedAt);
    const companyId = companies[0]?.id ?? null;
    const checksHref = companyId !== null ? `/company/${companyId}#company-checks` : null;
    if (row.dataset === 'bankruptcy') {
      const item = efrsbItem(row.prev, row.payload);
      return item
        ? [{ key: `efrsb:${row.inn}:${at}`, kind: 'bankruptcy', at, ...item, companies, project: null, source: { kind: 'efrsb', documentId: null, href: checksHref }, watched: isWatched }]
        : [];
    }
    if (row.dataset === 'courts') {
      const before = new Set(mapCourts(row.prev, null, true).cases.map(c => c.id ?? c.number));
      const fresh = mapCourts(row.payload, null, row.complete).cases.filter(c => !before.has(c.id ?? c.number));
      if (fresh.length === 0) return [];
      const respondent = fresh.filter(c => c.roles[0] === 'respondent').length;
      return [
        {
          key: `courts:${row.inn}:${at}`,
          kind: 'court_case',
          at,
          title: `Новые дела в картотеке: ${fresh.length}`,
          detail: `${fresh.slice(0, NUMBERS_SHOWN).map(c => c.number).join(', ')}${fresh.length > NUMBERS_SHOWN ? ' и другие' : ''}${respondent > 0 ? `; ответчик — в ${respondent}` : ''}`,
          companies,
          project: null,
          source: { kind: 'kad', documentId: null, href: checksHref },
          watched: isWatched,
        },
      ];
    }
    const before = new Set(fsspProceedings(row.prev).map(p => p.number));
    const fresh = fsspProceedings(row.payload).filter(p => !before.has(p.number));
    if (fresh.length === 0) return [];
    // Долг — по каждому производству отдельно, числом: суммы не складываются (ADR-009), текст денег — на экране.
    return [
      {
        key: `fssp:${row.inn}:${at}`,
        kind: 'fssp',
        at,
        title: `Новые исполнительные производства: ${fresh.length}`,
        detail: fresh.length > NUMBERS_SHOWN ? 'и другие' : null,
        amounts: fresh.slice(0, NUMBERS_SHOWN).map(p => ({ label: p.number, rub: p.debt ?? null })),
        companies,
        project: null,
        source: { kind: 'fssp', documentId: null, href: checksHref },
        watched: isWatched,
      },
    ];
  });

export interface INewsFeed {
  format: typeof NEWS_VERSION;
  since: string;
  scope: NewsScope;
  items: INewsItem[];
  counts: Record<NewsKind, number>;
}

/** Лента за окно: все виды, новые сверху. kinds — фильтр вида; счётчики — по всем видам окна. */
export const loadNews = async (db: DbExecutor, options: { since: Date; scope: NewsScope; kinds?: readonly NewsKind[] }): Promise<INewsFeed> => {
  const { since, scope } = options;
  const watched = new Set(
    (await db.query<{ companyId: number }>(`SELECT company_id AS "companyId" FROM company_watch WHERE removed_at IS NULL`)).rows.map(r => r.companyId),
  );
  const [projects, shifts, pairs] = await Promise.all([
    db.query<IProjectRow>(NEW_PROJECTS_SQL, [since, PROJECTS_LIMIT]),
    db.query<IShiftRow>(SHIFTS_SQL, [since, [...HOUSE_LABELS.completion]]),
    db.query<IRecordPairRow>(RECORD_PAIRS_SQL, [since]),
  ]);

  const shiftProjects = [...new Set(shifts.rows.map(r => r.projectId).filter((id): id is number => id !== null))];
  const developers = new Map<number, INewsCompany[]>();
  if (shiftProjects.length > 0) {
    for (const r of (await db.query<{ projectId: number; id: number; name: string; role: string }>(DEVELOPERS_SQL, [shiftProjects, [...CUSTOMER_SIDE]])).rows) {
      const list = developers.get(r.projectId) ?? [];
      if (!list.some(c => c.id === r.id)) list.push({ id: r.id, name: r.name, role: r.role });
      developers.set(r.projectId, list);
    }
  }
  const inns = [...new Set(pairs.rows.map(r => r.inn))];
  const byInn = new Map<string, INewsCompany[]>();
  if (inns.length > 0) {
    for (const r of (await db.query<{ inn: string; id: number; name: string }>(COMPANIES_BY_INN_SQL, [inns])).rows) {
      byInn.set(r.inn, [...(byInn.get(r.inn) ?? []), { id: r.id, name: r.name, role: null }]);
    }
  }

  // При равном времени — по ключу: порядок строк из базы не задан, и лента не должна переставляться между запросами.
  const all = [
    ...newProjectItems(projects.rows, watched, scope),
    ...shiftItems(shifts.rows, developers, watched, scope),
    ...recordItems(pairs.rows, byInn, watched, scope),
  ].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
  const counts = Object.fromEntries(NEWS_KINDS.map(k => [k, all.filter(i => i.kind === k).length])) as Record<NewsKind, number>;
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  return { format: NEWS_VERSION, since: since.toISOString(), scope, items: kinds ? all.filter(i => kinds.has(i.kind)) : all, counts };
};
