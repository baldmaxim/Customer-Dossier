// Финансы компании для карточки и сводки (этап 24B): ГИР БО и «Прозрачный бизнес» из снимков parser-api.com.
//
// Только чтение: ИНН компании → состояние наборов finance и tax → последний снимок каждого → карты на чтении
// (map/finance.ts, map/tax.ts). Запросов к сервису здесь нет — их делает refresh.ts по кнопке или расписанию.
// Функцию переиспользует сводка «Как дела у …» (этап 25C): ничего не досчитывать заново.

import type { DbExecutor } from '../db/pool.js';
import { env } from '../config/env.js';
import { parserApiKey } from '../settings/parserApiKey.js';
import { mapFinance, type IFinanceView } from './map/finance.js';
import { mapTax, type ITaxView } from './map/tax.js';
import { currentParserApiConnection, latestParserApiRecord, loadParserApiStates, type IParserApiDatasetState } from './read.js';
import { companyInn } from './targets.js';

export interface IDatasetBlock<TView> {
  state: IParserApiDatasetState;
  /** Карта последнего снимка; null — снимка нет. */
  view: TView | null;
}

export interface ICompanyFinance {
  inn: string | null;
  problem: 'no_inn' | 'several_inns' | null;
  /** Ключ parser-api.com задан: «Обновить» может спросить сервис. */
  configured: boolean;
  scheduled: boolean;
  /** Подключение сервиса — то же состояние, что ярлык в «Сервисах» (currentParserApiConnection). */
  connection: { state: string; at: string | null };
  finance: IDatasetBlock<IFinanceView> | null;
  tax: IDatasetBlock<ITaxView> | null;
}

export const loadCompanyFinance = async (db: DbExecutor, companyId: number): Promise<ICompanyFinance> => {
  const target = await companyInn(db, companyId);
  const base = { configured: parserApiKey() !== null, scheduled: env.PARSER_API_ENABLED, connection: await currentParserApiConnection(db) };
  if (!target.ok) return { ...base, inn: null, problem: target.problem, finance: null, tax: null };

  const [states, finance, tax] = await Promise.all([
    loadParserApiStates(db, target.inn),
    latestParserApiRecord(db, target.inn, 'finance'),
    latestParserApiRecord(db, target.inn, 'tax'),
  ]);
  const stateOf = (dataset: 'finance' | 'tax'): IParserApiDatasetState => states.find(s => s.dataset === dataset)!;
  return {
    ...base,
    inn: target.inn,
    problem: null,
    finance: { state: stateOf('finance'), view: finance ? mapFinance(finance.payload) : null },
    tax: { state: stateOf('tax'), view: tax ? mapTax(tax.payload) : null },
  };
};
