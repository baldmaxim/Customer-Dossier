// Суды, ФССП и банкротство компании для карточки и сводки (этап 24C): картотека арбитражных дел, исполнительные
// производства и ЕФРСБ из снимков parser-api.com.
//
// Только чтение, как финансы (parserApi/finance.ts): ИНН → состояние наборов → последний снимок → карты на чтении.
// «За 12 месяцев» считается от даты проверки набора; суммы исков — из карточек дел (миграция 048). Функцию
// переиспользует сводка «Как дела у …» (этап 25C).

import type { DbExecutor } from '../db/pool.js';
import { env } from '../config/env.js';
import { parserApiKey } from '../settings/parserApiKey.js';
import { caseCardsRunning } from './caseCards.js';
import type { IDatasetBlock } from './finance.js';
import { mapBankruptcy, type IBankruptcyView } from './map/bankruptcy.js';
import { mapCourts, type ICourtsView } from './map/courts.js';
import { mapFssp, type IFsspView } from './map/fssp.js';
import { currentParserApiConnection, latestParserApiRecord, loadCaseClaims, loadParserApiStates, type IParserApiDatasetState } from './read.js';
import { companyInn } from './targets.js';

export interface ICompanyChecks {
  inn: string | null;
  problem: 'no_inn' | 'several_inns' | null;
  configured: boolean;
  scheduled: boolean;
  /** Подключение сервиса — то же состояние, что ярлык в «Сервисах» (currentParserApiConnection). */
  connection: { state: string; at: string | null };
  courts: IDatasetBlock<ICourtsView> | null;
  /** Карточки дел (суммы исков) спрашиваются прямо сейчас — экран обновится сам. */
  claimsFetching: boolean;
  fssp: IDatasetBlock<IFsspView> | null;
  bankruptcy: IDatasetBlock<IBankruptcyView> | null;
}

export const loadCompanyChecks = async (db: DbExecutor, companyId: number): Promise<ICompanyChecks> => {
  const target = await companyInn(db, companyId);
  const base = { configured: parserApiKey() !== null, scheduled: env.PARSER_API_ENABLED, connection: await currentParserApiConnection(db) };
  if (!target.ok) return { ...base, inn: null, problem: target.problem, courts: null, claimsFetching: false, fssp: null, bankruptcy: null };

  const [states, courts, fssp, bankruptcy] = await Promise.all([
    loadParserApiStates(db, target.inn),
    latestParserApiRecord(db, target.inn, 'courts'),
    latestParserApiRecord(db, target.inn, 'fssp'),
    latestParserApiRecord(db, target.inn, 'bankruptcy'),
  ]);
  const stateOf = (dataset: 'courts' | 'fssp' | 'bankruptcy'): IParserApiDatasetState => states.find(s => s.dataset === dataset)!;
  const asOf = (dataset: 'courts' | 'fssp', fetchedAt: string): string => stateOf(dataset).checkedAt ?? fetchedAt;
  // Суммы исков — из карточек дел этого снимка картотеки (их могли получить и для другой стороны дела).
  const caseIds = courts ? mapCourts(courts.payload, null, true).cases.map(c => c.id).filter((id): id is string => id !== null) : [];
  const claims = await loadCaseClaims(db, caseIds);
  return {
    ...base,
    inn: target.inn,
    problem: null,
    courts: { state: stateOf('courts'), view: courts ? mapCourts(courts.payload, asOf('courts', courts.fetchedAt), courts.complete, claims) : null },
    claimsFetching: caseCardsRunning(target.inn),
    fssp: { state: stateOf('fssp'), view: fssp ? mapFssp(fssp.payload, asOf('fssp', fssp.fetchedAt), fssp.complete) : null },
    bankruptcy: { state: stateOf('bankruptcy'), view: bankruptcy ? mapBankruptcy(bankruptcy.payload) : null },
  };
};
