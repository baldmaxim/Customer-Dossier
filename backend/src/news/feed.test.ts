// «Новое» без базы (этап 24F, T24F-01…03): новые объекты, переносы срока, новые дела и производства.

import { describe, expect, it } from 'vitest';

import type { IDatasetPayload } from '../parserApi/datasets.js';
import { newProjectItems, recordItems, shiftItems } from './feed.js';

const INN = '7736255508';
const created = new Date('2026-10-05T10:00:00Z');

describe('новые объекты (T24F-01)', () => {
  const rows = [
    { id: 1, name: 'Река', city: 'Москва', createdAt: created, parts: [{ id: 10, name: 'Девелопер', role: 'developer', origin: 'published', doc: 77 }, { id: 11, name: 'Генподряд', role: 'general_contractor', origin: 'published', doc: 75 }] },
    { id: 2, name: 'Без заказчика', city: null, createdAt: created, parts: [{ id: 11, name: 'Генподряд', role: 'general_contractor', origin: 'published', doc: 80 }] },
    { id: 3, name: 'Из реестра', city: null, createdAt: created, parts: [{ id: 12, name: 'СЗ', role: 'developer', origin: 'registry', doc: null }] },
  ];

  it('«все» — только объекты с названной стороной заказчика; заказчик в списке первым; основание — ранняя публикация', () => {
    const items = newProjectItems(rows, new Set(), 'all');
    expect(items.map(i => i.project?.id)).toEqual([1, 3]);
    expect(items[0]).toMatchObject({ kind: 'new_project', title: 'Новый объект «Река», Москва', source: { kind: 'publication', documentId: 75 } });
    expect(items[0]!.companies.map(c => c.id)).toEqual([10, 11]);
    expect(items[1]!.source.kind).toBe('registry');
  });

  it('«на контроле» — только где участвует отмеченная компания, хоть и без заказчика', () => {
    expect(newProjectItems(rows, new Set([11]), 'watched').map(i => i.project?.id)).toEqual([1, 2]);
  });
});

describe('переносы срока (T24F-02)', () => {
  const base = { externalRef: '62087', projectId: 5, projectName: 'Река', name: 'Дом 1', fetchedAt: created };
  const developers = new Map([[5, [{ id: 10, name: 'Девелопер', role: 'developer' }]]]);

  it('срок сменился — новость со стороной сдвига и ссылкой на страницу ДОМ.РФ', () => {
    const [item] = shiftItems([{ ...base, prev: 'III кв. 2027', completion: 'I кв. 2028' }], developers, new Set([10]), 'watched');
    expect(item).toMatchObject({ kind: 'deadline_shift', detail: 'III кв. 2027 → I кв. 2028 (позже)', watched: true, project: { id: 5 } });
    expect(decodeURI(item!.source.href!)).toContain('/объект/62087');
  });

  it('тот же квартал другим форматом — не новость; «на контроле» без отмеченной компании — не новость', () => {
    expect(shiftItems([{ ...base, prev: '31.03.2028', completion: 'I кв. 2028' }], developers, new Set(), 'all')).toEqual([]);
    expect(shiftItems([{ ...base, prev: 'III кв. 2027', completion: 'I кв. 2028' }], developers, new Set(), 'watched')).toEqual([]);
  });
});

const courtsPayload = (ids: string[]): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset: 'courts',
  inn: INN,
  window: { from: '2024-10-01' },
  missing: [],
  responses: [
    {
      method: 'kad_search',
      params: { page: '1' },
      body: { Success: 1, PagesCount: 1, Cases: ids.map(id => ({ CaseId: id, CaseNumber: `А40-${id}/2026`, CaseType: 'Г', StartDate: '2026-10-01', Respondents: [{ Inn: INN, Name: 'Мы' }], Plaintiffs: [{ Inn: null, Name: 'Истец' }] })) },
    },
  ],
});

const fsspPayload = (numbers: string[]): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset: 'fssp',
  inn: INN,
  window: null,
  missing: [],
  responses: [{ method: 'fssp_ur', params: { inn: INN }, body: { done: 1, result: numbers.map(n => ({ process_title: n, process_date: '2026-10-01', subjects: [{ title: 'Сумма долга', sum: '1000' }] })) } }],
});

