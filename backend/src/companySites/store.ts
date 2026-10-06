// Сайты компаний (этап 25A, миграция 045): очередь поиска, журнал расхода, кандидаты и решения оператора.
//
// Образец — поиск компании в реестре застройщиков ДОМ.РФ (ingest/registry/domrfCompanies.ts): очередь с арендой,
// предложения, «это он / не он / указать вручную». Отличия: у компании может быть несколько подтверждённых
// сайтов (сайт группы и сайт СЗ), а поиск платный — каждая попытка резервирует место в суточном лимите ДО запроса.

import type { PoolClient } from 'pg';

import { env } from '../config/env.js';
import { execute, query, queryOne, withTransaction } from '../db/pool.js';
import { tooGenericToSearch } from '../ingest/registry/domrfCompanies.js';
import { likePattern } from '../utils/likePattern.js';
import type { SiteCheckStatus, ISiteCheck } from './verify.js';
import { attachCompanySiteSource, releaseCompanySiteSource } from './sources.js';
import { isNotCompanySite, normalizeSiteUrl, type IAcceptedSite } from './url.js';

export const SCHEDULER_ACTOR = 'scheduler';

/** Поиск не вернул ни одной страницы — скорее сбой поиска, чем «сайта нет»: повтор раньше обычного. */
export const NO_CITATIONS_RETRY_DAYS = 7;

/** Аренда взятой компании: второй работник её не возьмёт, упавший — отпустит через это время. */
const LEASE_MINUTES = 10;

/** Сколько первых компаний очереди читает одно взятие: общие названия среди них помечаются. */
const CLAIM_SKIP_MAX = 20;

export class CompanySiteError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'already_decided' | 'invalid',
  ) {
    super(message);
    this.name = 'CompanySiteError';
  }
}

/** Действующий ИНН (иначе ОГРН) с верной контрольной суммой. */
const TAX_ID_LATERAL = `LEFT JOIN LATERAL (
    SELECT ei.value AS tax_id FROM entity_identifiers ei
    WHERE ei.company_id = c.id AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
      AND ei.identifier_type IN ('inn', 'ogrn')
    ORDER BY (ei.identifier_type = 'inn') DESC, ei.id LIMIT 1) t ON true`;

/** Роли на объектах — только MATERIALIZED (см. domrfCompanies.ts: иначе вид пересчитывается на каждую компанию). */
const ROLES_SQL = `SELECT company_id, array_agg(DISTINCT role ORDER BY role) AS roles FROM card_participations_v WHERE is_current GROUP BY company_id`;

/**
 * Группы, в которые входит компания `${alias}.id`: те же условия, что MEMBERS_SQL в api/companyObjects.ts
 * (реестр с действующим доказательством или опубликованное утверждение «входит в группу»).
 */
const groupsOf = (alias: string): string => `
  SELECT a.object_company_id AS group_id FROM assertions a
  WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group'
    AND a.subject_company_id = ${alias}.id AND a.object_company_id <> ${alias}.id
    AND a.status <> 'rejected' AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'claim', 'unknown')
    AND ((a.origin = 'registry' AND EXISTS (
           SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'))
         OR EXISTS (SELECT 1 FROM published_assertions_v pa WHERE pa.id = a.id))`;

// ─── Очередь поиска ─────────────────────────────────────────────────────────────────────────

export interface ISiteSearchTarget {
  companyId: number;
  name: string;
  legalForm: string | null;
  taxId: string | null;
  city: string | null;
  /** До двух объектов, где компания заказчик, застройщик или инвестор, — уточняют запрос. */
  projects: string[];
  isGroup: boolean;
  attemptCount: number;
}

export const GENERIC_NAME_ERROR = 'название без отличительных слов — укажите сайт вручную';

interface ICompanyRow {
  company_id: number;
  name: string;
  legal_form: string | null;
  city: string | null;
  entity_type: string;
  tax_id: string | null;
}

const projectsOf = async (client: PoolClient | null, companyId: number): Promise<string[]> => {
  const sql = `SELECT name FROM (
      SELECT DISTINCT p.id, p.name FROM card_participations_v pp
      JOIN projects p ON p.id = pp.project_id AND p.merged_into_id IS NULL
      WHERE pp.company_id = $1 AND pp.is_current AND pp.role IN ('customer', 'developer', 'investor')
    ) x ORDER BY id DESC LIMIT 2`;
  const rows = client ? (await client.query<{ name: string }>(sql, [companyId])).rows : await query<{ name: string }>(sql, [companyId]);
  return rows.map(r => r.name);
};

