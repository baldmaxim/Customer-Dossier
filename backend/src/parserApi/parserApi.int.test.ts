// parser-api.com на настоящей базе (миграция 044, этап 24A): резерв лимита до запроса, снимок только при
// изменении, сроки проверки и повтор после сбоя, очередь — только компании «на контроле», ключ рядом с
// ключами OpenRouter и Фокуса. Сети нет: вызов API подменён.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { clearParserApiKey, loadStoredParserApiKey, parserApiKey, saveParserApiKey } from '../settings/parserApiKey.js';
import type { callParserApi, ParserApiCallResult } from './client.js';
import { loadParserApiStates, parserApiConnection, parserApiCoverage } from './read.js';
import { refreshParserApiDatasets } from './refresh.js';
import { pgParserApiStore } from './store.js';
import { companyInn, dueParserApiTargets } from './targets.js';

const INN = '7736255508';
const pool = getPool;

const company = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [name])).rows[0]!.id;

const inn = async (companyId: number, value: string): Promise<void> => {
  await pool().query(
    `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
     VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
    [companyId, value],
  );
};

const call = (body: Record<string, unknown>): typeof callParserApi => async () => ({ ok: true, httpStatus: 200, body }) as ParserApiCallResult;
const deps = (c: typeof callParserApi, daily = 20) => ({ store: pgParserApiStore, key: 'demo-parser-key-0001', limits: { daily, monthly: 200 }, kadMaxPages: 3, call: c });

let watched = 0;

beforeAll(async () => {
  await resetAndMigrate();
  watched = await company('СУ-10 Демо');
  await inn(watched, INN);
  await pool().query(`INSERT INTO company_watch (company_id, added_by) VALUES ($1, 'test')`, [watched]);
  const other = await company('Без контроля');
  await inn(other, '7704412966');
});

afterAll(async () => {
  await closeDb();
});

describe('parser-api.com на базе (T24A-07)', () => {
  it('очередь — только «на контроле», все пять наборов, отчётность первой', async () => {
    expect(await dueParserApiTargets(pool(), 10)).toEqual([{ companyId: watched, inn: INN, datasets: ['finance', 'tax', 'courts', 'fssp', 'bankruptcy'] }]);
    expect(await companyInn(pool(), watched)).toEqual({ ok: true, inn: INN });
    expect(await parserApiCoverage(pool())).toMatchObject({ watched: 1, checked: 0, due: 5 });
  });

  it('ответ записан, повтор того же ответа второй строки не создаёт; оплачен каждый успешный запрос', async () => {
    const answer = call({ success: 1, org: [{ inn: INN, avg_headcount: [] }] });
    expect(await refreshParserApiDatasets(INN, ['tax'], 'ivanov', deps(answer))).toMatchObject({ datasets: { tax: { status: 'checked', outcome: 'found', saved: true } } });
    expect(await refreshParserApiDatasets(INN, ['tax'], 'ivanov', deps(answer))).toMatchObject({ datasets: { tax: { saved: false } } });
    const rows = await pool().query('SELECT count(*)::int AS n FROM parser_api_records WHERE inn = $1', [INN]);
    expect(rows.rows[0].n).toBe(1);
    expect(await pgParserApiStore.usage()).toEqual({ day: 2, month: 2 });
    const states = await loadParserApiStates(pool(), INN);
    expect(states.find(s => s.dataset === 'tax')).toMatchObject({ outcome: 'found', attemptCount: 0, record: { complete: true, missing: [] } });
    expect(states.find(s => s.dataset === 'courts')).toMatchObject({ outcome: null, record: null });
  });

  it('резерв: лимит портала исчерпан — запроса нет, строки журнала нет', async () => {
    const before = (await pool().query('SELECT count(*)::int AS n FROM parser_api_requests')).rows[0].n;
    const res = await refreshParserApiDatasets(INN, ['fssp'], 'scheduler', deps(call({ done: 1, result: [] }), 2));
    expect(res).toMatchObject({ status: 'stopped', reason: 'daily_limit' });
    expect((await pool().query('SELECT count(*)::int AS n FROM parser_api_requests')).rows[0].n).toBe(before);
  });

  it('сбой — повтор через час, ошибка видна; отказ не оплачивается', async () => {
    const network: typeof callParserApi = async () => ({ ok: false, failure: 'network', httpStatus: null, apiCode: null, error: 'timeout' });
    await refreshParserApiDatasets(INN, ['fssp'], 'scheduler', deps(network));
    const state = (await loadParserApiStates(pool(), INN)).find(s => s.dataset === 'fssp');
    expect(state).toMatchObject({ outcome: null, attemptCount: 1, lastError: 'fssp_ur: network — timeout' });
    const journal = (await pool().query(`SELECT outcome, billable FROM parser_api_requests ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(journal).toEqual({ outcome: 'network', billable: false });
  });

  it('подключение по журналу: успех — подключён; ключ сменили позже — ждёт первого ответа; без ключа — не подключён', async () => {
    expect(await parserApiConnection(pool(), true, null)).toMatchObject({ state: 'connected' });
    expect(await parserApiConnection(pool(), true, new Date(Date.now() + 60_000).toISOString())).toEqual({ state: 'unverified', at: null });
    expect(await parserApiConnection(pool(), false, null)).toEqual({ state: 'none', at: null });
  });

  it('ключ из админки: шифротекст рядом с ключами OpenRouter и Фокуса, наружу — четыре символа', async () => {
    const saved = await saveParserApiKey('demo-parser-key-9876', 'admin');
    expect(saved).toMatchObject({ ok: true, status: { source: 'admin', hint: '9876' } });
    await loadStoredParserApiKey();
    expect(parserApiKey()).toBe('demo-parser-key-9876');
    const stored = (await pool().query(`SELECT ciphertext FROM app_secrets WHERE name = 'parser_api_key'`)).rows[0];
    expect(stored.ciphertext).not.toContain('demo-parser-key-9876');
    await clearParserApiKey('admin');
    expect(parserApiKey()).toBeNull();
  });
});
