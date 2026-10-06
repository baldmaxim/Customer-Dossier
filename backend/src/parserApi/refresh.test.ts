// Проход parser-api.com без базы и сети (этап 24A): резерв лимита до запроса, остановки, снимки и сроки.

import { describe, expect, it } from 'vitest';

import { serviceOf, type callParserApi, type ParserApiCallResult } from './client.js';
import { refreshParserApiDatasets } from './refresh.js';
import type { IJournalFinish, IParserApiStore, IParserApiUsage } from './store.js';

const INN = '7736255508';

/** Хранилище в памяти; лимит — по сервису тарифа, как в базе. */
const memoryStore = (before: Record<string, IParserApiUsage> = {}) => {
  const journal: Array<{ method: string; finish?: IJournalFinish }> = [];
  const records: Array<{ dataset: string; complete: boolean }> = [];
  const checked: Array<{ dataset: string; outcome: string; requestedBy: string | null }> = [];
  const failed: Array<{ dataset: string; error: string }> = [];
  const store: IParserApiStore = {
    usage: async () => before,
    reserve: async (entry, limits) => {
      const service = serviceOf(entry.method);
      const base = before[service] ?? { day: 0, month: 0 };
      const used = journal.filter(j => serviceOf(j.method as 'key_check') === service && (!j.finish || j.finish.outcome === 'ok')).length;
      const usage = { day: base.day + used, month: base.month + used };
      if (usage.day + 1 > limits.daily) return { ok: false, reason: 'daily_limit', service, usage };
      if (usage.month + 1 > limits.monthly) return { ok: false, reason: 'monthly_limit', service, usage };
      journal.push({ method: entry.method });
      return { ok: true, id: journal.length - 1 };
    },
    finish: async (id, result) => {
      journal[id]!.finish = result;
    },
    saveRecord: async (_inn, dataset, _payload, complete) => {
      records.push({ dataset, complete });
      return true;
    },
    markChecked: async (_inn, dataset, outcome, requestedBy) => void checked.push({ dataset, outcome, requestedBy }),
    markFailed: async (_inn, dataset, error) => void failed.push({ dataset, error }),
    knownCaseCards: async () => new Set(),
    saveCaseCard: async () => true,
    latestRecord: async () => null,
  };
  return { store, journal, records, checked, failed };
};

const fakeCall = (replies: ParserApiCallResult[]): typeof callParserApi => async () => {
  const reply = replies.shift();
  if (!reply) throw new Error('лишний запрос');
  return reply;
};

const ok = (body: Record<string, unknown>): ParserApiCallResult => ({ ok: true, httpStatus: 200, body });
const fail = (failure: 'key_rejected' | 'network' | 'ip_rejected', apiCode: number | null = null): ParserApiCallResult => ({ ok: false, failure, httpStatus: 403, apiCode, error: 'отказ' });
const limits = { daily: 20, monthly: 200 };