const toTarget = (row: ICompanyRow, projects: string[], attemptCount: number): ISiteSearchTarget => ({
  companyId: row.company_id,
  name: row.name,
  legalForm: row.legal_form,
  taxId: row.tax_id,
  city: row.city,
  projects,
  isGroup: row.entity_type === 'group' || row.entity_type === 'brand',
  attemptCount,
});

/**
 * Следующая компания к поиску: юрлицо с реквизитом или группа, срок пришёл, нет подтверждённого сайта и
 * нет кандидатов, ждущих решения (сначала решение оператора, потом новый платный поиск), и у её группы
 * сайт не подтверждён — СЗ группы показывают сайт группы. «На контроле» — вне очереди, затем срок, затем
 * заказчики и застройщики, с реквизитом, группы. Название без отличительных слов не ищется — помечается.
 */
export const claimSiteSearch = async (): Promise<ISiteSearchTarget | null> =>
  withTransaction(async client => {
    const rows = (
      await client.query<ICompanyRow & { attempt_count: number | null }>(
        `WITH roles AS MATERIALIZED (${ROLES_SQL})
         SELECT c.id AS company_id, c.name, c.legal_form, c.city, c.entity_type, t.tax_id, s.attempt_count
         FROM companies c
         ${TAX_ID_LATERAL}
         LEFT JOIN company_site_searches s ON s.company_id = c.id
         LEFT JOIN roles r ON r.company_id = c.id
         WHERE c.merged_into_id IS NULL
           AND (c.entity_type IN ('group', 'brand') OR t.tax_id IS NOT NULL)
           AND (s.company_id IS NULL OR s.next_search_at <= now())
           AND NOT EXISTS (SELECT 1 FROM company_site_candidates k WHERE k.company_id = c.id AND k.state IN ('pending', 'confirmed'))
           AND NOT EXISTS (
             SELECT 1 FROM (${groupsOf('c')}) g
             JOIN company_site_candidates k ON k.company_id = g.group_id AND k.state = 'confirmed')
         ORDER BY EXISTS (SELECT 1 FROM company_watch w WHERE w.company_id = c.id AND w.removed_at IS NULL) DESC,
                  s.next_search_at NULLS LAST,
                  coalesce(r.roles && ARRAY['customer', 'developer'], false) DESC,
                  (t.tax_id IS NOT NULL) DESC,
                  (c.entity_type IN ('group', 'brand')) DESC,
                  c.id
         LIMIT $1`,
        [CLAIM_SKIP_MAX],
      )
    ).rows;
    for (const row of rows) {
      if (!row.tax_id && tooGenericToSearch(row.name)) {
        await client.query(
          `INSERT INTO company_site_searches (company_id, query, outcome, result_count, searched_at, next_search_at, last_error)
           VALUES ($1, $2, 'none', 0, now(), now() + ($3::int * interval '1 day'), $4)
           ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, outcome = 'none', result_count = 0, searched_at = now(),
             next_search_at = EXCLUDED.next_search_at, attempt_count = 0, last_error = EXCLUDED.last_error, updated_at = now()`,
          [row.company_id, row.name, env.SITE_SEARCH_REFRESH_DAYS, GENERIC_NAME_ERROR],
        );
        continue;
      }
      await client.query(
        `INSERT INTO company_site_searches (company_id, next_search_at, attempt_count)
         VALUES ($1, now() + ($2::int * interval '1 minute'), 1)
         ON CONFLICT (company_id) DO UPDATE SET next_search_at = EXCLUDED.next_search_at,
           attempt_count = company_site_searches.attempt_count + 1, updated_at = now()`,
        [row.company_id, LEASE_MINUTES],
      );
      return toTarget(row, await projectsOf(client, row.company_id), (row.attempt_count ?? 0) + 1);
    }
    return null;
  });

/** Компания для пробы по реквизиту — без очереди и аренды. */
export const loadSearchTargetByTaxId = async (taxId: string): Promise<ISiteSearchTarget | null> => {
  const row = await queryOne<ICompanyRow>(
    `SELECT c.id AS company_id, c.name, c.legal_form, c.city, c.entity_type, t.tax_id
     FROM entity_identifiers ei
     JOIN companies c ON c.id = ei.company_id AND c.merged_into_id IS NULL
     ${TAX_ID_LATERAL}
     WHERE ei.value = $1 AND ei.status = 'active'
     ORDER BY c.id LIMIT 1`,
    [taxId],
  );
  return row ? toTarget(row, await projectsOf(null, row.company_id), 0) : null;
};

