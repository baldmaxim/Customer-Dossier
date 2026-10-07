// Чтение parser-api.com для карточки и админки (этап 24A): состояние наборов по ИНН и последний снимок.
//
// Состояние говорит словами, а не нулём: не проверяли (строки нет), проверено — есть / записей нет / получена
// часть, последняя попытка не удалась (ошибка и когда повтор). «Проверено» — время последней проверки,
// «сведения от» — время первого получения этого же ответа: повтор без изменений даты сведений не обновляет.

import type { DbExecutor } from '../db/pool.js';
import { parserApiKeyStatus } from '../settings/parserApiKey.js';
import { PARSER_API_DATASETS, type DatasetOutcome, type IDatasetPayload, type ParserApiDataset } from './datasets.js';
import { mapCaseCard, type ICaseClaim } from './map/caseCard.js';

export interface IParserApiDatasetState {
  dataset: ParserApiDataset;
  outcome: DatasetOutcome | null;
  checkedAt: string | null;
  nextCheckAt: string | null;
  attemptCount: number;
  lastError: string | null;
  /** Последний снимок набора: когда получен впервые, полный ли, чего в нём нет. */
  record: { fetchedAt: string; complete: boolean; missing: string[] } | null;
}

const iso = (value: Date | string | null): string | null => (value instanceof Date ? value.toISOString() : value);

export const loadParserApiStates = async (db: DbExecutor, inn: string): Promise<IParserApiDatasetState[]> => {
  const [checks, records] = await Promise.all([
    db.query<{ dataset: ParserApiDataset; outcome: DatasetOutcome | null; checked_at: Date | null; next_check_at: Date; attempt_count: number; last_error: string | null }>(
      `SELECT dataset, outcome, checked_at, next_check_at, attempt_count, last_error FROM parser_api_checks WHERE inn = $1`,
      [inn],
    ),
    // Последний снимок каждого набора — по индексу (inn, dataset, fetched_at DESC, id DESC), 07.10.2026: DISTINCT ON
    // вычислял missing из payload каждого прежнего снимка (дела картотеки — крупные), а нужен только последний.
    db.query<{ dataset: ParserApiDataset; fetched_at: Date; complete: boolean; missing: string[] | null }>(
      `SELECT d.dataset, r.fetched_at, r.complete,
              ARRAY(SELECT jsonb_array_elements_text(coalesce(r.payload->'missing', '[]'::jsonb))) AS missing
       FROM unnest($2::text[]) AS d(dataset)
       JOIN LATERAL (
         SELECT fetched_at, complete, payload FROM parser_api_records
         WHERE inn = $1 AND dataset = d.dataset
         ORDER BY fetched_at DESC, id DESC LIMIT 1
       ) r ON true`,
      [inn, [...PARSER_API_DATASETS]],
    ),
  ]);
  return PARSER_API_DATASETS.map(dataset => {
    const check = checks.rows.find(r => r.dataset === dataset);
    const record = records.rows.find(r => r.dataset === dataset);
    return {
      dataset,
      outcome: check?.outcome ?? null,
      checkedAt: iso(check?.checked_at ?? null),
      nextCheckAt: iso(check?.next_check_at ?? null),
      attemptCount: check?.attempt_count ?? 0,
      lastError: check?.last_error ?? null,
      record: record ? { fetchedAt: iso(record.fetched_at)!, complete: record.complete, missing: record.missing ?? [] } : null,
    };
  });
};

