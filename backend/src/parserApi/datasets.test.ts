// Наборы parser-api.com без сети (этап 24A): поиск → детали, страницы картотеки, «нет записей» ≠ «часть».

import { describe, expect, it } from 'vitest';

import type { ParserApiMethod } from './client.js';
import { runDataset, windowFrom, type DatasetStep } from './datasets.js';

const INN = '7736255508';
const NOW = new Date('2026-10-06T12:00:00Z');
const options = { kadMaxPages: 3, now: NOW };

type Reply = Record<string, unknown> | { fail: string; stop?: boolean };
const isFail = (reply: Reply): reply is { fail: string; stop?: boolean } => typeof reply.fail === 'string';

/** Шаг по сценарию: ответы по порядку, запросы записываются. */
const scripted = (replies: Reply[]) => {
  const calls: Array<{ method: ParserApiMethod; params: Record<string, string> }> = [];
  const step: DatasetStep = async (method, params) => {
    calls.push({ method, params });
    const reply = replies.shift();
    if (!reply) throw new Error(`лишний запрос ${method}`);
    if (isFail(reply)) return { ok: false, failure: reply.fail as 'network', httpStatus: null, apiCode: null, error: 'отказ', stop: reply.stop };
    return { ok: true, httpStatus: 200, body: reply };
  };
  return { step, calls };
};

describe('ГИР БО: поиск → детали (T24A-03)', () => {
  it('найден по ИНН — детали по его id, набор полный', async () => {
    const { step, calls } = scripted([
      { success: 1, items: [{ id: 1, inn: '7700000000' }, { id: 6622458, inn: INN }] },
      { success: 1, organization: {}, reports: [] },
    ]);
    const res = await runDataset('finance', INN, step, options);
    expect(res).toMatchObject({ status: 'done', outcome: 'found', complete: true });
    expect(calls.map(c => [c.method, c.params])).toEqual([
      ['bo_search', { inn: INN }],
      ['bo_details', { id: '6622458' }],
    ]);
  });

  it('поиск вернул чужие ИНН — «записей нет», детали не спрашиваются', async () => {
    const { step, calls } = scripted([{ success: 1, items: [{ id: 1, inn: '7700000000' }] }]);
    expect(await runDataset('finance', INN, step, options)).toMatchObject({ status: 'done', outcome: 'not_found', complete: true });
    expect(calls).toHaveLength(1);
  });

  it('детали не пришли — снимок поиска с пометкой «часть», остановка передаётся наверх', async () => {
    const { step } = scripted([{ success: 1, items: [{ id: 9, inn: INN }] }, { fail: 'monthly_limit', stop: true }]);
    const res = await runDataset('finance', INN, step, options);
    expect(res).toMatchObject({ status: 'done', outcome: 'partial', complete: false, stop: 'monthly_limit' });
    expect(res.status === 'done' && res.payload.missing[0]).toMatch(/^отчётность: monthly_limit/);
  });

  it('первый же запрос не удался — снимка нет', async () => {
    const { step } = scripted([{ fail: 'network' }]);
    expect(await runDataset('finance', INN, step, options)).toMatchObject({ status: 'failed', stop: null });
  });
});

describe('картотека дел: окно и страницы (T24A-04)', () => {
  it('окно — с первого числа месяца 24 месяца назад: не дрожит каждый день', () => {
    expect(windowFrom(NOW, 24)).toBe('2024-10-01');
    expect(windowFrom(new Date('2026-10-31T23:00:00Z'), 24)).toBe('2024-10-01');
  });

  it('все страницы получены — полный набор', async () => {
    const { step, calls } = scripted([
      { Success: 1, PagesCount: 2, Cases: [{ CaseId: 'a' }] },
      { Success: 1, PagesCount: 2, Cases: [{ CaseId: 'b' }] },
    ]);
    expect(await runDataset('courts', INN, step, options)).toMatchObject({ status: 'done', outcome: 'found', complete: true });
    expect(calls.map(c => c.params.page)).toEqual(['1', '2']);
    expect(calls[0]!.params).toMatchObject({ Inn: INN, InnType: 'Any', DateFrom: '2024-10-01' });
  });

  it('дел нет — «записей нет», полный', async () => {
    const { step } = scripted([{ Success: 1, PagesCount: 0, Cases: [] }]);
    expect(await runDataset('courts', INN, step, options)).toMatchObject({ outcome: 'not_found', complete: true });
  });

  it('страниц больше предела — «часть», а не «дел столько»', async () => {
    const { step } = scripted([
      { Success: 1, PagesCount: 7, Cases: [{ CaseId: 'a' }] },
      { Success: 1, PagesCount: 7, Cases: [{ CaseId: 'b' }] },
      { Success: 1, PagesCount: 7, Cases: [{ CaseId: 'c' }] },
    ]);
    const res = await runDataset('courts', INN, step, options);
    expect(res).toMatchObject({ outcome: 'partial', complete: false });
    expect(res.status === 'done' && res.payload.missing).toEqual(['страницы 4–7: предел страниц PARSER_API_KAD_MAX_PAGES']);
  });
});

describe('ФССП и Федресурс (T24A-05)', () => {
  it('ФССП: больше одной страницы — «часть»; пусто — «записей нет»', async () => {
    expect(await runDataset('fssp', INN, scripted([{ done: 1, total_pages_count: 3, result: [{}] }]).step, options)).toMatchObject({ outcome: 'partial', complete: false });
    expect(await runDataset('fssp', INN, scripted([{ done: 1, total_pages_count: 0, result: [] }]).step, options)).toMatchObject({ outcome: 'not_found', complete: true });
  });

  it('Федресурс: должник найден по ИНН — карточка по id', async () => {
    const { step, calls } = scripted([
      { success: 1, total_count: '1', records: [{ id: '69F4C34B', inn: INN }] },
      { success: 1, record: { inn: INN } },
    ]);
    expect(await runDataset('bankruptcy', INN, step, options)).toMatchObject({ outcome: 'found', complete: true });
    expect(calls.map(c => [c.method, c.params])).toEqual([
      ['fedresurs_ur', { orgCode: INN }],
      ['fedresurs_org', { id: '69F4C34B' }],
    ]);
  });
});
