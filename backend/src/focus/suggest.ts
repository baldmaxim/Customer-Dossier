// Поиск юрлица по названию в Контур.Фокусе (метод suggest) для имён без ИНН (ADR-016, этап 23D).
//
// Имя из публикаций без реквизита — упоминание; чтобы человек мог назначить его компании, портал
// предлагает кандидатов. Подсказка Фокуса — не решение: ни реквизит, ни слияние без человека не применяются.
//
//  - запрос платный: идёт в расход FOCUS_DAILY_LIMIT, но по расписанию — только пока израсходовано меньше
//    половины суточного лимита (SUGGEST_SHARE): иначе поиск по 2700 именам съел бы запросы, нужные
//    компаниям «на контроле» и заведённым по ИНН;
//  - в подсказки идёт только то, что совпало с названием (matchesByName, то же правило, что у ДОМ.РФ):
//    выдача по «Донстрою» иначе утонет в чужих СЗ; название без отличительных слов не ищется;
//  - ответ хранится как есть (company_name_suggestions.payload), карта — на чтении: имена полей ответа в
//    открытом описании API не названы, поэтому карта терпимая (suggestionView), проба — `focus -- --suggest`.

import type { DbExecutor } from '../db/pool.js';
import { matchesByName, tooGenericToSearch } from '../ingest/registry/domrfCompanies.js';
import type { ISafeFetchDeps } from '../net/safeFetch.js';
import { callFocusSuggest, type IFocusItem } from './client.js';
import { formatAddress, statusText } from './map.js';
import type { FocusStopReason } from './refresh.js';
import type { IFocusStore } from './store.js';

/** Сколько подсказок хранить на имя: дальше по выдаче — шум. */
export const SUGGESTIONS_MAX = 5;
/** Через сколько дней искать снова: состав юрлиц меняется медленно, запрос платный. */
export const SEARCH_INTERVAL_DAYS = 30;
/** Доля суточного лимита, которую может занять поиск по расписанию. */
export const SUGGEST_SHARE = 0.5;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
};

export interface ISuggestionView {
  inn: string | null;
  ogrn: string | null;
  name: string | null;
  address: string | null;
  status: string | null;
}

const nameOf = (p: Json): string | null => {
  const legalName = obj(p.legalName) ?? obj(obj(p.UL)?.legalName);
  const fio = str(p.fio) ?? str(obj(p.IP)?.fio);
  return (
    str(p.name) ?? str(p.shortName) ?? str(p.ShortName) ?? str(p.legalName) ?? str(legalName?.short) ?? str(legalName?.readable) ??
    str(p.fullName) ?? str(legalName?.full) ?? (fio ? `ИП ${fio}` : null)
  );
};

const addressOf = (p: Json): string | null =>
  str(p.address) ?? str(p.legalAddress) ?? formatAddress(p.address) ?? formatAddress(p.legalAddress) ?? formatAddress(obj(p.UL)?.legalAddress);

/** Подсказка словами для экрана — терпимо к именам полей. */
export const suggestionView = (payload: Json, inn: string | null, ogrn: string | null): ISuggestionView => ({
  inn,
  ogrn,
  name: nameOf(payload),
  address: addressOf(payload),
  status: str(payload.status) ?? statusText(payload.status) ?? statusText(obj(payload.UL)?.status) ?? statusText(obj(payload.IP)?.status),
});

const INN_RE = /^([0-9]{10}|[0-9]{12})$/;
const OGRN_RE = /^([0-9]{13}|[0-9]{15})$/;

