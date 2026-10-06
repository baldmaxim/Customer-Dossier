// По какому ИНН компания спрашивается у parser-api.com и чья очередь по расписанию (этап 24A).
//
// Только ИНН с верной контрольной суммой из реестра entity_identifiers (ADR-005): реестры сервиса ищут по ИНН.
// Два разных ИНН у одной карточки — вопрос опознания, а не повод платить за оба. По расписанию — только
// компании «на контроле» (ADR-016): бесплатный тариф — 200 запросов в месяц, полная проверка компании —
// 6–9 запросов. Остальные — кнопкой «Обновить» в карточке.

import type { DbExecutor } from '../db/pool.js';
import { PARSER_API_DATASETS, type ParserApiDataset } from './datasets.js';

export type CompanyInnTarget = { ok: true; inn: string } | { ok: false; problem: 'no_inn' | 'several_inns' };

export const pickInn = (values: readonly string[]): CompanyInnTarget => {
  const inns = [...new Set(values)];
  if (inns.length === 1) return { ok: true, inn: inns[0]! };
  return { ok: false, problem: inns.length === 0 ? 'no_inn' : 'several_inns' };
};

export const companyInn = async (db: DbExecutor, companyId: number): Promise<CompanyInnTarget> => {
  const rows = (
    await db.query<{ value: string }>(
      `SELECT value FROM entity_identifiers
       WHERE company_id = $1 AND identifier_type = 'inn' AND status = 'active' AND validation_status = 'checksum_valid'`,
      [companyId],
    )
  ).rows;
  return pickInn(rows.map(r => r.value));
};

export interface IParserApiTarget {
  companyId: number;
  inn: string;
  /** Наборы, чей срок пришёл или которые не проверяли. */
  datasets: ParserApiDataset[];
}

/**
 * Компании «на контроле» с одним ИНН, у которых хоть один набор ждёт проверки. Первыми — не проверявшиеся,
 * затем самые давние.
 */
export const dueParserApiTargets = async (db: DbExecutor, limit: number): Promise<IParserApiTarget[]> => {
  const rows = (
    await db.query<{ companyId: number; inn: string; due: string[] }>(
      `WITH watched AS MATERIALIZED (
         SELECT w.company_id, w.added_at, array_agg(DISTINCT ei.value) AS inns
         FROM company_watch w
         JOIN companies c ON c.id = w.company_id AND c.merged_into_id IS NULL
         JOIN entity_identifiers ei ON ei.company_id = w.company_id AND ei.identifier_type = 'inn'
           AND ei.status = 'active' AND ei.validation_status = 'checksum_valid'
         WHERE w.removed_at IS NULL
         GROUP BY w.company_id, w.added_at
       ),
       due AS (
         SELECT wt.company_id, wt.added_at, wt.inns[1] AS inn, d.dataset, ch.next_check_at
         FROM watched wt
         CROSS JOIN unnest($2::text[]) AS d(dataset)
         LEFT JOIN parser_api_checks ch ON ch.inn = wt.inns[1] AND ch.dataset = d.dataset
         WHERE cardinality(wt.inns) = 1 AND (ch.id IS NULL OR ch.next_check_at <= now())
       )
       SELECT company_id AS "companyId", inn, array_agg(dataset ORDER BY dataset) AS due
       FROM due
       GROUP BY company_id, inn, added_at
       ORDER BY bool_or(next_check_at IS NULL) DESC, min(next_check_at) NULLS FIRST, added_at, company_id
       LIMIT $1`,
      [limit, [...PARSER_API_DATASETS]],
    )
  ).rows;
  return rows.map(r => ({
    companyId: r.companyId,
    inn: r.inn,
    // Порядок наборов — как в PARSER_API_DATASETS: отчётность первой.
    datasets: PARSER_API_DATASETS.filter(d => r.due.includes(d)),
  }));
};
