// Карточки дел ради суммы иска без базы и сети: выбор дел, один раз на дело, предел за проход, остановки.

import { describe, expect, it } from 'vitest';

import { caseCardsRunning, fetchCaseCards, pendingCaseCards } from './caseCards.js';
import type { callParserApi, ParserApiCallResult } from './client.js';
import type { IDatasetPayload } from './datasets.js';
import type { IParserApiStore } from './store.js';

const INN = '7736255508';
const ME = { Inn: INN, Name: 'ООО «Демо»' };
const guid = (n: number): string => `${String(n).padStart(8, '0')}-2222-3333-4444-555555555555`;

/** Картотека: дела 1–4 — экономические, компания — ответчик (новые сверху), 5 — истец, 6 — административное. */
const COURTS: IDatasetPayload = {
  format: 'parser-api-dataset@1',
  dataset: 'courts',
  inn: INN,
  window: { from: '2024-10-01' },
  missing: [],
  responses: [
    {
      method: 'kad_search',
      params: { page: '1' },
      body: {
        Success: 1,
        Cases: [
          ...[1, 2, 3, 4].map(n => ({ CaseId: guid(n), CaseNumber: `А40-${n}/2026`, CaseType: 'Г', StartDate: `2026-0${9 - n}-01`, Plaintiffs: [{ Name: 'Истец' }], Respondents: [ME] })),
          { CaseId: guid(5), CaseNumber: 'А40-5/2026', CaseType: 'Г', StartDate: '2026-09-15', Plaintiffs: [ME], Respondents: [{ Name: 'Должник' }] },
          { CaseId: guid(6), CaseNumber: 'А40-6/2026', CaseType: 'А', StartDate: '2026-09-20', Plaintiffs: [{ Name: 'ИФНС' }], Respondents: [ME] },
        ],
      },
    },
  ],
};

const memoryStore = (known: string[] = [], daily = 20) => {
  const journal: Array<{ method: string; outcome?: string }> = [];
  const saved: string[] = [];
  const store: IParserApiStore = {
    usage: async () => ({ day: 0, month: 0 }),
    reserve: async entry => {
      if (journal.filter(j => j.outcome !== 'network').length + 1 > daily) return { ok: false, reason: 'daily_limit', usage: { day: daily, month: daily } };
      journal.push({ method: entry.method });
      return { ok: true, id: journal.length - 1 };
    },
    finish: async (id, result) => {
      journal[id]!.outcome = result.outcome;
    },
    saveRecord: async () => true,
    markChecked: async () => undefined,
    markFailed: async () => undefined,
    latestCourts: async () => COURTS,
    knownCaseCards: async ids => new Set(ids.filter(id => known.includes(id) || saved.includes(id))),
    saveCaseCard: async caseId => {
      saved.push(caseId);
      return true;
    },
  };
  return { store, journal, saved };
};

const card = (): ParserApiCallResult => ({ ok: true, httpStatus: 200, body: { Success: 1, Cases: [] } });
const network = (): ParserApiCallResult => ({ ok: false, failure: 'network', httpStatus: null, apiCode: null, error: 'timeout' });
const replies = (list: Array<() => ParserApiCallResult>): { call: typeof callParserApi; params: Array<Record<string, string>> } => {
  const params: Array<Record<string, string>> = [];
  return {
    params,
    call: async (_method, p) => {
      params.push({ ...p });
      const next = list.shift();
      if (!next) throw new Error('лишний запрос');
      return next();
    },
  };
};
const limits = { daily: 20, monthly: 200 };

describe('карточки дел ради суммы иска', () => {
  it('нужны экономические споры, где компания — ответчик, новые сверху; полученные не спрашиваются снова', async () => {
    expect(await pendingCaseCards(INN, memoryStore([guid(2)]).store)).toEqual([guid(1), guid(3), guid(4)]);
  });

  it('не больше предела за проход, каждое дело — kad_details по CaseId; остаток виден', async () => {
    const m = memoryStore();
    const r = replies([card, card]);
    const res = await fetchCaseCards(INN, 'ivanov', 2, { store: m.store, key: 'k', limits, call: r.call });
    expect(res).toEqual({ fetched: 2, pending: 2, failed: 0, stop: null });
    expect(m.journal).toEqual([
      { method: 'kad_details', outcome: 'ok' },
      { method: 'kad_details', outcome: 'ok' },
    ]);
    expect(r.params).toEqual([{ CaseId: guid(1) }, { CaseId: guid(2) }]);
    expect(m.saved).toEqual([guid(1), guid(2)]);
  });

  it('лимит портала — остановка с причиной, без запроса сверх лимита', async () => {
    const m = memoryStore([], 1);
    const res = await fetchCaseCards(INN, 'scheduler', 10, { store: m.store, key: 'k', limits, call: replies([card]).call });
    expect(res).toEqual({ fetched: 1, pending: 3, failed: 0, stop: 'daily_limit' });
  });

  it('два сбоя — проход заканчивается, неоплаченное ждёт следующего; без ключа — ни одного запроса', async () => {
    const m = memoryStore();
    expect(await fetchCaseCards(INN, 'scheduler', 10, { store: m.store, key: 'k', limits, call: replies([network, card, network]).call })).toEqual({
      fetched: 1,
      pending: 3,
      failed: 2,
      stop: null,
    });
    const bare = memoryStore();
    expect(await fetchCaseCards(INN, 'scheduler', 10, { store: bare.store, key: null, limits })).toMatchObject({ stop: 'no_key' });
    expect(bare.journal).toEqual([]);
  });

  it('по одному ИНН одновременно — один проход: второй ничего не спрашивает', async () => {
    const m = memoryStore();
    let release: () => void = () => undefined;
    const slow: typeof callParserApi = () => new Promise(resolve => (release = () => resolve(card())));
    const first = fetchCaseCards(INN, 'ivanov', 1, { store: m.store, key: 'k', limits, call: slow });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(caseCardsRunning(INN)).toBe(true);
    expect(await fetchCaseCards(INN, 'scheduler', 10, { store: m.store, key: 'k', limits, call: replies([]).call })).toEqual({ fetched: 0, pending: 0, failed: 0, stop: null });
    release();
    expect(await first).toMatchObject({ fetched: 1 });
    expect(caseCardsRunning(INN)).toBe(false);
  });
});
