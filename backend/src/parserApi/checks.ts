// Суды, ФССП и банкротство компании для карточки и сводки (этап 24C): картотека арбитражных дел, исполнительные
// производства и ЕФРСБ из снимков parser-api.com.
//
// Только чтение, как финансы (parserApi/finance.ts): ИНН → состояние наборов → последний снимок → карты на чтении.
// «За 12 месяцев» считается от даты проверки набора. Функцию переиспользует сводка «Как дела у …» (этап 25C).

import type { DbExecutor } from '../db/pool.js';
import { env } from '../config/env.js';
import { parserApiKey } from '../settings/parserApiKey.js';
import type { IDatasetBlock } from './finance.js';
import { mapBankruptcy, type IBankruptcyView } from './map/bankruptcy.js';
import { mapCourts, type ICourtsView } from './map/courts.js';
import { mapFssp, type IFsspView } from './map/fssp.js';
import { latestParserApiRecord, loadParserApiStates, type IParserApiDatasetState } from './read.js';
import { companyInn } from './targets.js';

export interface ICompanyChecks {
  inn: string | null;
  problem: 'no_inn' | 'several_inns' | null;
  configured: boolean;
  scheduled: boolean;
  courts: IDatasetBlock<ICourtsView> | null;
  fssp: IDatasetBlock<IFsspView> | null;
  bankruptcy: IDatasetBlock<IBankruptcyView> | null;
}

export const loadCompanyChecks = async (db: DbExecutor, companyId: number): Promise<ICompanyChecks> => {
  const target = await companyInn(db, companyId);
  const base = { configured: parserApiKey() !== null, scheduled: env.PARSER_API_ENABLED };
  if (!target.ok) return { ...base, inn: null, problem: target.problem, courts: null, fssp: null, bankruptcy: null };

  const [states, courts, fssp, bankruptcy] = await Promise.all([
    loadParserApiStates(db, target.inn),
    latestParserApiRecord(db, target.inn, 'courts'),
    latestParserApiRecord(db, target.inn, 'fssp'),
    latestParserApiRecord(db, target.inn, 'bankruptcy'),
  ]);
  const stateOf = (dataset: 'courts' | 'fssp' | 'bankruptcy'): IParserApiDatasetState => states.find(s => s.dataset === dataset)!;
  const asOf = (dataset: 'courts' | 'fssp', fetchedAt: string): string => stateOf(dataset).checkedAt ?? fetchedAt;
  return {
    ...base,
    inn: target.inn,
    problem: null,
    courts: { state: stateOf('courts'), view: courts ? mapCourts(courts.payload, asOf('courts', courts.fetchedAt), courts.complete) : null },
    fssp: { state: stateOf('fssp'), view: fssp ? mapFssp(fssp.payload, asOf('fssp', fssp.fetchedAt), fssp.complete) : null },
    bankruptcy: { state: stateOf('bankruptcy'), view: bankruptcy ? mapBankruptcy(bankruptcy.payload) : null },
  };
};
