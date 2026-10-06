// parser-api.com на настоящей базе (миграция 044, этап 24A): резерв лимита до запроса, снимок только при
// изменении, сроки проверки и повтор после сбоя, очередь — только компании «на контроле», ключ рядом с
// ключами OpenRouter и Фокуса. Сети нет: вызов API подменён.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { clearParserApiKey, loadStoredParserApiKey, parserApiKey, saveParserApiKey } from '../settings/parserApiKey.js';
import { fetchCaseCards } from './caseCards.js';
import type { callParserApi, ParserApiCallResult } from './client.js';
import { loadCompanyChecks } from './checks.js';
import { loadCompanyFinance } from './finance.js';
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
    expect(await pgParserApiStore.usage()).toMatchObject({ nalog_pb: { day: 2, month: 2 }, fssp: { day: 0, month: 0 } });
    const states = await loadParserApiStates(pool(), INN);
    expect(states.find(s => s.dataset === 'tax')).toMatchObject({ outcome: 'found', attemptCount: 0, record: { complete: true, missing: [] } });
    expect(states.find(s => s.dataset === 'courts')).toMatchObject({ outcome: null, record: null });
  });

  it('резерв: лимит портала исчерпан у сервиса — запроса нет, строки журнала нет; у другого сервиса место своё', async () => {
    const before = (await pool().query('SELECT count(*)::int AS n FROM parser_api_requests')).rows[0].n;
    const res = await refreshParserApiDatasets(INN, ['tax'], 'scheduler', deps(call({ success: 1, org: [] }), 2));
    expect(res).toMatchObject({ status: 'done', blocked: { nalog_pb: 'daily_limit' }, datasets: { tax: { status: 'failed' } } });
    expect((await pool().query('SELECT count(*)::int AS n FROM parser_api_requests')).rows[0].n).toBe(before);
    const other = await pgParserApiStore.reserve({ method: 'fssp_ur', inn: INN, page: null, actor: 'test' }, { daily: 2, monthly: 200 });
    expect(other.ok).toBe(true);
    if (other.ok) await pgParserApiStore.finish(other.id, { outcome: 'network', httpStatus: null, apiCode: null, error: 'тест' });
  });

  it('сбой — повтор через час, ошибка видна; отказ не оплачивается', async () => {
    const network: typeof callParserApi = async () => ({ ok: false, failure: 'network', httpStatus: null, apiCode: null, error: 'timeout' });
    await refreshParserApiDatasets(INN, ['fssp'], 'scheduler', deps(network));
    const state = (await loadParserApiStates(pool(), INN)).find(s => s.dataset === 'fssp');
    expect(state).toMatchObject({ outcome: null, attemptCount: 1, lastError: 'fssp_ur: network — timeout' });
    const journal = (await pool().query(`SELECT outcome, billable FROM parser_api_requests ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(journal).toEqual({ outcome: 'network', billable: false });
  });

  it('финансы компании (24B): карта снимка tax, finance не проверялось — без вида; без ИНН — причина словами', async () => {
    const finance = await loadCompanyFinance(pool(), watched);
    expect(finance).toMatchObject({ inn: INN, problem: null, finance: { state: { outcome: null }, view: null }, tax: { state: { outcome: 'found' }, view: { recognized: true, headcount: [] } } });
    const bare = await company('Без ИНН');
    expect(await loadCompanyFinance(pool(), bare)).toMatchObject({ inn: null, problem: 'no_inn', finance: null, tax: null });
  });

  it('суды, ФССП, банкротство (24C): не проверялось — состояние без вида; ФССП после сбоя — неудача видна', async () => {
    const checks = await loadCompanyChecks(pool(), watched);
    expect(checks).toMatchObject({
      inn: INN,
      courts: { state: { outcome: null, attemptCount: 0 }, view: null },
      fssp: { state: { outcome: null, attemptCount: 1 }, view: null },
      bankruptcy: { state: { outcome: null }, view: null },
    });
  });

  it('суммы исков (048): карточка — только нужным делам и один раз; сумма видна в картотеке компании', async () => {
    const GUID_A = '11111111-2222-3333-4444-555555555555';
    const GUID_B = '21111111-2222-3333-4444-555555555555';
    const page = {
      Success: 1,
      PagesCount: 1,
      Cases: [
        { CaseId: GUID_A, CaseNumber: 'А40-1/2026', CaseType: 'Г', StartDate: '2026-09-01', Plaintiffs: [{ Name: 'Истец' }], Respondents: [{ Name: 'Демо', Inn: INN }] },
        { CaseId: GUID_B, CaseNumber: 'А40-2/2026', CaseType: 'Г', StartDate: '2026-08-01', Plaintiffs: [{ Name: 'Демо', Inn: INN }], Respondents: [{ Name: 'Должник' }] },
      ],
    };
    await refreshParserApiDatasets(INN, ['courts'], 'ivanov', deps(call(page)));
    const cardBody = { Success: 1, Cases: [{ CaseId: GUID_A, CaseInstances: [{ Name: 'Первая инстанция', InstanceEvents: [{ Date: '2026-09-01', ClaimSum: 1250000 }] }] }] };
    const res = await fetchCaseCards(INN, 'ivanov', 10, deps(call(cardBody)));
    expect(res).toEqual({ fetched: 1, pending: 0, failed: 0, stop: null });
    // Повтор ничего не спрашивает: карточка уже есть.
    expect(await fetchCaseCards(INN, 'ivanov', 10, deps(call(cardBody)))).toEqual({ fetched: 0, pending: 0, failed: 0, stop: null });
    expect(await pgParserApiStore.saveCaseCard(GUID_A, cardBody, 'ivanov')).toBe(false);
    const journal = (await pool().query(`SELECT method, billable FROM parser_api_requests WHERE method = 'kad_details'`)).rows;
    expect(journal).toEqual([{ method: 'kad_details', billable: true }]);
    const checks = await loadCompanyChecks(pool(), watched);
    expect(checks.claimsFetching).toBe(false);
    expect(checks.courts?.view?.claims).toEqual({ wanted: 1, fetched: 1, withAmount: 1 });
    expect(checks.courts?.view?.cases.map(c => c.claim?.amount ?? null)).toEqual([1250000, null]);
  });

  it('ЕФРСБ (049): сообщения и акт в журнале; повтор переносит карточку акта без запроса и нового снимка не пишет', async () => {
    const replies: Record<string, Record<string, unknown>> = {
      fedresurs_ur: { success: 1, total_count: '1', records: [{ id: 'D1', inn: INN, debtor: 'ООО «ДЕМО»' }] },
      fedresurs_messages: { success: 1, total_count: '2', records: [{ id: 'M2', date: '01.02.2026 10:00:00', type: 'Сообщение о судебном акте' }, { id: 'M1', date: '01.01.2026 10:00:00', type: 'Сообщение о собрании кредиторов' }] },
      fedresurs_message: { success: 1, record: { id: 'M2', act: 'о введении наблюдения', date_published: '01.02.2026', case_num: 'А40-1/2026', is_actual: 1 } },
    };
    const byMethod: typeof callParserApi = async method => ({ ok: true, httpStatus: 200, body: replies[method]! }) as ParserApiCallResult;
    const first = await refreshParserApiDatasets(INN, ['bankruptcy'], 'ivanov', deps(byMethod));
    expect(first).toEqual({ status: 'done', datasets: { bankruptcy: { status: 'checked', outcome: 'found', saved: true } }, blocked: {} });
    const second = await refreshParserApiDatasets(INN, ['bankruptcy'], 'ivanov', deps(byMethod));
    expect(second).toEqual({ status: 'done', datasets: { bankruptcy: { status: 'checked', outcome: 'found', saved: false } }, blocked: {} });
    const journal = (await pool().query<{ method: string; n: number }>(
      `SELECT method, count(*)::int AS n FROM parser_api_requests WHERE method LIKE 'fedresurs%' GROUP BY method ORDER BY method`,
    )).rows;
    expect(journal).toEqual([
      { method: 'fedresurs_message', n: 1 },
      { method: 'fedresurs_messages', n: 2 },
      { method: 'fedresurs_ur', n: 2 },
    ]);
    const checks = await loadCompanyChecks(pool(), watched);
    expect(checks.bankruptcy?.view).toMatchObject({ found: true, procedureAct: { act: 'о введении наблюдения', caseNumber: 'А40-1/2026' } });
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
