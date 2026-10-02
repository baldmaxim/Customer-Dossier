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
import { DOMRF_HOST, domRfCardUrl as domRfCardUrlOf, ensureDomRfCard, withdrawDomRfCardIfOrphaned, type DomRfCardKind } from './domrfCards.js';

/** Повторный поиск компании: реестр пополняется, а новые сведения о компаниях приходят из новостей. */
export const SEARCH_TTL_DAYS = 30;

/** Сколько первых компаний очереди читает одно взятие: общие названия среди них помечаются, первая подходящая — берётся. */
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
            // Строки карточки результата рядом с названием; у снимков до 02.10.2026 поля нет.
            details: z.string().trim().max(400).nullable().optional(),
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

/**
 * Текущие роли компаний на объектах: заказчики и застройщики ищутся первыми. Подключать только как
 * MATERIALIZED: без этого планировщик (01.10.2026, 2867 компаний) оценил выборку компаний в одну строку
 * и пересчитывал вид на каждую — взятие из очереди не укладывалось и в 120 с вместо 0,3.
 */
const ROLES_SQL = `SELECT company_id, array_agg(DISTINCT role ORDER BY role) AS roles FROM card_participations_v WHERE is_current GROUP BY company_id`;

/**
 * Следующая компания к поиску: ещё не искали или срок вышел, и нет подтверждённой страницы. Компании
 * «на контроле» (ADR-016) — вне очереди. Затем — чей срок пришёл («Искать снова», повтор после ошибки, месячный пересмотр), затем ещё не искавшиеся
 * по пользе: заказчики и застройщики, с реквизитом, группы и бренды, остальные участники, остальные.
 * Название без отличительных слов не ищется — помечается для оператора. Аренда — next_search_at на
 * 10 минут вперёд; строки компаний не блокируются: работник один.
 */
