// Проекты со страниц сайта компании без базы и модели (этап 25B): цитата дословно на странице и с названием,
// город/адрес/срок — только написанные; проход — допуск до и после ответа, сбой связи — стоп без строки,
// ответ не по схеме — строкой, чтобы не разбирать по кругу.

import { describe, expect, it, vi } from 'vitest';

import type { ILlmResult } from '../llm/client.js';
import type { ISiteProject, ISiteProjects } from '../llm/siteProjects/schema.js';
import { runSiteProjectsPass, verifySiteProjects, type ISiteProjectsDeps } from './projects.js';
import { classifyProjects, type ISiteProjectSighting } from './readModel.js';

const TEXT =
  'Наши проекты. ЖК «Остров» — в продаже, сдача IV квартал 2027, Москва, Мнёвники. Квартал «Символ» сдан в 2024 году. Партнёры: ЖК «Чужой» другой компании.';

const p = (over: Partial<ISiteProject> = {}): ISiteProject => ({
  name: 'ЖК «Остров»',
  city: 'Москва',
  address: 'Мнёвники',
  status: 'selling',
  completion: 'IV квартал 2027',
  quote: 'ЖК «Остров» — в продаже, сдача IV квартал 2027',
  ...over,
});

describe('проверка проектов со страницы', () => {
  it('цитата дословно и с названием; «ЖК» в названии не мешает; дубли по ключу — один раз', () => {
    const { accepted, rejected } = verifySiteProjects(
      [
        p(),
        p({ name: 'Остров', quote: 'ЖК «Остров» — в продаже' }),
        p({ name: 'Квартал Символ', quote: 'Квартал «Символ» сдан в 2024 году', status: 'completed', completion: null, city: null, address: null }),
        p({ name: 'ЖК Берег', quote: 'ЖК «Берег» — скоро старт продаж' }),
        p({ name: 'ЖК Альфа', quote: 'Наши проекты. ЖК «Остров» — в продаже' }),
      ],
      TEXT,
    );
    expect(accepted.map(a => a.name)).toEqual(['ЖК «Остров»', 'Квартал Символ']);
    expect(rejected).toBe(2);
  });

  it('город, адрес и срок, которых на странице нет, — null', () => {
    const [only] = verifySiteProjects([p({ city: 'Казань', address: 'улица Ленина 5', completion: 'II квартал 2030' })], TEXT).accepted;
    expect(only).toMatchObject({ city: null, address: null, completion: null, status: 'selling' });
  });
});

const usage = { tokensIn: 1, tokensOut: 1, latencyMs: 1 };
const PAGE = { id: 5, sourceId: 9, url: 'https://demo.ru/projects', title: 'Проекты', text: TEXT };

const deps = (results: Array<ILlmResult<ISiteProjects> | Error>, allowed: boolean[] = [true, true, true, true]) => {
  const d = {
    list: vi.fn(async () => [PAGE, { ...PAGE, id: 6 }]),
    caller: vi.fn(async () => {
      const next = results.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }),
    allowed: vi.fn(async () => ({ allowed: allowed.shift() ?? true, reason: 'ИИ-обработка отозвана' })),
    save: vi.fn(async () => undefined),
  };
  return d as typeof d & ISiteProjectsDeps;
};

describe('проход по страницам', () => {
  it('принятый ответ — строка ok с проверенными проектами; не по схеме — строка invalid_answer', async () => {
    const d = deps([
      { ok: true, data: { projects: [p(), p({ name: 'ЖК Берег', quote: 'ЖК «Берег» — скоро' })] }, usage, rawResponse: '{}' },
      { ok: false, failure: 'schema_error', message: 'projects: Required', usage, rawResponse: '{}' },
    ]);
    const runs = await runSiteProjectsPass(2, d);
    expect(runs.map(r => r.outcome)).toEqual(['saved', 'invalid_answer']);
    expect(d.save).toHaveBeenNthCalledWith(1, PAGE, expect.objectContaining({ outcome: 'ok', rejected: 1, projects: [expect.objectContaining({ name: 'ЖК «Остров»' })] }));
    expect(d.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 6 }), expect.objectContaining({ outcome: 'invalid_answer', error: 'projects: Required' }));
  });

  it('сбой связи — стоп без строки; допуск отозван после ответа — ответ не записан', async () => {
    const down = deps([{ ok: false, failure: 'llm_error', message: 'HTTP 502', usage, rawResponse: null }]);
    expect((await runSiteProjectsPass(2, down)).map(r => r.outcome)).toEqual(['model_error']);
    expect(down.save).not.toHaveBeenCalled();
    expect(down.caller).toHaveBeenCalledTimes(1);

    const revoked = deps([{ ok: true, data: { projects: [p()] }, usage, rawResponse: '{}' }, new Error('не дойдёт')], [true, false, false]);
    const runs = await runSiteProjectsPass(2, revoked);
    expect(runs.map(r => r.outcome)).toEqual(['refused_policy', 'refused_policy']);
    expect(revoked.save).not.toHaveBeenCalled();
    expect(revoked.caller).toHaveBeenCalledTimes(1);
  });
});

describe('сверка с порталом', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const seen = (name: string, firstSeenAt: string, over: Partial<ISiteProject> = {}): ISiteProjectSighting => ({
    project: p({ name, ...over }),
    pageUrl: 'https://demo.ru/projects',
    pageTitle: 'Проекты',
    seenAt: '2026-10-06T10:00:00Z',
    firstSeenAt,
    host: 'demo.ru',
  });

  it('совпадение по ключу точно или префиксом; новое — нет на портале и впервые ≤ 90 дней; дубль — подробнейший', () => {
    const rows = classifyProjects(
      [
        seen('ЖК «Остров»', '2026-01-01T00:00:00Z'),
        seen('Символ', '2026-09-30T00:00:00Z', { status: 'unknown', completion: null }),
        seen('Квартал «Символ»', '2026-08-01T00:00:00Z', { status: 'completed', completion: '2024' }),
        seen('ЖК Берег', '2026-09-20T00:00:00Z'),
        seen('ЖК Дом', '2025-01-01T00:00:00Z'),
      ],
      [
        { projectId: 1, name: 'Остров-2' },
        { projectId: 2, name: 'ЖК Домашний' },
      ],
      now,
    );
    expect(rows.map(r => [r.name, r.isNew, r.match?.projectId ?? null])).toEqual([
      ['ЖК Берег', true, null],
      ['Квартал «Символ»', true, null],
      ['ЖК Дом', false, null],
      ['ЖК «Остров»', false, 1],
    ]);
    expect(rows[1]?.firstSeenAt).toBe('2026-08-01T00:00:00Z');
  });
});
