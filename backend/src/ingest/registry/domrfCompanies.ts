// Компании портала в едином реестре застройщиков ДОМ.РФ (этап 20D, шаг 2, миграция 037).
//
// Ищется каждая компания портала, в порядке пользы: заказчики и застройщики, затем с ИНН/ОГРН, группы и
// бренды, остальные участники, остальные. По ИНН/ОГРН выдача — ровно застройщик и его группа; по названию
// шире («Донстрой» даёт две разные группы и несколько СЗ), поэтому из неё предлагается только то, что
// совпадает с названием компании без общих слов (nameCore). Найденное — предложения: оператор подтверждает
// «это он» или отклоняет. Подтверждённая страница уходит в очередь чтения (domrf_cards), её объекты —
// кандидатами, как на шаге 1. Отклонённое при повторном поиске не возвращается.

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { query, withTransaction } from '../../db/pool.js';
import { normalizeName } from '../../resolve/normalize.js';
import { likePattern } from '../../utils/likePattern.js';
import { DOMRF_HOST, domRfCardUrl as domRfCardUrlOf, ensureDomRfCard, type DomRfCardKind } from './domrfCards.js';

/** Повторный поиск компании: реестр пополняется, а новые сведения о компаниях приходят из новостей. */
export const SEARCH_TTL_DAYS = 30;

/** Сколько компаний с общими названиями пометить за одно взятие, прежде чем отдать проход следующему. */
const CLAIM_SKIP_MAX = 50;

/** Сколько первых результатов выдачи предлагать: дальше по названию — шум. */
export const SEARCH_RESULTS_MAX = 10;

/**
 * Общие слова названий в реестре (латиница нормализатора): по ним совпадает кто угодно, отличают компанию
 * остальные слова. «Группа» — тоже: «MR Group» и «МР ГРУПП» сводятся к «mr».
 */
const GENERIC_WORDS = new Set(['sz', 'spetsializirovannyi', 'zastroischik', 'group', 'kompanii', 'company', 'gk', 'uk', 'kholding', 'i']);

/** Ядро названия: латиница нормализатора портала (ОПФ и кавычки сняты, «МР ГРУПП» = «MR Group») без общих слов. */
export const nameCore = (name: string): string[] =>
  normalizeName(name).latin.split(' ').filter(word => word !== '' && !GENERIC_WORDS.has(word));

/**
 * Результат поиска по названию годится в предложения, если ядро одного названия целиком входит в ядро
 * другого: к «Донстрой» — «СЗ ДОНСТРОЙ» и «Группа компаний «ДОНСТРОЙ»», но не «Новый ДОН».
 */
export const matchesByName = (companyName: string, resultName: string | null): boolean => {
  const company = nameCore(companyName);
  const result = resultName ? nameCore(resultName) : [];
  if (company.length === 0 || result.length === 0) return false;
  const inside = (small: string[], big: string[]): boolean => small.every(word => big.includes(word));
  return inside(company, result) || inside(result, company);
};

/** Название, по которому искать бессмысленно: после общих слов осталось меньше двух букв («СЗ», «ГК»). */
export const tooGenericToSearch = (name: string): boolean => nameCore(name).join('').length < 2;

/** Пометка вместо поиска: оператор видит, почему компания не искалась, и может указать страницу сам. */
export const GENERIC_NAME_ERROR = 'название без отличительных слов — укажите страницу вручную';

export const domRfSearchUrl = (text: string): string => {
  const url = new URL('/сервисы/единый-реестр-застройщиков', `https://${DOMRF_HOST}`);
  url.searchParams.set('search', text);
  return url.toString();
};

