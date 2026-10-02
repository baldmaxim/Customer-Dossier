// Обновление сведений Фокуса без сети и базы: вызов API и хранилище подменены.
// Главное — деньги тарифа: без ключа и сверх лимита запросов нет, неизвестная компания стоит один запрос.

import { describe, expect, it } from 'vitest';

import { payloadHash } from '../snapshot/canonical.js';
import type { callFocus, FocusCallResult, FocusMethod, IFocusIdentifier } from './client.js';
import { newPassState, refreshFocusTarget } from './refresh.js';
import { SCHEDULER_ACTOR, type IFocusJournalEntry, type IFocusStore } from './store.js';
import { pickTarget } from './targets.js';

const TARGET: IFocusIdentifier = { type: 'inn', value: '7701000001' };
const KEY = 'demo-focus-key-0001';

const found = (extra: Record<string, unknown> = {}): FocusCallResult => ({
  ok: true,
  httpStatus: 200,
  items: [{ inn: TARGET.value, ogrn: '1027700000001', payload: { inn: TARGET.value, ogrn: '1027700000001', UL: {}, ...extra } }],
});

const memoryStore = (used = 0) => {
  const journal: IFocusJournalEntry[] = [];
  const records: Array<{ method: FocusMethod; hash: string }> = [];
  const checks: Array<{ outcome: string; requestedBy: string | null }> = [];
  const failures: string[] = [];
  const store: IFocusStore = {
    usedLastDay: async () => used + journal.filter(j => j.outcome === 'ok').reduce((s, j) => s + j.identifiersCount, 0),
    journal: async entry => void journal.push(entry),
    saveRecord: async (_target, method, item) => {
      const hash = payloadHash(item.payload);
      const last = [...records].reverse().find(r => r.method === method);
      if (last?.hash === hash) return false;
      records.push({ method, hash });
      return true;
    },
    markChecked: async (_target, outcome, requestedBy) => void checks.push({ outcome, requestedBy }),
    markFailed: async (_target, error) => void failures.push(error),
  };
  return { store, journal, records, checks, failures };
};

const scripted = (answers: Partial<Record<FocusMethod, FocusCallResult>>) => {
  const calls: FocusMethod[] = [];
  const call: typeof callFocus = async method => {
    calls.push(method);
    const answer = answers[method];
    if (!answer) throw new Error(`неожиданный вызов ${method}`);
    return answer;
  };
  return { call, calls };
};

const deps = (m: ReturnType<typeof memoryStore>, call: typeof callFocus, over: Partial<Parameters<typeof refreshFocusTarget>[2]> = {}) => ({
  store: m.store,
  key: KEY,
  dailyLimit: 100,
  refreshDays: 14,
  call,
  ...over,
});