export type SiteSearchOutcome = 'found' | 'none' | 'no_citations';

export interface ISiteSearchSave {
  query: string;
  outcome: SiteSearchOutcome;
  /** Сколько страниц отдал поиск. */
  resultCount: number;
  accepted: IAcceptedSite[];
  model: string;
  promptVersion: string;
  refreshDays: number;
}

/**
 * Итог поиска: кандидаты добавляются, решения оператора не трогаются (отклонённый хост остаётся отклонённым).
 * found — только если появился новый кандидат или ждущий решения; одни отклонённые — none.
 * Возвращает число новых кандидатов.
 */
export const saveSiteSearch = async (companyId: number, save: ISiteSearchSave): Promise<{ inserted: number; outcome: SiteSearchOutcome }> =>
  withTransaction(async client => {
    let inserted = 0;
    let live = 0;
    for (const site of save.accepted) {
      const row = (
        await client.query<{ inserted: boolean; state: string }>(
          `INSERT INTO company_site_candidates (company_id, host, url, found_via, title, snippet, model_reason, model, prompt_version)
           VALUES ($1, $2, $3, 'web_search', $4, $5, $6, $7, $8)
           ON CONFLICT (company_id, host) DO UPDATE SET last_seen_at = now(),
             title = coalesce(company_site_candidates.title, EXCLUDED.title),
             snippet = coalesce(company_site_candidates.snippet, EXCLUDED.snippet),
             model_reason = coalesce(company_site_candidates.model_reason, EXCLUDED.model_reason)
           RETURNING (xmax = 0) AS inserted, state`,
          [companyId, site.host, site.url, site.title, site.snippet, site.reason, save.model, save.promptVersion],
        )
      ).rows[0]!;
      if (row.inserted) inserted += 1;
      if (row.state !== 'rejected') live += 1;
    }
    const outcome: SiteSearchOutcome = save.outcome === 'found' && live === 0 ? 'none' : save.outcome;
    const days = outcome === 'no_citations' ? Math.min(NO_CITATIONS_RETRY_DAYS, save.refreshDays) : save.refreshDays;
    await client.query(
      `INSERT INTO company_site_searches (company_id, query, outcome, result_count, searched_at, next_search_at, attempt_count)
       VALUES ($1, $2, $3, $4, now(), now() + ($5::int * interval '1 day'), 0)
       ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, outcome = EXCLUDED.outcome, result_count = EXCLUDED.result_count,
         searched_at = now(), next_search_at = EXCLUDED.next_search_at, attempt_count = 0, last_error = NULL, updated_at = now()`,
      [companyId, save.query, outcome, save.resultCount, days],
    );
    return { inserted, outcome };
  });

/** Неудача поиска: пауза растёт с числом неудач подряд (15 мин × 2ⁿ, не больше суток). */
export const failSiteSearch = async (companyId: number, error: string, attempts: number): Promise<void> => {
  const delayMinutes = Math.min(24 * 60, 15 * 2 ** Math.min(Math.max(attempts, 0), 6));
  await execute(
    `INSERT INTO company_site_searches (company_id, next_search_at, attempt_count, last_error)
     VALUES ($1, now() + ($3::int * interval '1 minute'), 1, $2)
     ON CONFLICT (company_id) DO UPDATE SET last_error = EXCLUDED.last_error, next_search_at = EXCLUDED.next_search_at, updated_at = now()`,
    [companyId, error.slice(0, 1000), delayMinutes],
  );
};

/** Лимит исчерпан: компания возвращается в очередь через час, неудачей это не считается. */
export const postponeSiteSearch = async (companyId: number): Promise<void> => {
  await execute(
    `UPDATE company_site_searches SET next_search_at = now() + interval '1 hour',
       attempt_count = greatest(attempt_count - 1, 0), updated_at = now()
     WHERE company_id = $1`,
    [companyId],
  );
};