const searchSchema = z
  .object({
    format: z.literal('domrf-search-browser@1'),
    url: z.string().url(),
    results: z
      .array(
        z
          .object({
            kind: z.enum(['developer', 'group']),
            ref: z.string().regex(/^[0-9]{1,18}$/),
            name: z.string().trim().max(300).nullable(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export type IDomRfSearchCapture = z.infer<typeof searchSchema>;

export const parseDomRfSearchCapture = (body: unknown): IDomRfSearchCapture => {
  const search = searchSchema.parse(body);
  if (new URL(search.url).hostname !== DOMRF_HOST) throw new Error('адрес не принадлежит наш.дом.рф');
  return search;
};

/** Страница реестра по ссылке оператора: застройщик или группа компаний. */
export const parseDomRfCardUrl = (raw: string): { kind: DomRfCardKind; externalRef: string } => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DomRfCompanyError('Укажите полную ссылку на страницу застройщика или группы компаний', 'invalid');
  }
  if (url.protocol !== 'https:' || url.hostname !== DOMRF_HOST) {
    throw new DomRfCompanyError('Допустимы только HTTPS-ссылки на наш.дом.рф', 'invalid');
  }
  const match = /^\/сервисы\/единый-реестр-застройщиков\/(застройщик|группа-компаний)\/(\d{1,18})\/?$/.exec(decodeURIComponent(url.pathname));
  if (!match) {
    throw new DomRfCompanyError('Нужна ссылка вида наш.дом.рф/сервисы/единый-реестр-застройщиков/застройщик/14929', 'invalid');
  }
  return { kind: match[1] === 'застройщик' ? 'developer' : 'group', externalRef: match[2]! };
};

export class DomRfCompanyError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'already_decided' | 'invalid',
  ) {
    super(message);
    this.name = 'DomRfCompanyError';
  }
}

// ─── Очередь поиска ─────────────────────────────────────────────────────────────────────────

export interface IDomRfCompanyToSearch {
  companyId: number;
  name: string;
  query: string;
  foundBy: 'inn' | 'name';
  attemptCount: number;
}

/** Действующий ИНН (иначе ОГРН) с верной контрольной суммой — им ищется точнее, чем названием. */
const TAX_ID_SQL = `(SELECT ei.value FROM entity_identifiers ei
   WHERE ei.company_id = c.id AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
     AND ei.identifier_type IN ('inn', 'ogrn')
   ORDER BY (ei.identifier_type = 'inn') DESC, ei.id LIMIT 1)`;

/** Текущие роли компаний на объектах: заказчики и застройщики ищутся первыми. */
const ROLES_SQL = `SELECT company_id, array_agg(DISTINCT role ORDER BY role) AS roles FROM card_participations_v WHERE is_current GROUP BY company_id`;

/**
 * Следующая компания к поиску: ещё не искали или срок вышел, и нет подтверждённой страницы. Сначала —
 * чей срок пришёл («Искать снова», повтор после ошибки, месячный пересмотр), затем ещё не искавшиеся
 * по пользе: заказчики и застройщики, с реквизитом, группы и бренды, остальные участники, остальные.
 * Название без отличительных слов не ищется — помечается для оператора. Аренда — next_search_at на
 * 10 минут вперёд; строки компаний не блокируются: работник один.
 */
export const claimDomRfCompanySearch = async (): Promise<IDomRfCompanyToSearch | null> =>
  withTransaction(async client => {
    for (let skipped = 0; skipped < CLAIM_SKIP_MAX; skipped += 1) {
      const row = (
        await client.query<{ company_id: number; name: string; tax_id: string | null; attempt_count: number | null }>(
          `WITH roles AS (${ROLES_SQL})
           SELECT c.id AS company_id, c.name, ${TAX_ID_SQL} AS tax_id, s.attempt_count
           FROM companies c
           LEFT JOIN domrf_company_searches s ON s.company_id = c.id
           LEFT JOIN roles r ON r.company_id = c.id
           WHERE c.merged_into_id IS NULL
             AND (s.company_id IS NULL OR s.next_search_at <= now())
             AND NOT EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'confirmed')
           ORDER BY s.next_search_at NULLS LAST,
                    coalesce(r.roles && ARRAY['customer', 'developer'], false) DESC,
                    (${TAX_ID_SQL} IS NOT NULL) DESC,
                    (c.entity_type IN ('group', 'brand')) DESC,
                    (r.company_id IS NOT NULL) DESC,
                    c.id
           LIMIT 1`,
        )
      ).rows[0];
      if (!row) return null;
      if (!row.tax_id && tooGenericToSearch(row.name)) {
        await client.query(
          `INSERT INTO domrf_company_searches (company_id, query, found_by, searched_at, next_search_at, last_error)
           VALUES ($1, $2, 'name', now(), now() + ($3::int * interval '1 day'), $4)
           ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, found_by = EXCLUDED.found_by, result_count = 0,
             searched_at = now(), next_search_at = EXCLUDED.next_search_at, attempt_count = 0, last_error = EXCLUDED.last_error, updated_at = now()`,
          [row.company_id, row.name, SEARCH_TTL_DAYS, GENERIC_NAME_ERROR],
        );
        continue;
      }
      const foundBy: 'inn' | 'name' = row.tax_id ? 'inn' : 'name';
      const text = row.tax_id ?? row.name;
      await client.query(
        `INSERT INTO domrf_company_searches (company_id, query, found_by, next_search_at, attempt_count)
         VALUES ($1, $2, $3, now() + interval '10 minutes', 1)
         ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, found_by = EXCLUDED.found_by,
           next_search_at = EXCLUDED.next_search_at, attempt_count = domrf_company_searches.attempt_count + 1, updated_at = now()`,
        [row.company_id, text, foundBy],
      );
      return { companyId: row.company_id, name: row.name, query: text, foundBy, attemptCount: (row.attempt_count ?? 0) + 1 };
    }
    return null;
  });

export const failDomRfCompanySearch = async (companyId: number, error: string, attempts: number): Promise<void> => {
  const delayMinutes = Math.min(24 * 60, 15 * 2 ** Math.min(attempts, 6));
  await query(
    `UPDATE domrf_company_searches SET last_error = $2, next_search_at = now() + ($3::int * interval '1 minute'), updated_at = now()
     WHERE company_id = $1`,
    [companyId, error.slice(0, 1000), delayMinutes],
  );
};

/**
 * Выдача поиска: по реквизиту — первые SEARCH_RESULTS_MAX, по названию — только совпавшие с названием
 * компании (matchesByName). Решения оператора не перезаписываются.
 */
export const saveDomRfCompanySearch = async (company: IDomRfCompanyToSearch, search: IDomRfSearchCapture): Promise<number> =>
  withTransaction(async client => {
    const relevant = company.foundBy === 'inn' ? search.results : search.results.filter(r => matchesByName(company.name, r.name));
    const results = relevant.slice(0, SEARCH_RESULTS_MAX);
    await client.query(
      `UPDATE domrf_company_searches SET result_count = $2, searched_at = now(),
         next_search_at = now() + ($3::int * interval '1 day'), attempt_count = 0, last_error = NULL, updated_at = now()
       WHERE company_id = $1`,
      [company.companyId, search.results.length, SEARCH_TTL_DAYS],
    );
    let inserted = 0;
    for (const [rank, result] of results.entries()) {
      const row = await client.query<{ inserted: boolean }>(
        `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, found_by, rank)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id, kind, external_ref) DO UPDATE SET
           name = coalesce(EXCLUDED.name, domrf_company_links.name), rank = EXCLUDED.rank, last_seen_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [company.companyId, result.kind, result.ref, result.name, company.foundBy, rank + 1],
      );
      if (row.rows[0]?.inserted) inserted += 1;
    }
    return inserted;
  });

// ─── Решения оператора ──────────────────────────────────────────────────────────────────────

const lockLink = async (client: PoolClient, id: number): Promise<{ kind: DomRfCardKind; external_ref: string; state: string }> => {
  const row = (
    await client.query<{ kind: DomRfCardKind; external_ref: string; state: string }>(
      'SELECT kind, external_ref, state FROM domrf_company_links WHERE id = $1 FOR UPDATE',
      [id],
    )
  ).rows[0];
  if (!row) throw new DomRfCompanyError(`Совпадение №${id} не найдено`, 'not_found');
  return row;
};

/** «Это он»: страница реестра — в очередь чтения, её объекты придут кандидатами. */
export const confirmDomRfCompanyLink = async (id: number, actor: string): Promise<void> => {
  const link = await withTransaction(async client => {
    const row = await lockLink(client, id);
    if (row.state === 'confirmed') throw new DomRfCompanyError('Совпадение уже подтверждено', 'already_decided');
    await client.query(`UPDATE domrf_company_links SET state = 'confirmed', decided_by = $2, decided_at = now() WHERE id = $1`, [id, actor]);
    return row;
  });
  await ensureDomRfCard(link.kind, link.external_ref);
};

/** «Не он»: не возвращается при повторном поиске. Подтверждённое отменяется так же — страница остаётся прочитанной. */
export const rejectDomRfCompanyLink = async (id: number, actor: string): Promise<void> => {
  await withTransaction(async client => {
    const row = await lockLink(client, id);
    if (row.state === 'rejected') throw new DomRfCompanyError('Совпадение уже отклонено', 'already_decided');
    await client.query(`UPDATE domrf_company_links SET state = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [id, actor]);
  });
};

/** «Указать вручную»: страница застройщика или группы по ссылке оператора — сразу подтверждённой. */
export const linkDomRfCompanyManually = async (companyId: number, url: string, actor: string): Promise<void> => {
  const card = parseDomRfCardUrl(url);
  await withTransaction(async client => {
    const company = (await client.query<{ merged_into_id: number | null }>('SELECT merged_into_id FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company) throw new DomRfCompanyError(`Компания №${companyId} не найдена`, 'not_found');
    if (company.merged_into_id !== null) throw new DomRfCompanyError(`Компания №${companyId} объединена с №${company.merged_into_id}`, 'invalid');
    await client.query(
      `INSERT INTO domrf_company_links (company_id, kind, external_ref, found_by, state, decided_by, decided_at)
       VALUES ($1, $2, $3, 'manual', 'confirmed', $4, now())
       ON CONFLICT (company_id, kind, external_ref) DO UPDATE SET state = 'confirmed', decided_by = $4, decided_at = now()`,
      [companyId, card.kind, card.externalRef, actor],
    );
  });
  await ensureDomRfCard(card.kind, card.externalRef);
};

/**
 * «Искать снова» / «Искать сейчас»: компания встаёт в начало очереди, а не через месяц и не после
 * тысяч ещё не искавшихся. Строка поиска и реквизит выбираются при взятии, здесь — только срок.
 */
export const requestDomRfCompanySearch = async (companyId: number): Promise<boolean> =>
  (
    await query(
      `INSERT INTO domrf_company_searches (company_id, query, found_by, next_search_at)
       SELECT c.id, c.name, 'name', now() FROM companies c WHERE c.id = $1 AND c.merged_into_id IS NULL
       ON CONFLICT (company_id) DO UPDATE SET next_search_at = now(), attempt_count = 0, last_error = NULL, updated_at = now()
       RETURNING company_id`,
      [companyId],
    )
  ).length > 0;

// ─── Список для экрана ──────────────────────────────────────────────────────────────────────

export interface IDomRfCompanyLink {
  id: number;
  kind: DomRfCardKind;
  externalRef: string;
  url: string;
  name: string | null;
  foundBy: 'inn' | 'name' | 'manual';
  rank: number | null;
  state: 'pending' | 'confirmed' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface IDomRfCompanyRow {
  companyId: number;
  name: string;
  roles: string[];
  query: string | null;
  foundBy: 'inn' | 'name' | null;
  searchedAt: string | null;
  resultCount: number | null;
  lastError: string | null;
  links: IDomRfCompanyLink[];
}

export interface IDomRfCompaniesTotals {
  companies: number;
  searched: number;
  withPending: number;
  confirmed: number;
  notFound: number;
}

export type DomRfCompanyFilter = 'pending' | 'notFound' | 'confirmed' | 'all';

const HAS_PENDING = `EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'pending')`;
const HAS_CONFIRMED = `EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'confirmed')`;
const NOT_FOUND = `(s.searched_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state <> 'rejected'))`;

const FILTER_SQL: Record<DomRfCompanyFilter, string> = {
  pending: HAS_PENDING,
  confirmed: HAS_CONFIRMED,
  notFound: NOT_FOUND,
  all: 'true',
};

export interface IDomRfCompaniesQuery {
  filter?: DomRfCompanyFilter;
  /** Подстрока названия компании. */
  q?: string;
  limit?: number;
}

/**
 * Компании для экрана — по фильтру и подстроке названия, не больше `limit` (всего подошло — `matched`);
 * счётчики — по всем компаниям портала. Заказчики и застройщики сверху, затем участники объектов.
 */
export const listDomRfCompanies = async ({
  filter = 'pending',
  q = '',
  limit = 100,
}: IDomRfCompaniesQuery = {}): Promise<{ items: IDomRfCompanyRow[]; matched: number; totals: IDomRfCompaniesTotals }> => {
  const rows = await query<Omit<IDomRfCompanyRow, 'links'> & { links: Array<Omit<IDomRfCompanyLink, 'url'>>; matched: number }>(
    `WITH roles AS (${ROLES_SQL})
     SELECT c.id AS "companyId", c.name, coalesce(r.roles, '{}') AS roles, s.query, s.found_by AS "foundBy",
            s.searched_at AS "searchedAt", s.result_count AS "resultCount", s.last_error AS "lastError",
            coalesce((
              SELECT json_agg(json_build_object(
                       'id', l.id, 'kind', l.kind, 'externalRef', l.external_ref, 'name', l.name, 'foundBy', l.found_by,
                       'rank', l.rank, 'state', l.state, 'decidedBy', l.decided_by, 'decidedAt', l.decided_at)
                     ORDER BY (l.state = 'confirmed') DESC, l.rank NULLS LAST, l.id)
              FROM domrf_company_links l WHERE l.company_id = c.id
            ), '[]'::json) AS links,
            count(*) OVER ()::int AS matched
     FROM companies c
     LEFT JOIN domrf_company_searches s ON s.company_id = c.id
     LEFT JOIN roles r ON r.company_id = c.id
     WHERE c.merged_into_id IS NULL AND ${FILTER_SQL[filter]} AND ($2::text IS NULL OR c.name ILIKE $2)
     ORDER BY coalesce(r.roles && ARRAY['customer', 'developer'], false) DESC, (r.company_id IS NOT NULL) DESC, c.name, c.id
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500), q.trim() ? likePattern(q.trim()) : null],
  );
  const totals = (
    await query<IDomRfCompaniesTotals>(
      `SELECT count(*)::int AS companies,
              count(*) FILTER (WHERE s.searched_at IS NOT NULL)::int AS searched,
              count(*) FILTER (WHERE ${HAS_PENDING})::int AS "withPending",
              count(*) FILTER (WHERE ${HAS_CONFIRMED})::int AS confirmed,
              count(*) FILTER (WHERE ${NOT_FOUND})::int AS "notFound"
       FROM companies c LEFT JOIN domrf_company_searches s ON s.company_id = c.id
       WHERE c.merged_into_id IS NULL`,
    )
  )[0]!;
  return {
    items: rows.map(({ matched: _matched, ...row }) => ({ ...row, links: row.links.map(link => ({ ...link, url: domRfCardUrlOf(link.kind, link.externalRef) })) })),
    matched: rows[0]?.matched ?? 0,
    totals,
  };
};