/** Последний снимок набора целиком — для карт 24B/24C. */
export const latestParserApiRecord = async (
  db: DbExecutor,
  inn: string,
  dataset: ParserApiDataset,
): Promise<{ payload: IDatasetPayload; fetchedAt: string; complete: boolean } | null> => {
  const row = (
    await db.query<{ payload: IDatasetPayload; fetched_at: Date; complete: boolean }>(
      `SELECT payload, fetched_at, complete FROM parser_api_records WHERE inn = $1 AND dataset = $2
       ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      [inn, dataset],
    )
  ).rows[0];
  return row ? { payload: row.payload, fetchedAt: iso(row.fetched_at)!, complete: row.complete } : null;
};

/** Суммы исков из полученных карточек дел (миграция 048) по CaseId строчными. */
export const loadCaseClaims = async (db: DbExecutor, caseIds: readonly string[]): Promise<Map<string, ICaseClaim>> => {
  const ids = [...new Set(caseIds.map(id => id.toLowerCase()))];
  if (ids.length === 0) return new Map();
  const rows = (
    await db.query<{ case_id: string; payload: Record<string, unknown>; fetched_at: Date }>(
      `SELECT case_id, payload, fetched_at FROM parser_api_case_cards WHERE case_id = ANY($1::text[])`,
      [ids],
    )
  ).rows;
  return new Map(rows.map(r => [r.case_id, mapCaseCard(r.payload, r.case_id, iso(r.fetched_at)!)]));
};

/**
 * Подключение словами: ключа нет; ключ задан, но настоящего ответа ещё не было (проверка ключа без расхода
 * тарифа его не подтверждает); последний решающий ответ — успех или отказ по ключу, подписке, адресу. Считается
 * только после последней смены ключа в админке: отказ прежнему ключу о новом ничего не говорит.
 */
export type ParserApiConnectionState = 'none' | 'unverified' | 'connected' | 'key_rejected' | 'subscription_expired' | 'ip_rejected';

export const parserApiConnection = async (
  db: DbExecutor,
  keySet: boolean,
  keySince: string | null,
): Promise<{ state: ParserApiConnectionState; at: string | null }> => {
  if (!keySet) return { state: 'none', at: null };
  const row = (
    await db.query<{ outcome: ParserApiConnectionState | 'ok'; requested_at: Date }>(
      `SELECT outcome, requested_at FROM parser_api_requests
       WHERE outcome IN ('ok', 'key_rejected', 'subscription_expired', 'ip_rejected')
         AND ($1::timestamptz IS NULL OR requested_at >= $1)
       ORDER BY requested_at DESC, id DESC LIMIT 1`,
      [keySince],
    )
  ).rows[0];
  if (!row) return { state: 'unverified', at: null };
  return { state: row.outcome === 'ok' ? 'connected' : row.outcome, at: iso(row.requested_at) };
};

/**
 * Подключение по ключу, который сейчас в памяти процесса, — одно состояние для «Сервисов» и кнопок «Обновить» на
 * карточке (07.10.2026: карточка решала по «ключ задан», и при отклонённом ключе или закрытом адресе админка была
 * красной, а карточка предлагала обновить).
 */
export const currentParserApiConnection = (db: DbExecutor): Promise<{ state: ParserApiConnectionState; at: string | null }> => {
  const key = parserApiKeyStatus();
  return parserApiConnection(db, key.source !== 'none', key.source === 'admin' ? key.updatedAt : null);
};

export interface IParserApiCoverage {
  /** Компании «на контроле» с одним ИНН — их проверяет расписание. */
  watched: number;
  /** Проверенные наборы (есть / нет / часть) и наборы с неудачей последней попытки. */
  checked: number;
  failing: number;
  /** Наборы компаний «на контроле», которые ждут проверки. */
  due: number;
}

export const parserApiCoverage = async (db: DbExecutor): Promise<IParserApiCoverage> => {
  const row = (
    await db.query<IParserApiCoverage>(
      `WITH watched AS (
         SELECT w.company_id, array_agg(DISTINCT ei.value) AS inns
         FROM company_watch w
         JOIN companies c ON c.id = w.company_id AND c.merged_into_id IS NULL
         JOIN entity_identifiers ei ON ei.company_id = w.company_id AND ei.identifier_type = 'inn'
           AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
         WHERE w.removed_at IS NULL
         GROUP BY w.company_id
       ),
       single AS (SELECT DISTINCT inns[1] AS inn FROM watched WHERE cardinality(inns) = 1)
       SELECT (SELECT count(*) FROM single)::int AS watched,
              (SELECT count(*) FROM parser_api_checks WHERE outcome IS NOT NULL)::int AS checked,
              (SELECT count(*) FROM parser_api_checks WHERE attempt_count > 0)::int AS failing,
              (SELECT count(*) FROM single s CROSS JOIN unnest($1::text[]) AS d(dataset)
                 LEFT JOIN parser_api_checks ch ON ch.inn = s.inn AND ch.dataset = d.dataset
                WHERE ch.id IS NULL OR ch.next_check_at <= now())::int AS due`,
      [[...PARSER_API_DATASETS]],
    )
  ).rows[0];
  return row ?? { watched: 0, checked: 0, failing: 0, due: 0 };
};