describe('новые дела и производства (T24F-03)', () => {
  const byInn = new Map([[INN, [{ id: 10, name: 'Девелопер', role: null }]]]);

  it('новость — только разница с прошлым снимком; первый снимок — не новость', () => {
    const rows = [
      { inn: INN, dataset: 'courts' as const, fetchedAt: created, complete: true, payload: courtsPayload(['1', '2', '3']), prev: courtsPayload(['1']) },
      { inn: INN, dataset: 'courts' as const, fetchedAt: created, complete: true, payload: courtsPayload(['9']), prev: null },
    ];
    const items = recordItems(rows, byInn, new Set(), 'all');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'court_case', title: 'Новые дела в картотеке: 2', detail: 'А40-3/2026, А40-2/2026; ответчик — в 2' });
    expect(items[0]!.source.href).toBe('/company/10#company-checks');
  });

  it('ФССП: новые производства числом и суммой долга по ним; нового нет — новости нет', () => {
    const [item] = recordItems(
      [{ inn: INN, dataset: 'fssp' as const, fetchedAt: created, complete: true, payload: fsspPayload(['A', 'B', 'C']), prev: fsspPayload(['A']) }],
      byInn,
      new Set(),
      'all',
    );
    expect(item).toMatchObject({ kind: 'fssp', title: 'Новые исполнительные производства: 2' });
    expect(item!.detail).toMatch(/^сумма долга по документам 2\s000 ₽$/);
    expect(recordItems([{ inn: INN, dataset: 'fssp' as const, fetchedAt: created, complete: true, payload: fsspPayload(['A']), prev: fsspPayload(['A']) }], byInn, new Set(), 'all')).toEqual([]);
  });
});

const efrsbPayload = (found: boolean, list: Array<[string, string]> | null, acts: Array<[string, string]> = []): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset: 'bankruptcy',
  inn: INN,
  window: null,
  missing: [],
  responses: [
    { method: 'fedresurs_ur', params: { orgCode: INN }, body: { success: 1, records: found ? [{ id: 'D1', inn: INN }] : [] } },
    ...(found && list ? [{ method: 'fedresurs_messages' as const, params: { id: 'D1' }, body: { success: 1, total_count: String(list.length), records: list.map(([id, type]) => ({ id, type, date: '01.10.2026 10:00:00' })) } }] : []),
    ...acts.map(([id, act]) => ({ method: 'fedresurs_message' as const, params: { id }, body: { success: 1, record: { id, act, date_published: '01.10.2026', is_actual: 1 } } })),
  ],
});

describe('ЕФРСБ в «Новом» (bankruptcy-map@2)', () => {
  const byInn = new Map([[INN, [{ id: 10, name: 'Подрядчик', role: null }]]]);
  const row = (payload: IDatasetPayload, prev: IDatasetPayload) => ({ inn: INN, dataset: 'bankruptcy' as const, fetchedAt: created, complete: true, payload, prev });
  const ACT = 'Сообщение о судебном акте';

  it('новое сообщение о судебном акте — новость словами акта; собрание кредиторов — не новость', () => {
    const prev = efrsbPayload(true, [['M1', ACT]], [['M1', 'о введении наблюдения']]);
    const cur = efrsbPayload(true, [['M3', 'Сообщение о собрании кредиторов'], ['M2', ACT], ['M1', ACT]], [['M2', 'о признании должника банкротом и открытии конкурсного производства'], ['M1', 'о введении наблюдения']]);
    const [item] = recordItems([row(cur, prev)], byInn, new Set(), 'all');
    expect(item).toMatchObject({
      kind: 'bankruptcy',
      title: 'ЕФРСБ: новые сообщения о судебных актах — 1',
      detail: '«о признании должника банкротом и открытии конкурсного производства» от 01.10.2026',
      source: { kind: 'efrsb', href: '/company/10#company-checks' },
    });
  });

  it('компания появилась в ЕФРСБ — новость; первый список после снимка без сообщений (@1) — не новость', () => {
    const appeared = recordItems([row(efrsbPayload(true, [['M1', ACT]]), efrsbPayload(false, null))], byInn, new Set(), 'all');
    expect(appeared).toMatchObject([{ kind: 'bankruptcy', title: 'Компания появилась в ЕФРСБ' }]);
    expect(recordItems([row(efrsbPayload(true, [['M1', ACT]]), efrsbPayload(true, null))], byInn, new Set(), 'all')).toEqual([]);
    // Карточку старого акта получили позже (предел за проход) — список тот же, новости нет.
    expect(recordItems([row(efrsbPayload(true, [['M1', ACT]], [['M1', 'о введении наблюдения']]), efrsbPayload(true, [['M1', ACT]]))], byInn, new Set(), 'all')).toEqual([]);
  });
});
