// Клиент parser-api.com без сети (этап 24A): транспорт safeFetch подменён, проверки адреса и размера остаются.
// Формы ответов — по документации сервиса (живой ответ не сверен: `npm run parserapi -- --probe`).

import { describe, expect, it } from 'vitest';

import type { SafeTransport } from '../net/safeFetch.js';
import { availablePaths, callParserApi, checkParserApiKey, interpretResponse } from './client.js';

const KEY = 'demo-parser-key-0001';

const respond =
  (status: number, body: string): SafeTransport =>
  async () => ({ status, headers: {}, body: Buffer.from(body) });

describe('callParserApi (T24A-01)', () => {
  it('адрес: parser-api.com/parser/<api>/<метод>, ключ и параметры строкой запроса', async () => {
    const seen: URL[] = [];
    const transport: SafeTransport = async url => {
      seen.push(url);
      return { status: 200, headers: {}, body: Buffer.from('{"success":1,"items":[]}') };
    };
    expect(await callParserApi('bo_search', { inn: '7736255508' }, KEY, { transport })).toEqual({ ok: true, httpStatus: 200, body: { success: 1, items: [] } });
    expect(seen[0]!.origin + seen[0]!.pathname).toBe('https://parser-api.com/parser/nalog_bo_api/search');
    expect(seen[0]!.searchParams.get('key')).toBe(KEY);
    expect(seen[0]!.searchParams.get('inn')).toBe('7736255508');
  });

  it('признак успеха называется по-разному: success, Success (КАД), done (ФССП)', () => {
    expect(interpretResponse(200, '{"Success":1,"Cases":[],"PagesCount":0}', KEY)).toMatchObject({ ok: true });
    expect(interpretResponse(200, '{"done":1,"result":[]}', KEY)).toMatchObject({ ok: true });
    expect(interpretResponse(200, '{"items":[]}', KEY)).toMatchObject({ ok: false, failure: 'bad_response' });
    expect(interpretResponse(200, '<html>', KEY)).toMatchObject({ ok: false, failure: 'bad_response' });
  });

  it('коды отказа сервиса → вид отказа; ключ в тексте ошибки замазан', () => {
    const cases: Array<[number, number, string]> = [
      [403, 40301, 'key_rejected'],
      [403, 40302, 'subscription_expired'],
      [403, 40303, 'ip_rejected'],
      [403, 40304, 'daily_limit'],
      [403, 40305, 'monthly_limit'],
      [400, 40001, 'bad_request'],
    ];
    for (const [status, code, failure] of cases) {
      expect(interpretResponse(status, JSON.stringify({ error: 'отказ', error_code: code }), KEY), String(code)).toMatchObject({ ok: false, failure, apiCode: code });
    }
    expect(interpretResponse(403, `bad key ${KEY}`, KEY)).toEqual({ ok: false, failure: 'key_rejected', httpStatus: 403, apiCode: null, error: 'bad key ***' });
    expect(interpretResponse(500, 'oops', KEY)).toMatchObject({ ok: false, failure: 'http_error' });
    // Отказ кодом при HTTP 200 — тоже отказ, а не успех.
    expect(interpretResponse(200, '{"success":0,"error":"лимит","error_code":40304}', KEY)).toMatchObject({ ok: false, failure: 'daily_limit' });
  });

  it('сеть недоступна — network, ключа в тексте нет', async () => {
    const transport: SafeTransport = async () => {
      throw new Error(`connect failed ${KEY}`);
    };
    const res = await callParserApi('pb_org', { inn: '7736255508' }, KEY, { transport });
    expect(res).toMatchObject({ ok: false, failure: 'network' });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it('проверка ключа: 40301/40302/40303 — не годится; проверка параметров — неизвестно, «принят» не говорим', async () => {
    expect((await checkParserApiKey(KEY, { transport: respond(403, '{"error":"Invalid access key","error_code":40301}') })).verdict).toBe('rejected');
    expect((await checkParserApiKey(KEY, { transport: respond(403, '{"error":"ip","error_code":40303}') })).failure).toBe('ip_rejected');
    expect((await checkParserApiKey(KEY, { transport: respond(400, '{"error":"inn","error_code":40001}') })).verdict).toBe('unknown');
  });
});

describe('availablePaths (T24A-02)', () => {
  it('пути без значений, массив — по первому элементу', () => {
    expect(availablePaths({ success: 1, items: [{ id: 5, inn: '1' }], page: { n: 1 } })).toEqual(['items', 'items[]', 'items[].id', 'items[].inn', 'page', 'page.n', 'success']);
  });
});
