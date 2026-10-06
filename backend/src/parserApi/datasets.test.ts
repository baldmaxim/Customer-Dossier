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

  it('Федресурс: должник не найден — один запрос, «записей нет»', async () => {
    const { step, calls } = scripted([{ success: 1, total_count: '1', records: [{ id: 'X', inn: '7704412966' }] }]);
    expect(await runDataset('bankruptcy', INN, step, options)).toMatchObject({ outcome: 'not_found', complete: true });
    expect(calls).toHaveLength(1);
  });
});

describe('Федресурс: сообщения должника и судебные акты (bankruptcy-map@2)', () => {
  const found = { success: 1, total_count: '1', records: [{ id: 'D1', inn: INN }] };
  const msg = (id: string, date: string, type: string) => ({ id, date: `${date} 10:00:00`, type });
  const act = (id: string, act: string) => ({ success: 1, record: { id, act, is_actual: 1, date_published: '01.01.2026' } });

  it('поиск → список сообщений → карточки только неаннулированных судебных актов, новые первыми; get_org не спрашивается', async () => {
    const { step, calls } = scripted([
      found,
      {
        success: 1,
        total_count: '4',
        records: [
          msg('M1', '01.02.2026', 'Сообщение о собрании кредиторов'),
          msg('M2', '01.01.2026', 'Сообщение о судебном акте'),
          msg('M3', '01.03.2026', 'Сообщение о судебном акте'),
          msg('M4', '01.04.2026', 'Сообщение о судебном акте (аннулировано)'),
        ],
      },
      act('M3', 'о признании должника банкротом и открытии конкурсного производства'),
      act('M2', 'о введении наблюдения'),
    ]);
    expect(await runDataset('bankruptcy', INN, step, options)).toMatchObject({ outcome: 'found', complete: true });
    expect(calls.map(c => [c.method, c.params])).toEqual([
      ['fedresurs_ur', { orgCode: INN }],
      ['fedresurs_messages', { id: 'D1' }],
      ['fedresurs_message', { id: 'M3' }],
      ['fedresurs_message', { id: 'M2' }],
    ]);
  });

  it('список длиннее страницы — следующая с from_record = сколько получено', async () => {
    const { step, calls } = scripted([
      found,
      { success: 1, total_count: '3', records: [msg('M1', '01.02.2026', 'Иное сообщение'), msg('M2', '01.01.2026', 'Иное сообщение')] },
      { success: 1, total_count: '3', records: [msg('M3', '01.12.2025', 'Иное сообщение')] },
    ]);
    expect(await runDataset('bankruptcy', INN, step, options)).toMatchObject({ outcome: 'found', complete: true });
    expect(calls.slice(1).map(c => c.params)).toEqual([{ id: 'D1' }, { id: 'D1', from_record: '2' }]);
  });

  it('карточка, полученная прошлым снимком, переносится без запроса; сверх предела — «часть» с причиной', async () => {
    const records = Array.from({ length: 7 }, (_, i) => msg(`A${i}`, `0${i + 1}.01.2026`, 'Сообщение о судебном акте'));
    const previous = {
      format: 'parser-api-dataset@1' as const,
      dataset: 'bankruptcy' as const,
      inn: INN,
      window: null,
      missing: [],
      responses: [{ method: 'fedresurs_message' as const, params: { id: 'A6' }, body: act('A6', 'о введении наблюдения') }],
    };
    const replies: Array<Record<string, unknown>> = [found, { success: 1, total_count: '7', records }];
    for (let i = 5; i >= 1; i -= 1) replies.push(act(`A${i}`, 'о продлении срока процедуры'));
    const { step, calls } = scripted(replies);
    const res = await runDataset('bankruptcy', INN, step, { ...options, previous });
    expect(res).toMatchObject({ outcome: 'partial', complete: false });
    // A6 — из прошлого снимка, A5…A1 — запросы (предел 5), A0 — следующим проходом.
    expect(calls.filter(c => c.method === 'fedresurs_message').map(c => c.params.id)).toEqual(['A5', 'A4', 'A3', 'A2', 'A1']);
    expect(res.status === 'done' && res.payload.responses.filter(r => r.method === 'fedresurs_message').map(r => r.params.id)).toEqual(['A6', 'A5', 'A4', 'A3', 'A2', 'A1']);
    expect(res.status === 'done' && res.payload.missing).toEqual(['судебные акты: ещё 1 — следующим проходом (не больше 5 за проход)']);
  });

  it('список не пришёл — снимок поиска с причиной; лимит останавливает проход', async () => {
    const { step } = scripted([found, { fail: 'daily_limit', stop: true }]);
    const res = await runDataset('bankruptcy', INN, step, options);
    expect(res).toMatchObject({ outcome: 'partial', complete: false, stop: 'daily_limit' });
    expect(res.status === 'done' && res.payload.missing[0]).toMatch(/^сообщения должника: daily_limit/);
  });

  it('карточка акта не пришла без остановки — остальные спрашиваются, набор неполный', async () => {
    const { step, calls } = scripted([
      found,
      { success: 1, total_count: '2', records: [msg('M2', '02.01.2026', 'Сообщение о судебном акте'), msg('M1', '01.01.2026', 'Сообщение о судебном акте')] },
      { fail: 'network' },
      act('M1', 'о введении наблюдения'),
    ]);
    const res = await runDataset('bankruptcy', INN, step, options);
    expect(res).toMatchObject({ outcome: 'partial', complete: false, stop: null });
    expect(calls).toHaveLength(4);
  });
});
