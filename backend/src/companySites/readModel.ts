// Проекты с сайта компании для карточки (этап 25B): что последний проход нашёл на страницах подтверждённых сайтов
// и есть ли это на портале. Считается на чтении (как разница снимков реестра), отдельной таблицы нет.
//
// Страницы — последний снимок каждого адреса из последнего удачного прохода: страница, которую сайт убрал, со
// снимком не исчезает, но в прочитанные этим проходом не входит. Проекты — последний принятый ответ модели по
// странице. «Впервые на сайте» — самый ранний ответ с этим проектом по всем снимкам сайта. Совпадение с порталом —
// по ключу названия (normalizeName, 'project'): точно или одно начинается с другого (как loadRegistryLookalikes).

import { loadCompanyObjects } from '../api/companyObjects.js';
import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import type { ISiteProject, SiteProjectStatus } from '../llm/siteProjects/schema.js';
import { sitePhotoViews, type ISitePhotoView } from './photos.js';
import { latestSitePages, projectKey } from './projects.js';

/** «Новое» — впервые увиденное на сайте за столько дней и отсутствующее на портале. */
export const NEW_PROJECT_DAYS = 90;

/** Префиксное совпадение — только для ключей не короче: «Дом» не равен «Домашний квартал». */
const PREFIX_MIN_KEY = 4;

export interface ISiteProjectSighting {
  project: ISiteProject;
  pageUrl: string;
  pageTitle: string | null;
  /** Когда снят снимок страницы, где проект найден. */
  seenAt: string;
  /** Самый ранний ответ модели с этим проектом по всем снимкам сайта. */
  firstSeenAt: string;
  host: string;
  /** Фото проекта с этого сайта (photos.ts); null — не нашлось или ещё не скачано. */
  photo: ISitePhotoView | null;
}

export interface IPortalObject {
  projectId: number;
  name: string;
}

export interface ICompanySiteProjectRow {
  name: string;
  status: SiteProjectStatus;
  completion: string | null;
  city: string | null;
  address: string | null;
  quote: string;
  host: string;
  pageUrl: string;
  pageTitle: string | null;
  seenAt: string;
  firstSeenAt: string;
  /** Нет на портале и впервые на сайте не раньше NEW_PROJECT_DAYS дней назад. */
  isNew: boolean;
  /** Объект портала с тем же названием; null — на портале его нет. */
  match: IPortalObject | null;
  /** Фото с сайта компании: GET /api/site-photos/:sourceId/:id. */
  photo: ISitePhotoView | null;
}

const keysMatch = (a: string, b: string): boolean =>
  a === b || (a.length >= PREFIX_MIN_KEY && b.length >= PREFIX_MIN_KEY && (a.startsWith(b) || b.startsWith(a)));

/** Подробнее — значит полезнее оператору: известный статус, срок, город, адрес. */
const detail = (p: ISiteProject): number =>
  (p.status !== 'unknown' ? 2 : 0) + (p.completion ? 2 : 0) + (p.city ? 1 : 0) + (p.address ? 1 : 0);

/**
 * Сверка проектов сайта с объектами портала. Один проект на нескольких страницах — одна строка (подробнейшая,
 * с самым ранним «впервые»). Порядок: новые, затем без пары на портале, затем остальные, внутри — по названию.
 */