/** Что из ответа становится подсказкой: реквизит правильной длины, название совпало, без повторов. */
export const pickSuggestions = (companyName: string, items: readonly IFocusItem[]): IFocusItem[] => {
  const seen = new Set<string>();
  const out: IFocusItem[] = [];
  for (const item of items) {
    const inn = item.inn && INN_RE.test(item.inn) ? item.inn : null;
    const ogrn = item.ogrn && OGRN_RE.test(item.ogrn) ? item.ogrn : null;
    if (!inn && !ogrn) continue;
    if (!matchesByName(companyName, nameOf(item.payload))) continue;
    const key = `${inn ?? ''}:${ogrn ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ inn, ogrn, payload: item.payload });
    if (out.length >= SUGGESTIONS_MAX) break;
  }
  return out;
};

export type NameSearchResult =
  | { status: 'searched'; found: number }
  | { status: 'generic' }
  | { status: 'stopped'; reason: FocusStopReason; detail: string }
  | { status: 'failed'; error: string };

export interface INameSearchDeps {
  store: Pick<IFocusStore, 'usedLastDay' | 'journal'>;
  key: string | null;
  dailyLimit: number;
  call?: typeof callFocusSuggest;
  fetchDeps?: ISafeFetchDeps;
}

/** Поиск по одному имени: запрос, журнал расхода, подсказки вместо прежних, срок следующего поиска. */
export const searchCompanyName = async (
  db: DbExecutor,
  company: { id: number; name: string },
  actor: string | null,
  deps: INameSearchDeps,
): Promise<NameSearchResult> => {
  if (deps.key === null) return { status: 'stopped', reason: 'no_key', detail: 'ключ Контур.Фокуса не задан' };
  if (tooGenericToSearch(company.name)) {
    await markSearch(db, company, actor, { found: 0, error: 'название без отличительных слов — укажите ИНН вручную' });
    return { status: 'generic' };
  }
  const used = await deps.store.usedLastDay();
  if (used + 1 > deps.dailyLimit) return { status: 'stopped', reason: 'limit', detail: `за сутки ушло ${used} запросов из ${deps.dailyLimit}` };

  const call = deps.call ?? callFocusSuggest;
  const res = await call(company.name, deps.key, deps.fetchDeps);
  const journalActor = actor ?? 'scheduler';
  if (!res.ok) {
    const outcome = res.failure === 'forbidden' ? 'key_rejected' : res.failure;
    await deps.store.journal({ method: 'suggest', identifiersCount: 1, httpStatus: res.httpStatus, outcome, error: res.error, actor: journalActor });
    if (outcome === 'key_rejected' || outcome === 'quota_exhausted' || outcome === 'rate_limited') {
      return { status: 'stopped', reason: outcome, detail: res.error };
    }
    await markSearch(db, company, actor, { found: 0, error: res.error, failed: true });
    return { status: 'failed', error: res.error };
  }
  await deps.store.journal({ method: 'suggest', identifiersCount: 1, httpStatus: res.httpStatus, outcome: 'ok', error: null, actor: journalActor });
  const picked = pickSuggestions(company.name, res.items);
  await db.query('DELETE FROM company_name_suggestions WHERE company_id = $1', [company.id]);
  for (const [rank, item] of picked.entries()) {
    await db.query(
      `INSERT INTO company_name_suggestions (company_id, inn, ogrn, payload, rank) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [company.id, item.inn, item.ogrn, JSON.stringify(item.payload), rank],
    );
  }
  await markSearch(db, company, actor, { found: picked.length, error: null });
  return { status: 'searched', found: picked.length };
};

const markSearch = async (
  db: DbExecutor,
  company: { id: number; name: string },
  actor: string | null,
  outcome: { found: number; error: string | null; failed?: boolean },
): Promise<void> => {
  if (outcome.failed) {
    // Сбой — пауза час за каждую неудачу подряд, не больше суток; прежние подсказки остаются.
    await db.query(
      `INSERT INTO company_name_searches (company_id, query, next_search_at, attempt_count, last_error, requested_by)
       VALUES ($1, $2, now() + interval '1 hour', 1, $3, $4)
       ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, attempt_count = company_name_searches.attempt_count + 1,
         last_error = EXCLUDED.last_error, next_search_at = now() + least(company_name_searches.attempt_count + 1, 24) * interval '1 hour',
         requested_by = coalesce(EXCLUDED.requested_by, company_name_searches.requested_by), updated_at = now()`,
      [company.id, company.name, outcome.error, actor],
    );
    return;
  }
  await db.query(
    `INSERT INTO company_name_searches (company_id, query, result_count, searched_at, next_search_at, attempt_count, last_error, requested_by)
     VALUES ($1, $2, $3, now(), now() + $5::int * interval '1 day', 0, $4, $6)
     ON CONFLICT (company_id) DO UPDATE SET query = EXCLUDED.query, result_count = EXCLUDED.result_count, searched_at = now(),
       next_search_at = EXCLUDED.next_search_at, attempt_count = 0, last_error = EXCLUDED.last_error,
       requested_by = coalesce(EXCLUDED.requested_by, company_name_searches.requested_by), updated_at = now()`,
    [company.id, company.name, outcome.found, outcome.error, SEARCH_INTERVAL_DAYS, actor],
  );
};

/**
 * Чья очередь: имена без реквизита (не группа, не «не компания», не на контроле — у тех реквизит или
 * решение уже есть), ещё не искавшиеся или со сроком; сначала те, о ком больше публикаций.
 */
export const dueNameSearches = async (db: DbExecutor, limit: number): Promise<Array<{ id: number; name: string }>> =>
  (
    await db.query<{ id: number; name: string }>(
      `WITH pubs AS MATERIALIZED (
         SELECT x.company_id, count(DISTINCT pa.source_item_id)::int AS n
         FROM published_assertions_v pa
         CROSS JOIN LATERAL (VALUES (pa.subject_company_id), (pa.object_company_id), (pa.counterparty_company_id)) x(company_id)
         WHERE x.company_id IS NOT NULL
         GROUP BY x.company_id
       )
       SELECT c.id, c.name
       FROM companies c
       LEFT JOIN pubs p ON p.company_id = c.id
       LEFT JOIN company_name_searches s ON s.company_id = c.id
       WHERE c.merged_into_id IS NULL AND c.entity_type <> 'group'
         AND NOT EXISTS (SELECT 1 FROM entity_identifiers i WHERE i.company_id = c.id AND i.status = 'active'
                           AND i.validation_status = 'checksum_valid' AND i.identifier_type IN ('inn', 'ogrn', 'ogrnip'))
         AND NOT EXISTS (SELECT 1 FROM company_watch w WHERE w.company_id = c.id AND w.removed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM company_dismissals d WHERE d.company_id = c.id AND d.revoked_at IS NULL)
         AND (s.id IS NULL OR s.next_search_at <= now())
       ORDER BY coalesce(p.n, 0) DESC, (s.id IS NULL) DESC, c.id
       LIMIT $1`,
      [limit],
    )
  ).rows;
