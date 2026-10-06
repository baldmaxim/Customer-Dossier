// Поиск сайта компании без сети и базы (этап 25A): место в лимите — до каждой попытки, повтор — только при
// ответе не по схеме, без страниц выдачи предложениям модели не верим, проба кандидатов не пишет.

import { describe, expect, it, vi } from 'vitest';

import type { ILlmResult } from '../llm/client.js';
import type { ISiteSearch } from '../llm/siteSearch/schema.js';
import { runSiteCheckPass, searchCompanySite, type ISiteSearchDeps } from './search.js';
import type { ISiteSearchTarget } from './store.js';

const TARGET: ISiteSearchTarget = {
  companyId: 42,
  name: 'Донстрой',
  legalForm: null,
  taxId: null,
  city: 'Москва',
  projects: ['ЖК Остров'],
  isGroup: true,
  attemptCount: 1,
};

const usage = { tokensIn: 1, tokensOut: 1, latencyMs: 1 };

const answer = (sites: ISiteSearch['sites'], citations: string[]): ILlmResult<ISiteSearch> => ({
  ok: true,
  data: { sites, noneReason: sites.length === 0 ? 'сайта в выдаче нет' : null },
  usage,
  rawResponse: '{}',
  citations: citations.map(url => ({ url, title: null, content: null })),
});

const deps = (results: Array<ILlmResult<ISiteSearch>>, limitLeft = 10) => {
  let left = limitLeft;
  const d = {
    extract: vi.fn(async () => results.shift()!),
    reserve: vi.fn(async () => (left-- > 0 ? ({ ok: true, id: 100 + left } as const) : ({ ok: false, used: limitLeft } as const))),
    finish: vi.fn(async () => undefined),
    save: vi.fn(async (_id: number, save: { outcome: 'found' | 'none' | 'no_citations' }) => ({ inserted: 1, outcome: save.outcome })),
    fail: vi.fn(async () => undefined),
    postpone: vi.fn(async () => undefined),
  };
  return d as typeof d & ISiteSearchDeps;
};

describe('поиск сайта компании', () => {
  it('найдено: адрес из выдачи принят, кандидаты записаны, попытка закрыта в журнале', async () => {
    const d = deps([answer([{ url: 'https://donstroy.moscow', reason: 'ИНН на странице' }], ['https://donstroy.moscow/kontakty'])]);
    const run = await searchCompanySite(TARGET, 'scheduler', { persist: true }, d);
    expect(run).toMatchObject({ outcome: 'found', inserted: 1, citations: 1 });
    expect(run.query).toContain('группы компаний «Донстрой»');
    expect(d.reserve).toHaveBeenCalledTimes(1);
    expect(d.finish).toHaveBeenCalledWith(expect.any(Number), { outcome: 'found', citations: 1, accepted: 1, error: null });
    expect(d.save).toHaveBeenCalledWith(42, expect.objectContaining({ outcome: 'found', accepted: [expect.objectContaining({ host: 'donstroy.moscow' })] }));
  });

  it('выдача пуста — no_citations, предложения модели отброшены', async () => {
    const d = deps([answer([{ url: 'https://donstroy.moscow', reason: 'знаю' }], [])]);
    const run = await searchCompanySite(TARGET, 'scheduler', { persist: true }, d);
    expect(run.outcome).toBe('no_citations');
    expect(d.save).toHaveBeenCalledWith(42, expect.objectContaining({ outcome: 'no_citations', accepted: [] }));
  });

  it('ответ не по схеме — один повтор, и он тоже занимает место в лимите', async () => {
    const bad: ILlmResult<ISiteSearch> = { ok: false, failure: 'schema_error', message: 'sites: Required', usage, rawResponse: '{}' };
    const d = deps([bad, answer([], ['https://x.ru/'])]);
    const run = await searchCompanySite(TARGET, 'scheduler', { persist: true }, d);
    expect(run.outcome).toBe('none');
    expect(d.reserve).toHaveBeenCalledTimes(2);
    expect(d.extract).toHaveBeenNthCalledWith(2, expect.objectContaining({ temperature: 0 }));
    expect(d.finish).toHaveBeenNthCalledWith(1, expect.any(Number), expect.objectContaining({ outcome: 'invalid_answer' }));
  });

  it('сбой модели — без повтора (каждая попытка платная), компания уходит на паузу', async () => {
    const d = deps([{ ok: false, failure: 'llm_error', message: 'HTTP 502', usage, rawResponse: null }]);
    const run = await searchCompanySite(TARGET, 'scheduler', { persist: true }, d);
    expect(run).toMatchObject({ outcome: 'llm_error', error: 'HTTP 502' });
    expect(d.extract).toHaveBeenCalledTimes(1);
    expect(d.fail).toHaveBeenCalledWith(42, 'HTTP 502', 1);
    expect(d.save).not.toHaveBeenCalled();
  });

  it('лимит исчерпан — запроса нет, компания возвращается в очередь позже', async () => {
    const d = deps([], 0);
    const run = await searchCompanySite(TARGET, 'scheduler', { persist: true }, d);
    expect(run.outcome).toBe('daily_limit');
    expect(d.extract).not.toHaveBeenCalled();
    expect(d.postpone).toHaveBeenCalledWith(42);
  });

  it('проба: журнал пишется, кандидаты и очередь — нет', async () => {
    const d = deps([answer([{ url: 'https://donstroy.moscow', reason: 'r' }], ['https://donstroy.moscow/'])]);
    const run = await searchCompanySite(TARGET, 'probe', { persist: false }, d);
    expect(run).toMatchObject({ outcome: 'found', inserted: 0 });
    expect(d.finish).toHaveBeenCalledTimes(1);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.reserve).toHaveBeenCalledWith(expect.objectContaining({ actor: 'probe', companyId: 42 }), expect.any(Number));
  });
});

describe('проход проверки кандидатов', () => {
  it('неожиданная ошибка — исход «недоступен» с текстом, без вечного повтора', async () => {
    const save = vi.fn(async () => undefined);
    const runs = await runSiteCheckPass(3, {
      list: async () => [{ id: 7, url: 'https://a.ru/', host: 'a.ru', companyName: 'Альфа', inn: null, ogrn: null }],
      verify: async () => {
        throw new Error('сбой разбора');
      },
      save,
    });
    expect(runs[0]?.check).toMatchObject({ status: 'unreachable', error: 'сбой разбора' });
    expect(save).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'unreachable' }));
  });
});