export const classifyProjects = (sightings: readonly ISiteProjectSighting[], portal: readonly IPortalObject[], now: Date = new Date()): ICompanySiteProjectRow[] => {
  const byKey = new Map<string, ISiteProjectSighting>();
  for (const s of sightings) {
    const key = projectKey(s.project.name);
    if (key === '') continue;
    const known = byKey.get(key);
    if (!known) {
      byKey.set(key, s);
      continue;
    }
    const best = detail(s.project) > detail(known.project) ? s : known;
    byKey.set(key, {
      ...best,
      firstSeenAt: s.firstSeenAt < known.firstSeenAt ? s.firstSeenAt : known.firstSeenAt,
      photo: best.photo ?? (best === s ? known.photo : s.photo),
    });
  }
  const portalKeys = portal.map(o => ({ object: o, key: projectKey(o.name) })).filter(o => o.key !== '');
  const newSince = now.getTime() - NEW_PROJECT_DAYS * 24 * 60 * 60 * 1000;
  const rows = [...byKey.entries()].map(([key, s]): ICompanySiteProjectRow => {
    const match = portalKeys.find(o => keysMatch(o.key, key))?.object ?? null;
    return {
      name: s.project.name,
      status: s.project.status,
      completion: s.project.completion,
      city: s.project.city,
      address: s.project.address,
      quote: s.project.quote,
      host: s.host,
      pageUrl: s.pageUrl,
      pageTitle: s.pageTitle,
      seenAt: s.seenAt,
      firstSeenAt: s.firstSeenAt,
      isNew: match === null && new Date(s.firstSeenAt).getTime() >= newSince,
      match,
      photo: s.photo,
    };
  });
  const rank = (r: ICompanySiteProjectRow): number => (r.isNew ? 0 : r.match === null ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ru'));
};

export interface ICompanySiteRead {
  host: string;
  url: string;
  status: 'active' | 'paused' | 'broken';
  health: string | null;
  healthReason: string | null;
  lastReadAt: string | null;
  /** Страниц, прочитанных последним удачным проходом. */
  pages: number;
}

export interface ICompanySiteProjects {
  sites: ICompanySiteRead[];
  projects: ICompanySiteProjectRow[];
  /** Страниц последнего прохода, которые модель ещё не разбирала. */
  waiting: number;
}

interface ISiteRow {
  host: string;
  url: string;
  sourceId: number;
  status: ICompanySiteRead['status'];
  health: string | null;
  healthReason: string | null;
  lastOkAt: string | null;
}

const toIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export const loadCompanySiteProjects = async (companyId: number, now: Date = new Date(), photoDir: string = env.SITE_PHOTO_DIR): Promise<ICompanySiteProjects> => {
  const sites = await query<ISiteRow>(
    `SELECT DISTINCT ON (k.source_id) k.host, k.url, k.source_id AS "sourceId", s.status, s.health,
            s.health_reason AS "healthReason", s.last_ok_at AS "lastOkAt"
     FROM company_site_candidates k JOIN sources s ON s.id = k.source_id
     WHERE k.company_id = $1 AND k.state = 'confirmed'
     ORDER BY k.source_id, k.id`,
    [companyId],
  );
  const sightings: ISiteProjectSighting[] = [];
  const reads: ICompanySiteRead[] = [];
  let waiting = 0;
  for (const site of sites) {
    const run = await queryOne<{ coverage: { pages?: unknown } | null }>(
      `SELECT coverage FROM source_runs WHERE source_id = $1 AND outcome IN ('ok', 'partial') ORDER BY started_at DESC LIMIT 1`,
      [site.sourceId],
    );
    const urls = Array.isArray(run?.coverage?.pages) ? (run.coverage.pages as unknown[]).filter((u): u is string => typeof u === 'string') : [];
    reads.push({
      host: site.host,
      url: site.url,
      status: site.status,
      health: site.health,
      healthReason: site.healthReason,
      lastReadAt: site.lastOkAt ? toIso(site.lastOkAt) : null,
      pages: urls.length,
    });
    if (urls.length === 0) continue;
    const pages = await latestSitePages(site.sourceId, urls);
    waiting += pages.filter(p => !p.extracted).length;
    // «Впервые на сайте» — по всем принятым ответам по этому сайту, со всех снимков.
    const history = await query<{ projects: ISiteProject[]; createdAt: Date }>(
      `SELECT e.projects, e.created_at AS "createdAt"
       FROM company_site_extractions e JOIN company_site_pages p ON p.id = e.page_id
       WHERE p.source_id = $1 AND e.outcome = 'ok'`,
      [site.sourceId],
    );
    const first = new Map<string, string>();
    for (const row of history) {
      const at = toIso(row.createdAt);
      for (const project of row.projects) {
        const key = projectKey(project.name);
        const known = first.get(key);
        if (!known || at < known) first.set(key, at);
      }
    }
    const photos = sitePhotoViews(site.sourceId, photoDir);
    for (const page of pages) {
      for (const project of page.projects ?? []) {
        sightings.push({
          project,
          pageUrl: page.url,
          pageTitle: page.title,
          seenAt: toIso(page.fetchedAt),
          firstSeenAt: first.get(projectKey(project.name)) ?? toIso(page.fetchedAt),
          host: site.host,
          photo: photos.get(projectKey(project.name)) ?? null,
        });
      }
    }
  }
  if (sightings.length === 0) return { sites: reads, projects: [], waiting };
  const objects = await loadCompanyObjects(companyId);
  return {
    sites: reads,
    projects: classifyProjects(
      sightings,
      objects.items.map(o => ({ projectId: o.projectId, name: o.name })),
      now,
    ),
    waiting,
  };
};