/** «Искать снова»: компания — в начало очереди. Отклонённые сайты при этом не вернутся. */
export const requestSiteSearch = async (companyId: number, actor: string): Promise<boolean> =>
  (
    await query(
      `INSERT INTO company_site_searches (company_id, next_search_at, requested_by)
       SELECT c.id, now(), $2 FROM companies c WHERE c.id = $1 AND c.merged_into_id IS NULL
       ON CONFLICT (company_id) DO UPDATE SET next_search_at = now(), attempt_count = 0, last_error = NULL,
         requested_by = EXCLUDED.requested_by, updated_at = now()
       RETURNING company_id`,
      [companyId, actor],
    )
  ).length > 0;

// ─── Журнал расхода ─────────────────────────────────────────────────────────────────────────

export type SiteSearchJournalOutcome = SiteSearchOutcome | 'llm_error' | 'invalid_answer';

export type SiteSearchReserve = { ok: true; id: number } | { ok: false; used: number };

/** Попытки за скользящие сутки, включая незавершённые: каждая — платный поиск. */
export const siteSearchUsedLastDay = async (): Promise<number> =>
  (await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM site_search_requests WHERE requested_at > now() - interval '24 hours'`))?.n ?? 0;

/** Место в суточном лимите — до запроса, под общей блокировкой: расписание, кнопка и проба не выйдут за предел вместе. */
export const reserveSiteSearch = async (
  entry: { companyId: number | null; actor: string; model: string; maxResults: number },
  dailyLimit: number,
): Promise<SiteSearchReserve> =>
  withTransaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['site-search:budget']);
    const used = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM site_search_requests WHERE requested_at > now() - interval '24 hours'`)).rows[0]?.n ?? 0;
    if (used + 1 > dailyLimit) return { ok: false, used } as const;
    const row = await client.query<{ id: number }>(
      `INSERT INTO site_search_requests (company_id, actor, model, max_results, outcome) VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [entry.companyId, entry.actor, entry.model, entry.maxResults],
    );
    return { ok: true, id: row.rows[0]!.id } as const;
  });

export const finishSiteSearch = async (
  id: number,
  result: { outcome: SiteSearchJournalOutcome; citations: number | null; accepted: number | null; error: string | null },
): Promise<void> => {
  await execute(
    `UPDATE site_search_requests SET outcome = $2, citations = $3, accepted = $4, error = $5, finished_at = now() WHERE id = $1`,
    [id, result.outcome, result.citations, result.accepted, result.error?.slice(0, 1000) ?? null],
  );
};

// ─── Проверка кандидатов ────────────────────────────────────────────────────────────────────

export interface IUncheckedCandidate {
  id: number;
  url: string;
  host: string;
  companyName: string;
  inn: string | null;
  ogrn: string | null;
}

/** Кандидаты без проверки: сначала ждущие решения — оператору нужны признаки до решения. */
export const uncheckedCandidates = async (limit: number): Promise<IUncheckedCandidate[]> =>
  query<IUncheckedCandidate>(
    `SELECT k.id, k.url, k.host, c.name AS "companyName",
            (SELECT ei.value FROM entity_identifiers ei WHERE ei.company_id = c.id AND ei.status = 'active'
               AND ei.validation_status = 'checksum_valid' AND ei.identifier_type = 'inn' ORDER BY ei.id LIMIT 1) AS inn,
            (SELECT ei.value FROM entity_identifiers ei WHERE ei.company_id = c.id AND ei.status = 'active'
               AND ei.validation_status = 'checksum_valid' AND ei.identifier_type = 'ogrn' ORDER BY ei.id LIMIT 1) AS ogrn
     FROM company_site_candidates k JOIN companies c ON c.id = k.company_id
     WHERE k.check_status = 'not_checked' AND k.state <> 'rejected'
     ORDER BY (k.state = 'pending') DESC, k.id
     LIMIT $1`,
    [limit],
  );

export const saveSiteCheck = async (id: number, check: ISiteCheck): Promise<void> => {
  await execute(
    `UPDATE company_site_candidates SET check_status = $2, checked_at = now(), check_error = $3, page_title = $4,
       inn_on_page = $5, ogrn_on_page = $6, name_on_page = $7, other_inns = $8::text[]
     WHERE id = $1`,
    [id, check.status, check.error, check.pageTitle, check.innOnPage, check.ogrnOnPage, check.nameOnPage, check.otherInns],
  );
};

// ─── Решения оператора ──────────────────────────────────────────────────────────────────────

interface ILockedCandidate {
  company_id: number;
  host: string;
  state: string;
  source_id: number | null;
}

const lockCandidate = async (client: PoolClient, id: number): Promise<ILockedCandidate> => {
  const row = (
    await client.query<ILockedCandidate>(
      'SELECT company_id, host, state, source_id FROM company_site_candidates WHERE id = $1 FOR UPDATE',
      [id],
    )
  ).rows[0];
  if (!row) throw new CompanySiteError(`Кандидат №${id} не найден`, 'not_found');
  return row;
};

export interface ISiteDecision {
  companyId: number;
  host: string;
  /** Источник, которым портал читает сайт (25B); у отклонённого — прежний, если был. */
  sourceId: number | null;
}

/**
 * «Это сайт компании». Остальные кандидаты компании не закрываются: у группы и её СЗ бывают свои сайты.
 * После решения сайт становится источником и включается (25B, companySites/sources.ts) — отдельной транзакцией,
 * как страница ДОМ.РФ после «Это он»: сбой включения решения не отменяет, его доделает syncCompanySiteSources.
 */
export const confirmSiteCandidate = async (id: number, actor: string): Promise<ISiteDecision> => {
  const decided = await withTransaction(async client => {
    const row = await lockCandidate(client, id);
    if (row.state === 'confirmed') throw new CompanySiteError('Сайт уже подтверждён', 'already_decided');
    await client.query(
      `UPDATE company_site_candidates SET state = 'confirmed', decided_by = $2, decided_at = now(), decision_note = NULL WHERE id = $1`,
      [id, actor],
    );
    return { companyId: row.company_id, host: row.host };
  });
  return { ...decided, sourceId: await attachCompanySiteSource(id, actor) };
};

/**
 * «Не он» (и у подтверждённого — «Отвязать»): при повторном поиске не возвращается. Отвязан последний, кто
 * подтверждал этот сайт, — чтение ставится на паузу, допуски отзываются.
 */
export const rejectSiteCandidate = async (id: number, actor: string, note: string | null): Promise<ISiteDecision> => {
  const decided = await withTransaction(async client => {
    const row = await lockCandidate(client, id);
    if (row.state === 'rejected') throw new CompanySiteError('Кандидат уже отклонён', 'already_decided');
    await client.query(
      `UPDATE company_site_candidates SET state = 'rejected', decided_by = $2, decided_at = now(), decision_note = $3 WHERE id = $1`,
      [id, actor, note],
    );
    return { companyId: row.company_id, host: row.host, sourceId: row.source_id, wasConfirmed: row.state === 'confirmed' };
  });
  if (decided.wasConfirmed) await releaseCompanySiteSource(decided.sourceId, actor);
  return { companyId: decided.companyId, host: decided.host, sourceId: decided.sourceId };
};

/** «Указать вручную»: адрес оператора — сразу подтверждённым; проверка признаков — следующим проходом. */
export const linkSiteManually = async (companyId: number, rawUrl: string, actor: string): Promise<ISiteDecision & { id: number }> => {
  const address = normalizeSiteUrl(rawUrl);
  if (!address) throw new CompanySiteError('Укажите адрес сайта, например https://example.ru', 'invalid');
  if (isNotCompanySite(address.host)) throw new CompanySiteError('Это справочник, агрегатор или соцсеть, а не сайт компании', 'invalid');
  const linked = await withTransaction(async client => {
    const company = (await client.query<{ merged_into_id: number | null }>('SELECT merged_into_id FROM companies WHERE id = $1', [companyId])).rows[0];
    if (!company) throw new CompanySiteError(`Компания №${companyId} не найдена`, 'not_found');
    if (company.merged_into_id !== null) throw new CompanySiteError(`Компания №${companyId} объединена с №${company.merged_into_id}`, 'invalid');
    const id = (
      await client.query<{ id: number }>(
        `INSERT INTO company_site_candidates (company_id, host, url, found_via, state, decided_by, decided_at)
         VALUES ($1, $2, $3, 'operator', 'confirmed', $4, now())
         ON CONFLICT (company_id, host) DO UPDATE SET state = 'confirmed', decided_by = $4, decided_at = now(), decision_note = NULL
         RETURNING id`,
        [companyId, address.host, address.url, actor],
      )
    ).rows[0]!.id;
    return { id, companyId, host: address.host };
  });
  return { ...linked, sourceId: await attachCompanySiteSource(linked.id, actor) };
};

// ─── Чтение для экранов ─────────────────────────────────────────────────────────────────────

export type CandidateState = 'pending' | 'confirmed' | 'rejected';

export interface ISiteCandidate {
  id: number;
  companyId: number;
  host: string;
  url: string;
  foundVia: 'web_search' | 'operator';
  title: string | null;
  snippet: string | null;
  modelReason: string | null;
  model: string | null;
  checkStatus: SiteCheckStatus | 'not_checked';
  checkedAt: string | null;
  checkError: string | null;
  pageTitle: string | null;
  innOnPage: boolean | null;
  ogrnOnPage: boolean | null;
  nameOnPage: boolean | null;
  otherInns: string[];
  state: CandidateState;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  firstSeenAt: string;
  /** Тот же хост подтверждён у других компаний — оператору: сайт группы или чужой сайт. */
  sharedWith: Array<{ companyId: number; name: string }>;
  /** Чтение сайта (25B): источник подтверждённого сайта; null — ещё не заведён. */
  source: ISiteSourceState | null;
}

export interface ISiteSourceState {
  id: number;
  status: 'active' | 'paused' | 'broken';
  health: string | null;
  healthReason: string | null;
  lastOkAt: string | null;
  lastAttemptAt: string | null;
}

export interface ISiteSearchState {
  query: string | null;
  outcome: SiteSearchOutcome | null;
  resultCount: number | null;
  searchedAt: string | null;
  nextSearchAt: string;
  lastError: string | null;
  requestedBy: string | null;
}

export interface IFamilySite {
  companyId: number;
  companyName: string;
  host: string;
  url: string;
}

export interface ICompanySites {
  candidates: ISiteCandidate[];
  /** Подтверждённые сайты групп, в которые входит компания (СЗ показывает сайт группы). */
  familySites: IFamilySite[];
  search: ISiteSearchState | null;
}

const CANDIDATE_JSON = `json_build_object(
  'id', k.id, 'companyId', k.company_id, 'host', k.host, 'url', k.url, 'foundVia', k.found_via, 'title', k.title,
  'snippet', k.snippet, 'modelReason', k.model_reason, 'model', k.model, 'checkStatus', k.check_status,
  'checkedAt', k.checked_at, 'checkError', k.check_error, 'pageTitle', k.page_title, 'innOnPage', k.inn_on_page,
  'ogrnOnPage', k.ogrn_on_page, 'nameOnPage', k.name_on_page, 'otherInns', k.other_inns, 'state', k.state,
  'decidedBy', k.decided_by, 'decidedAt', k.decided_at, 'decisionNote', k.decision_note, 'firstSeenAt', k.first_seen_at,
  'source', (SELECT json_build_object('id', src.id, 'status', src.status, 'health', src.health, 'healthReason', src.health_reason,
                                      'lastOkAt', src.last_ok_at, 'lastAttemptAt', src.last_attempt_at)
             FROM sources src WHERE src.id = k.source_id),
  'sharedWith', coalesce((
    SELECT json_agg(json_build_object('companyId', o.company_id, 'name', oc.name) ORDER BY oc.name)
    FROM company_site_candidates o JOIN companies oc ON oc.id = o.company_id AND oc.merged_into_id IS NULL
    WHERE o.host = k.host AND o.state = 'confirmed' AND o.company_id <> k.company_id), '[]'::json))`;

const CANDIDATE_ORDER = `(k.state = 'confirmed') DESC, (k.state = 'pending') DESC, k.inn_on_page DESC NULLS LAST, k.id`;

export const loadCompanySites = async (companyId: number): Promise<ICompanySites> => {
  const candidates = await query<{ c: ISiteCandidate }>(
    `SELECT ${CANDIDATE_JSON} AS c FROM company_site_candidates k WHERE k.company_id = $1 ORDER BY ${CANDIDATE_ORDER}`,
    [companyId],
  );
  const familySites = await query<IFamilySite>(
    `SELECT k.company_id AS "companyId", g.name AS "companyName", k.host, k.url
     FROM companies c
     JOIN LATERAL (${groupsOf('c')}) grp ON true
     JOIN companies g ON g.id = grp.group_id AND g.merged_into_id IS NULL
     JOIN company_site_candidates k ON k.company_id = g.id AND k.state = 'confirmed'
     WHERE c.id = $1
     ORDER BY g.name, k.host`,
    [companyId],
  );
  const search = await queryOne<ISiteSearchState>(
    `SELECT query, outcome, result_count AS "resultCount", searched_at AS "searchedAt", next_search_at AS "nextSearchAt",
            last_error AS "lastError", requested_by AS "requestedBy"
     FROM company_site_searches WHERE company_id = $1`,
    [companyId],
  );
  return { candidates: candidates.map(r => r.c), familySites, search };
};

export type CompanySitesFilter = 'pending' | 'confirmed' | 'notFound' | 'all';

const HAS_PENDING = `EXISTS (SELECT 1 FROM company_site_candidates k WHERE k.company_id = c.id AND k.state = 'pending')`;
const HAS_CONFIRMED = `EXISTS (SELECT 1 FROM company_site_candidates k WHERE k.company_id = c.id AND k.state = 'confirmed')`;
const NOT_FOUND = `(s.searched_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM company_site_candidates k WHERE k.company_id = c.id AND k.state <> 'rejected'))`;
const TOUCHED = `(s.company_id IS NOT NULL OR EXISTS (SELECT 1 FROM company_site_candidates k WHERE k.company_id = c.id))`;

const FILTER_SQL: Record<CompanySitesFilter, string> = {
  pending: HAS_PENDING,
  confirmed: HAS_CONFIRMED,
  notFound: NOT_FOUND,
  all: TOUCHED,
};

export interface ICompanySitesTotals {
  searched: number;
  withPending: number;
  confirmed: number;
  notFound: number;
  /** Попыток поиска за сутки — расход лимита. */
  usedLastDay: number;
}

export interface ICompanySitesRow {
  companyId: number;
  name: string;
  roles: string[];
  search: ISiteSearchState | null;
  candidates: ISiteCandidate[];
}

export const companySitesTotals = async (): Promise<ICompanySitesTotals> => {
  const row = (await queryOne<Omit<ICompanySitesTotals, 'usedLastDay'>>(
    `SELECT count(*) FILTER (WHERE s.searched_at IS NOT NULL)::int AS searched,
            count(*) FILTER (WHERE ${HAS_PENDING})::int AS "withPending",
            count(*) FILTER (WHERE ${HAS_CONFIRMED})::int AS confirmed,
            count(*) FILTER (WHERE ${NOT_FOUND})::int AS "notFound"
     FROM companies c LEFT JOIN company_site_searches s ON s.company_id = c.id
     WHERE c.merged_into_id IS NULL`,
  ))!;
  return { ...row, usedLastDay: await siteSearchUsedLastDay() };
};

/** Очередь «Сайты компаний»: по фильтру и подстроке названия, не больше `limit`; заказчики и застройщики сверху. */
export const listCompanySites = async ({
  filter = 'pending',
  q = '',
  limit = 100,
}: { filter?: CompanySitesFilter; q?: string; limit?: number } = {}): Promise<{ items: ICompanySitesRow[]; matched: number; totals: ICompanySitesTotals }> => {
  const rows = await query<ICompanySitesRow & { matched: number }>(
    `WITH roles AS MATERIALIZED (${ROLES_SQL})
     SELECT c.id AS "companyId", c.name, coalesce(r.roles, '{}') AS roles,
            CASE WHEN s.company_id IS NULL THEN NULL ELSE json_build_object(
              'query', s.query, 'outcome', s.outcome, 'resultCount', s.result_count, 'searchedAt', s.searched_at,
              'nextSearchAt', s.next_search_at, 'lastError', s.last_error, 'requestedBy', s.requested_by) END AS search,
            coalesce((SELECT json_agg(${CANDIDATE_JSON} ORDER BY ${CANDIDATE_ORDER})
                      FROM company_site_candidates k WHERE k.company_id = c.id), '[]'::json) AS candidates,
            count(*) OVER ()::int AS matched
     FROM companies c
     LEFT JOIN company_site_searches s ON s.company_id = c.id
     LEFT JOIN roles r ON r.company_id = c.id
     WHERE c.merged_into_id IS NULL AND ${FILTER_SQL[filter]} AND ($2::text IS NULL OR c.name ILIKE $2)
     ORDER BY coalesce(r.roles && ARRAY['customer', 'developer'], false) DESC, c.name, c.id
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500), q.trim() ? likePattern(q.trim()) : null],
  );
  return {
    items: rows.map(({ matched: _matched, ...row }) => row),
    matched: rows[0]?.matched ?? 0,
    totals: await companySitesTotals(),
  };
};