export const claimDomRfCompanySearch = async (): Promise<IDomRfCompanyToSearch | null> =>
  withTransaction(async client => {
    const rows = (
      await client.query<{ company_id: number; name: string; tax_id: string | null; attempt_count: number | null }>(
        `WITH roles AS MATERIALIZED (${ROLES_SQL})
         SELECT c.id AS company_id, c.name, ${TAX_ID_SQL} AS tax_id, s.attempt_count
         FROM companies c
         LEFT JOIN domrf_company_searches s ON s.company_id = c.id
         LEFT JOIN roles r ON r.company_id = c.id
         WHERE c.merged_into_id IS NULL
           AND (s.company_id IS NULL OR s.next_search_at <= now())
           AND NOT EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'confirmed')
         ORDER BY EXISTS (SELECT 1 FROM company_watch w WHERE w.company_id = c.id AND w.removed_at IS NULL) DESC,
                  s.next_search_at NULLS LAST,
                  coalesce(r.roles && ARRAY['customer', 'developer'], false) DESC,
                  (${TAX_ID_SQL} IS NOT NULL) DESC,
                  (c.entity_type IN ('group', 'brand')) DESC,
                  (r.company_id IS NOT NULL) DESC,
                  c.id
         LIMIT $1`,
        [CLAIM_SKIP_MAX],
      )
    ).rows;
    for (const row of rows) {
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
        `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, details, found_by, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (company_id, kind, external_ref) DO UPDATE SET
           name = coalesce(EXCLUDED.name, domrf_company_links.name),
           details = coalesce(EXCLUDED.details, domrf_company_links.details), rank = EXCLUDED.rank, last_seen_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [company.companyId, result.kind, result.ref, result.name, result.details ?? null, company.foundBy, rank + 1],
      );
      if (row.rows[0]?.inserted) inserted += 1;
    }
    return inserted;
  });

// ─── Решения оператора ──────────────────────────────────────────────────────────────────────

interface ILockedLink {
  company_id: number;
  kind: DomRfCardKind;
  external_ref: string;
  state: 'pending' | 'confirmed' | 'rejected';
}

const lockLink = async (client: PoolClient, id: number): Promise<ILockedLink> => {
  const row = (
    await client.query<ILockedLink>('SELECT company_id, kind, external_ref, state FROM domrf_company_links WHERE id = $1 FOR UPDATE', [id])
  ).rows[0];
  if (!row) throw new DomRfCompanyError(`Совпадение №${id} не найдено`, 'not_found');
  return row;
};

/** Пометка у записей, закрытых выбором другой: по ней «Отменить» у выбранной возвращает их в «ждёт решения». */
export const CHOSEN_OTHER_NOTE = 'выбрана другая запись';

export interface IDomRfDecisionResult {
  /** Сколько других записей компании закрыто как «не он». */
  closed: number;
  /** «Отменить» у выбранной: сколько закрытых её выбором записей снова ждут решения. */
  reopened: number;
  /** Сколько объектов ушло из «Объектов» вместе со снятыми страницами. */
  withdrawnObjects: number;
}

/**
 * Компании соответствует одна запись реестра — группа или застройщик: выбор закрывает остальные записи
 * компании как «не он». Страницы закрытых подтверждённых записей снимаются с чтения, если на них больше
 * никто не ссылается (withdrawDomRfCardIfOrphaned).
 */
const closeOthers = async (client: PoolClient, companyId: number, keepId: number, actor: string): Promise<IDomRfDecisionResult> => {
  const closed = (
    await client.query<{ kind: DomRfCardKind; external_ref: string; was: string }>(
      `WITH prev AS (
         SELECT id, state FROM domrf_company_links WHERE company_id = $1 AND id <> $2 AND state <> 'rejected' ORDER BY id FOR UPDATE
       )
       UPDATE domrf_company_links l SET state = 'rejected', decided_by = $3, decided_at = now(), decision_note = $4
       FROM prev WHERE l.id = prev.id
       RETURNING l.kind, l.external_ref, prev.state AS was`,
      [companyId, keepId, actor, CHOSEN_OTHER_NOTE],
    )
  ).rows;
  let withdrawnObjects = 0;
  for (const row of closed.filter(r => r.was === 'confirmed')) {
    withdrawnObjects += await withdrawDomRfCardIfOrphaned(client, row.kind, row.external_ref, actor);
  }
  return { closed: closed.length, reopened: 0, withdrawnObjects };
};

/**
 * «Это он»: страница реестра — в очередь чтения, её объекты придут кандидатами; остальные записи компании —
 * «не он». У уже подтверждённой записи — «Оставить только эту»: закрывает остальные.
 */
export const confirmDomRfCompanyLink = async (id: number, actor: string): Promise<IDomRfDecisionResult> => {
  const { link, result } = await withTransaction(async client => {
    const row = await lockLink(client, id);
    if (row.state !== 'confirmed') {
      await client.query(
        `UPDATE domrf_company_links SET state = 'confirmed', decided_by = $2, decided_at = now(), decision_note = NULL WHERE id = $1`,
        [id, actor],
      );
    }
    const closing = await closeOthers(client, row.company_id, id, actor);
    if (row.state === 'confirmed' && closing.closed === 0) throw new DomRfCompanyError('Совпадение уже подтверждено', 'already_decided');
    return { link: row, result: closing };
  });
  await ensureDomRfCard(link.kind, link.external_ref);
  return result;
};

/** «Не он»: не возвращается при повторном поиске. У подтверждённой записи страница снимается с чтения, если больше не нужна. */
export const rejectDomRfCompanyLink = async (id: number, actor: string): Promise<IDomRfDecisionResult> =>
  withTransaction(async client => {
    const row = await lockLink(client, id);
    if (row.state === 'rejected') throw new DomRfCompanyError('Совпадение уже отклонено', 'already_decided');
    await client.query(
      `UPDATE domrf_company_links SET state = 'rejected', decided_by = $2, decided_at = now(), decision_note = NULL WHERE id = $1`,
      [id, actor],
    );
    const withdrawnObjects = row.state === 'confirmed' ? await withdrawDomRfCardIfOrphaned(client, row.kind, row.external_ref, actor) : 0;
    return { closed: 0, reopened: 0, withdrawnObjects };
  });

/**
 * «Отменить»: решение снимается, запись снова ждёт решения. Отменённое «это он» снимает страницу с чтения,
 * если на неё больше никто не ссылается, и возвращает в «ждёт решения» записи, которые закрыл его выбор.
 */
export const undoDomRfCompanyLink = async (id: number, actor: string): Promise<IDomRfDecisionResult> =>
  withTransaction(async client => {
    const row = await lockLink(client, id);
    if (row.state === 'pending') throw new DomRfCompanyError('Решения по этому совпадению нет', 'already_decided');
    await client.query(
      `UPDATE domrf_company_links SET state = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL WHERE id = $1`,
      [id],
    );
    if (row.state !== 'confirmed') return { closed: 0, reopened: 0, withdrawnObjects: 0 };
    const reopened = await client.query(
      `UPDATE domrf_company_links SET state = 'pending', decided_by = NULL, decided_at = NULL, decision_note = NULL
       WHERE company_id = $1 AND state = 'rejected' AND decision_note = $2`,
      [row.company_id, CHOSEN_OTHER_NOTE],
    );
    const withdrawnObjects = await withdrawDomRfCardIfOrphaned(client, row.kind, row.external_ref, actor);
    return { closed: 0, reopened: reopened.rowCount ?? 0, withdrawnObjects };
  });

/** «Указать вручную»: страница застройщика или группы по ссылке оператора — сразу подтверждённой. */
export const linkDomRfCompanyManually = async (companyId: number, url: string, actor: string): Promise<void> => {
  const card = parseDomRfCardUrl(url);
  await withTransaction(async client => {
    const company = (await client.query<{ merged_into_id: number | null }>('SELECT merged_into_id FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company) throw new DomRfCompanyError(`Компания №${companyId} не найдена`, 'not_found');
    if (company.merged_into_id !== null) throw new DomRfCompanyError(`Компания №${companyId} объединена с №${company.merged_into_id}`, 'invalid');
    const linkId = (
      await client.query<{ id: number }>(
        `INSERT INTO domrf_company_links (company_id, kind, external_ref, found_by, state, decided_by, decided_at)
         VALUES ($1, $2, $3, 'manual', 'confirmed', $4, now())
         ON CONFLICT (company_id, kind, external_ref) DO UPDATE SET state = 'confirmed', decided_by = $4, decided_at = now(), decision_note = NULL
         RETURNING id`,
        [companyId, card.kind, card.externalRef, actor],
      )
    ).rows[0]!.id;
    // Указанная вручную — выбор, как «Это он»: остальные записи компании закрываются.
    await closeOthers(client, companyId, linkId, actor);
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
  /** Строки карточки результата поиска рядом с названием: реквизиты, регион. */
  details: string | null;
  foundBy: 'inn' | 'name' | 'manual';
  rank: number | null;
  state: 'pending' | 'confirmed' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  /** Почему закрыто без решения по этой записи: «выбрана другая запись». */
  decisionNote: string | null;
  /** Подсказка модели (domrf-hint@1): не решение, на экране подписана как подсказка. */
  hint: { verdict: 'match' | 'no_match' | 'unsure' | null; reason: string | null; error: string | null; model: string; at: string } | null;
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
  /** Отмечено «это он» больше одной записи: разобрать, оставить одну. */
  several: number;
}

export type DomRfCompanyFilter = 'pending' | 'notFound' | 'confirmed' | 'several' | 'all';

const HAS_PENDING = `EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'pending')`;
const HAS_CONFIRMED = `EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'confirmed')`;
const SEVERAL = `(SELECT count(*) FROM domrf_company_links l WHERE l.company_id = c.id AND l.state = 'confirmed') > 1`;
const NOT_FOUND = `(s.searched_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM domrf_company_links l WHERE l.company_id = c.id AND l.state <> 'rejected'))`;

const FILTER_SQL: Record<DomRfCompanyFilter, string> = {
  pending: HAS_PENDING,
  confirmed: HAS_CONFIRMED,
  notFound: NOT_FOUND,
  several: SEVERAL,
  all: 'true',
};

export interface IDomRfCompaniesQuery {
  filter?: DomRfCompanyFilter;
  /** Подстрока названия компании. */
  q?: string;
  limit?: number;
}

/** Счётчики по всем компаниям портала: для вкладок и сводки на «Сайтах». */
export const domRfCompanyTotals = async (): Promise<IDomRfCompaniesTotals> =>
  (
    await query<IDomRfCompaniesTotals>(
      `SELECT count(*)::int AS companies,
              count(*) FILTER (WHERE s.searched_at IS NOT NULL)::int AS searched,
              count(*) FILTER (WHERE ${HAS_PENDING})::int AS "withPending",
              count(*) FILTER (WHERE ${HAS_CONFIRMED})::int AS confirmed,
              count(*) FILTER (WHERE ${NOT_FOUND})::int AS "notFound",
              count(*) FILTER (WHERE ${SEVERAL})::int AS several
       FROM companies c LEFT JOIN domrf_company_searches s ON s.company_id = c.id
       WHERE c.merged_into_id IS NULL`,
    )
  )[0]!;

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
    `WITH roles AS MATERIALIZED (${ROLES_SQL})
     SELECT c.id AS "companyId", c.name, coalesce(r.roles, '{}') AS roles, s.query, s.found_by AS "foundBy",
            s.searched_at AS "searchedAt", s.result_count AS "resultCount", s.last_error AS "lastError",
            coalesce((
              SELECT json_agg(json_build_object(
                       'id', l.id, 'kind', l.kind, 'externalRef', l.external_ref, 'name', l.name, 'details', l.details,
                       'foundBy', l.found_by, 'rank', l.rank, 'state', l.state, 'decidedBy', l.decided_by, 'decidedAt', l.decided_at,
                       'decisionNote', l.decision_note,
                       'hint', CASE WHEN l.hinted_at IS NULL THEN NULL ELSE json_build_object(
                         'verdict', l.hint_verdict, 'reason', l.hint_reason, 'error', l.hint_error, 'model', l.hint_model, 'at', l.hinted_at) END)
                     ORDER BY (l.state = 'confirmed') DESC, (l.hint_verdict = 'match') DESC NULLS LAST, l.rank NULLS LAST, l.id)
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
  const totals = await domRfCompanyTotals();
  return {
    items: rows.map(({ matched: _matched, ...row }) => ({ ...row, links: row.links.map(link => ({ ...link, url: domRfCardUrlOf(link.kind, link.externalRef) })) })),
    matched: rows[0]?.matched ?? 0,
    totals,
  };
};