describe('refreshParserApiDatasets (T24A-06)', () => {
  it('без ключа — ни одного запроса', async () => {
    const m = memoryStore();
    expect(await refreshParserApiDatasets(INN, ['tax'], 'scheduler', { store: m.store, key: null, limits, kadMaxPages: 3 })).toMatchObject({ status: 'stopped', reason: 'no_key' });
    expect(m.journal).toEqual([]);
  });

  it('каждый запрос сначала резервируется и закрывается итогом; набор записан, срок проверки поставлен', async () => {
    const m = memoryStore();
    const res = await refreshParserApiDatasets(INN, ['tax', 'fssp'], 'ivanov', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      call: fakeCall([ok({ success: 1, org: [{ inn: INN }] }), ok({ done: 1, result: [] })]),
    });
    expect(res).toEqual({
      status: 'done',
      datasets: { tax: { status: 'checked', outcome: 'found', saved: true }, fssp: { status: 'checked', outcome: 'not_found', saved: true } },
      blocked: {},
    });
    expect(m.journal.map(j => [j.method, j.finish?.outcome])).toEqual([
      ['pb_org', 'ok'],
      ['fssp_ur', 'ok'],
    ]);
    expect(m.checked).toEqual([
      { dataset: 'tax', outcome: 'found', requestedBy: 'ivanov' },
      { dataset: 'fssp', outcome: 'not_found', requestedBy: 'ivanov' },
    ]);
  });

  it('лимит портала сервиса кончился посреди набора — снимок части, срок не сдвинут как неудача; другие сервисы идут', async () => {
    // У nalog_bo осталось одно место; у nalog_pb (налоги) лимит свой.
    const m = memoryStore({ nalog_bo: { day: 19, month: 19 } });
    const res = await refreshParserApiDatasets(INN, ['finance', 'tax'], 'scheduler', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      call: fakeCall([ok({ success: 1, items: [{ id: 7, inn: INN }] }), ok({ success: 1, org: [{ inn: INN }] })]),
    });
    expect(res).toMatchObject({
      status: 'done',
      blocked: { nalog_bo: 'daily_limit' },
      datasets: { finance: { status: 'checked', outcome: 'partial' }, tax: { status: 'checked', outcome: 'found' } },
    });
    expect(m.records).toEqual([
      { dataset: 'finance', complete: false },
      { dataset: 'tax', complete: true },
    ]);
    expect(m.failed).toEqual([]);
  });

  it('отказ сервиса по месячному лимиту (40305) — его наборы дальше не спрашиваются, у других компаний прохода тоже', async () => {
    const m = memoryStore();
    const blocked = new Map();
    const refused: ParserApiCallResult = { ok: false, failure: 'monthly_limit', httpStatus: 403, apiCode: 40305, error: 'Month limit of requests exceeded' };
    const first = await refreshParserApiDatasets(INN, ['courts', 'fssp'], 'scheduler', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      blocked,
      call: fakeCall([refused, ok({ done: 1, result: [] })]),
    });
    expect(first).toMatchObject({ status: 'done', blocked: { arbitr: 'monthly_limit' }, datasets: { courts: { status: 'failed' }, fssp: { status: 'checked' } } });
    // Вторая компания того же прохода: картотека не спрашивается вовсе, ФССП — да.
    const second = await refreshParserApiDatasets('7704412966', ['courts', 'fssp'], 'scheduler', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      blocked,
      call: fakeCall([ok({ done: 1, result: [] })]),
    });
    expect(second).toMatchObject({ datasets: { courts: { status: 'failed', error: 'arbitr: monthly_limit — не запрашивалось' }, fssp: { status: 'checked' } } });
    expect(m.journal.map(j => j.method)).toEqual(['kad_search', 'fssp_ur', 'fssp_ur']);
    // Лимит — не неудача набора: срок проверки картотеки не сдвинут.
    expect(m.failed).toEqual([]);
  });

  it('ключ не принят — проход останавливается на первом запросе, очередь не перебирается', async () => {
    const m = memoryStore();
    const res = await refreshParserApiDatasets(INN, ['tax', 'fssp', 'courts'], 'scheduler', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      call: fakeCall([fail('key_rejected', 40301)]),
    });
    expect(res).toMatchObject({ status: 'stopped', reason: 'key_rejected' });
    expect(m.journal).toHaveLength(1);
    expect(m.journal[0]!.finish).toMatchObject({ outcome: 'key_rejected', apiCode: 40301 });
  });

  it('сбой сети — набор уходит на повтор, следующие наборы проверяются', async () => {
    const m = memoryStore();
    const res = await refreshParserApiDatasets(INN, ['tax', 'fssp'], 'scheduler', {
      store: m.store,
      key: 'k',
      limits,
      kadMaxPages: 3,
      call: fakeCall([fail('network'), ok({ done: 1, result: [] })]),
    });
    expect(res.status).toBe('done');
    expect(m.failed.map(f => f.dataset)).toEqual(['tax']);
    expect(m.checked.map(c => c.dataset)).toEqual(['fssp']);
  });
});