describe('refreshFocusTarget', () => {
  it('найдена: req и egrDetails, два снимка, срок проверки; повтор без изменений снимков не пишет', async () => {
    const m = memoryStore();
    const s = scripted({ req: found(), egrDetails: found({ activities: {} }) });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(m, s.call))).toEqual({ status: 'found', saved: 2, skippedMethods: [] });
    expect(s.calls).toEqual(['req', 'egrDetails']);
    expect(m.journal.map(j => [j.method, j.outcome, j.actor])).toEqual([
      ['req', 'ok', 'alpha'],
      ['egrDetails', 'ok', 'alpha'],
    ]);
    expect(m.checks).toEqual([{ outcome: 'found', requestedBy: 'alpha' }]);

    expect(await refreshFocusTarget(TARGET, SCHEDULER_ACTOR, deps(m, s.call))).toEqual({ status: 'found', saved: 0, skippedMethods: [] });
    expect(m.records).toHaveLength(2);
    // Проход по расписанию не подписывается логином.
    expect(m.checks[1]).toEqual({ outcome: 'found', requestedBy: null });
  });

  it('Фокус не знает компанию — один запрос: egrDetails не спрашивается', async () => {
    const m = memoryStore();
    const s = scripted({ req: { ok: true, httpStatus: 200, items: [] } });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(m, s.call))).toEqual({ status: 'not_found', saved: 0, skippedMethods: [] });
    expect(s.calls).toEqual(['req']);
    expect(m.checks).toEqual([{ outcome: 'not_found', requestedBy: 'alpha' }]);
  });

  it('чужая компания в ответе — не наша: снимок не пишется', async () => {
    const m = memoryStore();
    const other: FocusCallResult = { ok: true, httpStatus: 200, items: [{ inn: '7702000002', ogrn: null, payload: { inn: '7702000002' } }] };
    const s = scripted({ req: other });
    expect((await refreshFocusTarget(TARGET, 'alpha', deps(m, s.call))).status).toBe('not_found');
    expect(m.records).toEqual([]);
  });

  it('без ключа и сверх лимита — ни одного запроса', async () => {
    const s = scripted({});
    const m = memoryStore();
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(m, s.call, { key: null }))).toMatchObject({ status: 'stopped', reason: 'no_key' });
    // 99 из 100: на компанию нужно два запроса.
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(memoryStore(99), s.call))).toMatchObject({ status: 'stopped', reason: 'limit' });
    expect(s.calls).toEqual([]);
  });

  it('403 на req — ключ не принят: остановка, компания не считается сбойной', async () => {
    const m = memoryStore();
    const s = scripted({ req: { ok: false, failure: 'forbidden', httpStatus: 403, error: 'denied' } });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(m, s.call))).toEqual({ status: 'stopped', reason: 'key_rejected', detail: 'denied' });
    expect(m.journal[0]).toMatchObject({ method: 'req', outcome: 'key_rejected', httpStatus: 403 });
    expect(m.failures).toEqual([]);
    expect(m.checks).toEqual([]);
  });

  it('403 на egrDetails — метода нет в тарифе: req сохраняется, в этом проходе egrDetails больше не спрашивается', async () => {
    const m = memoryStore();
    const state = newPassState();
    const s = scripted({ req: found(), egrDetails: { ok: false, failure: 'forbidden', httpStatus: 403, error: 'no access' } });
    expect(await refreshFocusTarget(TARGET, SCHEDULER_ACTOR, deps(m, s.call, { state }))).toEqual({
      status: 'found',
      saved: 1,
      skippedMethods: ['egrDetails'],
    });
    expect(m.journal[1]).toMatchObject({ method: 'egrDetails', outcome: 'method_forbidden' });
    await refreshFocusTarget({ type: 'inn', value: '7702000002' }, SCHEDULER_ACTOR, deps(m, s.call, { state }));
    expect(s.calls).toEqual(['req', 'egrDetails', 'req']);
  });

  it('тариф исчерпан, слишком часто — остановка; сбой Фокуса — компания на повтор', async () => {
    const quota = scripted({ req: { ok: false, failure: 'quota_exhausted', httpStatus: 402, error: 'limit' } });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(memoryStore(), quota.call))).toMatchObject({ status: 'stopped', reason: 'quota_exhausted' });
    const slow = scripted({ req: { ok: false, failure: 'rate_limited', httpStatus: 429, error: 'slow' } });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(memoryStore(), slow.call))).toMatchObject({ status: 'stopped', reason: 'rate_limited' });

    const m = memoryStore();
    const broken = scripted({ req: { ok: false, failure: 'http_error', httpStatus: 500, error: 'oops' } });
    expect(await refreshFocusTarget(TARGET, 'alpha', deps(m, broken.call))).toEqual({ status: 'failed', error: 'req: oops' });
    expect(m.failures).toEqual(['req: oops']);
    expect(m.journal[0]).toMatchObject({ outcome: 'http_error', identifiersCount: 1 });
  });
});

describe('pickTarget', () => {
  it('ИНН главнее ОГРН; два разных ИНН — не спрашиваем; ОГРНИП — как ОГРН', () => {
    expect(pickTarget([{ type: 'ogrn', value: '1027700000001' }, { type: 'inn', value: '7701000001' }])).toEqual({
      ok: true,
      target: { type: 'inn', value: '7701000001' },
    });
    expect(pickTarget([{ type: 'inn', value: '7701000001' }, { type: 'inn', value: '7701000001' }])).toMatchObject({ ok: true });
    expect(pickTarget([{ type: 'inn', value: '7701000001' }, { type: 'inn', value: '7702000002' }])).toEqual({ ok: false, problem: 'several_identifiers' });
    expect(pickTarget([{ type: 'ogrnip', value: '304770000000002' }])).toEqual({ ok: true, target: { type: 'ogrn', value: '304770000000002' } });
    expect(pickTarget([{ type: 'kpp', value: '770101001' }])).toEqual({ ok: false, problem: 'no_identifier' });
    expect(pickTarget([])).toEqual({ ok: false, problem: 'no_identifier' });
  });
});
