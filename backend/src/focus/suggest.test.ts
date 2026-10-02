// Поиск юрлица по названию (ADR-016, этап 23D) без сети и базы: адрес запроса, терпимая карта ответа,
// отбор подсказок по совпадению названия, расход и остановки. Структура ответа suggest в открытом
// описании API не названа — фикстуры вымышленные; проба живого ответа — `npm run focus -- --suggest`.

import { describe, expect, it } from 'vitest';

import type { DbExecutor } from '../db/pool.js';
import type { SafeTransport } from '../net/safeFetch.js';
import { callFocusSuggest, type FocusCallResult } from './client.js';
import { pickSuggestions, searchCompanyName, suggestionView } from './suggest.js';
import type { IFocusJournalEntry } from './store.js';

const KEY = 'demo-focus-key-0001';

describe('callFocusSuggest', () => {
  it('адрес /api3/suggest?q=…; список или список в items', async () => {
    const seen: URL[] = [];
    const transport: SafeTransport = async url => {
      seen.push(url);
      return { status: 200, headers: {}, body: Buffer.from('[{"inn":"7707083893","name":"ПАО СБЕРБАНК"},{"name":"без реквизита"}]') };
    };
    const res = await callFocusSuggest('Сбербанк', KEY, { transport });
    expect(seen[0]!.origin + seen[0]!.pathname).toBe('https://focus-api.kontur.ru/api3/suggest');
    expect(seen[0]!.searchParams.get('q')).toBe('Сбербанк');
    expect(res).toMatchObject({ ok: true, items: [{ inn: '7707083893' }, { inn: null, ogrn: null }] });

    const wrapped: SafeTransport = async () => ({ status: 200, headers: {}, body: Buffer.from('{"items":[{"ogrn":"1027700132195"}]}') });
    expect(await callFocusSuggest('Сбербанк', KEY, { transport: wrapped })).toMatchObject({ ok: true, items: [{ ogrn: '1027700132195' }] });
    const broken: SafeTransport = async () => ({ status: 200, headers: {}, body: Buffer.from('<html>') });
    expect(await callFocusSuggest('Сбербанк', KEY, { transport: broken })).toMatchObject({ ok: false, failure: 'bad_response' });
  });
});

describe('suggestionView', () => {
  it('название, адрес и статус — из разных возможных полей', () => {
    expect(suggestionView({ name: 'ООО "ДЕМО"', address: 'г Москва', status: 'Действующее' }, '7707083893', null)).toEqual({
      inn: '7707083893', ogrn: null, name: 'ООО "ДЕМО"', address: 'г Москва', status: 'Действующее',
    });
    expect(suggestionView({ UL: { legalName: { short: 'АО "ДЕМО"' }, status: { statusString: 'Действующее' } } }, null, '1027700132195')).toMatchObject({
      name: 'АО "ДЕМО"', status: 'Действующее',
    });
    expect(suggestionView({ IP: { fio: 'Сидоров С. С.' } }, '500100732259', null).name).toBe('ИП Сидоров С. С.');
    expect(suggestionView({}, '7707083893', null)).toMatchObject({ name: null, address: null, status: null });
  });
});

describe('pickSuggestions', () => {
  const item = (inn: string | null, name: string, ogrn: string | null = null) => ({ inn, ogrn, payload: { name } });

  it('только совпавшее с названием, с реквизитом правильной длины, без повторов, не больше пяти', () => {
    const picked = pickSuggestions('Донстрой', [
      item('7707083893', 'СЗ ДОНСТРОЙ'),
      item('7707083893', 'СЗ ДОНСТРОЙ'),
      item('7701000001', 'Новый Дон'),
      item('77010000011', 'ДОНСТРОЙ ИНВЕСТ'),
      item(null, 'ГК ДОНСТРОЙ', '1027700132195'),
      ...Array.from({ length: 6 }, (_, i) => item(`77070838${10 + i}`, `ДОНСТРОЙ ${i}`)),
    ]);
    expect(picked.map(p => p.payload.name)).toEqual(['СЗ ДОНСТРОЙ', 'ГК ДОНСТРОЙ', 'ДОНСТРОЙ 0', 'ДОНСТРОЙ 1', 'ДОНСТРОЙ 2']);
  });
});

/** База в памяти: запоминает запросы, отвечает пусто. */
const fakeDb = () => {
  const calls: string[] = [];
  const db = { query: async (sql: string) => { calls.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { rows: [], rowCount: 1 }; } };
  return { db: db as unknown as DbExecutor, calls };
};

const store = (used = 0) => {
  const journal: IFocusJournalEntry[] = [];
  return { journal, store: { usedLastDay: async () => used, journal: async (e: IFocusJournalEntry) => { journal.push(e); } } };
};

const answer = (result: FocusCallResult) => async () => result;

describe('searchCompanyName', () => {
  const company = { id: 7, name: 'Донстрой' };

  it('ответ — запрос в журнал, подсказки вместо прежних, срок следующего поиска', async () => {
    const { db, calls } = fakeDb();
    const s = store();
    const result = await searchCompanyName(db, company, 'oper', {
      ...s, key: KEY, dailyLimit: 100,
      call: answer({ ok: true, httpStatus: 200, items: [{ inn: '7707083893', ogrn: null, payload: { name: 'СЗ ДОНСТРОЙ' } }] }),
    });
    expect(result).toEqual({ status: 'searched', found: 1 });
    expect(s.journal).toMatchObject([{ method: 'suggest', outcome: 'ok', actor: 'oper' }]);
    expect(calls).toEqual(['DELETE FROM company_name_suggestions', 'INSERT INTO company_name_suggestions', 'INSERT INTO company_name_searches']);
  });

  it('без ключа и сверх лимита — запроса нет; общее название — не ищется', async () => {
    const { db, calls } = fakeDb();
    let asked = 0;
    const call = async () => { asked += 1; return { ok: true as const, httpStatus: 200, items: [] }; };
    expect(await searchCompanyName(db, company, null, { ...store(), key: null, dailyLimit: 100, call })).toMatchObject({ status: 'stopped', reason: 'no_key' });
    expect(await searchCompanyName(db, company, null, { ...store(100), key: KEY, dailyLimit: 100, call })).toMatchObject({ status: 'stopped', reason: 'limit' });
    expect(await searchCompanyName(db, { id: 8, name: 'СЗ' }, null, { ...store(), key: KEY, dailyLimit: 100, call })).toEqual({ status: 'generic' });
    expect(asked).toBe(0);
    expect(calls).toEqual(['INSERT INTO company_name_searches']);
  });

  it('ключ не принят — остановка; сбой сети — повтор позже, прежние подсказки остаются', async () => {
    const { db, calls } = fakeDb();
    const s = store();
    expect(await searchCompanyName(db, company, null, { ...s, key: KEY, dailyLimit: 100, call: answer({ ok: false, failure: 'forbidden', httpStatus: 403, error: 'нет' }) }))
      .toMatchObject({ status: 'stopped', reason: 'key_rejected' });
    expect(await searchCompanyName(db, company, null, { ...s, key: KEY, dailyLimit: 100, call: answer({ ok: false, failure: 'network', httpStatus: null, error: 'таймаут' }) }))
      .toEqual({ status: 'failed', error: 'таймаут' });
    expect(s.journal.map(j => j.outcome)).toEqual(['key_rejected', 'network']);
    expect(calls).toEqual(['INSERT INTO company_name_searches']);
  });
});
