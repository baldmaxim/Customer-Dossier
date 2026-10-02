// Клиент API Контур.Фокуса без сети: транспорт safeFetch подменён, проверки адреса и размера остаются.

import { describe, expect, it } from 'vitest';

import type { SafeTransport } from '../net/safeFetch.js';
import { callFocus, checkFocusKey, parseFocusItems } from './client.js';

const KEY = 'demo-focus-key-0001';

const respond =
  (status: number, body: string, headers: Record<string, string> = {}): SafeTransport =>
  async () => ({ status, headers, body: Buffer.from(body) });

describe('callFocus', () => {
  it('адрес: focus-api.kontur.ru/api3/<метод>, ключ и реквизит параметрами', async () => {
    const seen: URL[] = [];
    const transport: SafeTransport = async url => {
      seen.push(url);
      return { status: 200, headers: {}, body: Buffer.from('[{"inn":"7701000001","ogrn":"1027700000001","UL":{}}]') };
    };
    const res = await callFocus('egrDetails', { type: 'inn', value: '7701000001' }, KEY, { transport });
    expect(res).toEqual({ ok: true, httpStatus: 200, items: [{ inn: '7701000001', ogrn: '1027700000001', payload: { inn: '7701000001', ogrn: '1027700000001', UL: {} } }] });
    expect(seen[0]!.origin + seen[0]!.pathname).toBe('https://focus-api.kontur.ru/api3/egrDetails');
    expect(seen[0]!.searchParams.get('key')).toBe(KEY);
    expect(seen[0]!.searchParams.get('inn')).toBe('7701000001');
    await callFocus('req', { type: 'ogrn', value: '1027700000001' }, KEY, { transport });
    expect(seen[1]!.searchParams.get('ogrn')).toBe('1027700000001');
    expect(seen[1]!.searchParams.has('inn')).toBe(false);
  });

  it('пустой список — Фокус компанию не знает; не список — bad_response', async () => {
    expect(await callFocus('req', { type: 'inn', value: '7701000001' }, KEY, { transport: respond(200, '[]') })).toEqual({ ok: true, httpStatus: 200, items: [] });
    expect(await callFocus('req', { type: 'inn', value: '7701000001' }, KEY, { transport: respond(200, '{"error":1}') })).toMatchObject({
      ok: false,
      failure: 'bad_response',
    });
    expect(await callFocus('req', { type: 'inn', value: '7701000001' }, KEY, { transport: respond(200, '<html>') })).toMatchObject({
      ok: false,
      failure: 'bad_response',
    });
  });

  it('коды ответа → вид отказа; ключ в тексте ошибки замазан', async () => {
    const id = { type: 'inn' as const, value: '7701000001' };
    expect(await callFocus('req', id, KEY, { transport: respond(403, `Key ${KEY} not found`) })).toEqual({
      ok: false,
      failure: 'forbidden',
      httpStatus: 403,
      error: 'Key *** not found',
    });
    expect(await callFocus('req', id, KEY, { transport: respond(401, '') })).toMatchObject({ failure: 'forbidden', error: 'HTTP 401' });
    expect(await callFocus('req', id, KEY, { transport: respond(402, 'limit') })).toMatchObject({ failure: 'quota_exhausted' });
    expect(await callFocus('req', id, KEY, { transport: respond(429, 'slow down') })).toMatchObject({ failure: 'rate_limited' });
    expect(await callFocus('req', id, KEY, { transport: respond(500, 'oops') })).toMatchObject({ failure: 'http_error', httpStatus: 500 });
  });

  it('перенаправление не выполняется: ключ стоит в адресе и не должен уехать', async () => {
    const res = await callFocus('req', { type: 'inn', value: '7701000001' }, KEY, {
      transport: respond(302, '', { location: 'https://focus-api.kontur.ru/elsewhere' }),
    });
    expect(res).toMatchObject({ ok: false, failure: 'network', httpStatus: null });
    expect(JSON.stringify(res)).not.toContain(KEY);
  });

  it('элемент без реквизитов в ответе — допустим, реквизит не выдумывается', () => {
    expect(parseFocusItems('[{"UL":{}}]')).toEqual([{ inn: null, ogrn: null, payload: { UL: {} } }]);
    expect(parseFocusItems('[1]')).toBeNull();
  });
});

describe('checkFocusKey', () => {
  it('2xx — принят, 400/401/403 — не принят, остальное — неизвестно (ключ сохраняется)', async () => {
    let path = '';
    const ok: SafeTransport = async url => {
      path = url.pathname;
      return { status: 200, headers: {}, body: Buffer.from('[]') };
    };
    expect(await checkFocusKey(KEY, { transport: ok })).toMatchObject({ verdict: 'accepted', failure: null });
    expect(path).toBe('/api3/stat');
    expect(await checkFocusKey(KEY, { transport: respond(403, 'denied') })).toMatchObject({ verdict: 'rejected', failure: 'forbidden' });
    // Так stat отвечает на неверный ключ на самом деле (проверено с сервера 02.10.2026).
    expect(await checkFocusKey(KEY, { transport: respond(400, "Param 'key' not specified or invalid") })).toMatchObject({
      verdict: 'rejected',
      failure: 'forbidden',
    });
    expect(await checkFocusKey(KEY, { transport: respond(503, 'busy') })).toMatchObject({ verdict: 'unknown', failure: 'http_error' });
  });
});
