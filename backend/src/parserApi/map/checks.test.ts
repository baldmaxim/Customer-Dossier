// Карты картотеки дел, ФССП и Федресурса без сети (этап 24C, T24C-01…03): форма — как в живых ответах 06.10.2026,
// данные — синтетические.

import { describe, expect, it } from 'vitest';

import type { IDatasetPayload, IDatasetResponse } from '../datasets.js';
import { mapBankruptcy } from './bankruptcy.js';
import { mapCaseCard } from './caseCard.js';
import { claimCardTargets, mapCourts } from './courts.js';
import { mapFssp } from './fssp.js';

const INN = '7736255508';
const ME = { Inn: INN, Name: 'ООО «Демо»', Address: 'Москва' };
const party = (name: string, inn: string | null = null) => ({ Inn: inn, Name: name, Address: null });

const payload = (dataset: IDatasetPayload['dataset'], responses: IDatasetResponse[]): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset,
  inn: INN,
  window: dataset === 'courts' ? { from: '2024-10-01' } : null,
  missing: [],
  responses,
});

const kadPage = (page: number, cases: unknown[]): IDatasetResponse => ({
  method: 'kad_search',
  params: { Inn: INN, InnType: 'Any', DateFrom: '2024-10-01', page: String(page) },
  body: { Success: 1, PagesCount: 2, Cases: cases },
});

const kadCase = (id: string, date: string, type: string, plaintiffs: unknown[], respondents: unknown[]) => ({
  CaseId: id,
  CaseNumber: `А40-${id.slice(0, 4)}/2026`,
  CaseType: type,
  Court: 'АС города Москвы',
  StartDate: date,
  Plaintiffs: plaintiffs,
  Respondents: respondents,
  Thirds: null,
  Others: null,
});

const GUID_A = '11111111-2222-3333-4444-555555555555';
const GUID_B = '21111111-2222-3333-4444-555555555555';
const GUID_C = '31111111-2222-3333-4444-555555555555';

describe('картотека дел (T24C-01)', () => {
  const view = mapCourts(
    payload('courts', [
      kadPage(1, [kadCase(GUID_A, '2026-09-01', 'Г', [party('ДГИ Москвы', '7705031674')], [ME]), kadCase(GUID_B, '2025-03-01', 'А', [ME], [party('ИФНС')])]),
      // Второй раз то же дело (повтор на странице) и дело, где компании нет среди сторон.
      kadPage(2, [kadCase(GUID_A, '2026-09-01', 'Г', [], [ME]), kadCase(GUID_C, '2026-08-01', 'Б', [party('Иванов И. И.')], [party('ООО «Другое»')])]),
    ]),
    '2026-10-06T08:00:00Z',
    true,
  );

  it('роль — по ИНН среди сторон; не нашлась — «не указана», не догадка; повтор дела не считается дважды', () => {
    expect(view.total).toBe(3);
    expect(view.byRole).toEqual({ respondent: 1, plaintiff: 1, third: 0, other: 0, unknown: 1 });
    expect(view.byType).toEqual({ economic: 1, administrative: 1, bankruptcy: 1, unknown: 0 });
  });

  it('другая сторона — противоположная роли; ссылка — карточка дела на kad.arbitr.ru; новые сверху', () => {
    expect(view.cases.map(c => c.startDate)).toEqual(['2026-09-01', '2026-08-01', '2025-03-01']);
    expect(view.cases[0]).toMatchObject({ roles: ['respondent'], counterparties: ['ДГИ Москвы'], url: `https://kad.arbitr.ru/Card/${GUID_A}` });
    expect(view.cases[2]).toMatchObject({ roles: ['plaintiff'], counterparties: ['ИФНС'] });
    expect(view.cases[1]!.counterparties).toEqual(['Иванов И. И.', 'ООО «Другое»']);
  });

  it('«за 12 месяцев» — от даты проверки, а не от сегодняшнего дня', () => {
    expect(view.last12m).toEqual({ from: '2025-10-06', total: 2, respondent: 1, plaintiff: 0 });
  });

  it('нет страниц — не распознано; неполный набор — complete: false', () => {
    expect(mapCourts(payload('courts', []), null, true)).toMatchObject({ recognized: false, total: 0 });
    expect(mapCourts(payload('courts', [kadPage(1, [])]), null, false).complete).toBe(false);
  });
});

describe('суммы исков из карточек дел (case-card-map@1)', () => {
  const event = (date: string, claimSum: unknown, type = 'Определение') => ({ Date: date, EventTypeName: type, ClaimSum: claimSum });
  const card = (instances: unknown[], caseId = GUID_A) => ({ Success: 1, Cases: [{ CaseId: caseId, CaseInstances: instances }] });

  it('при подаче — самое раннее событие первой инстанции с суммой; другая поздняя — «позже в карточке»', () => {
    const claim = mapCaseCard(
      card([
        { Name: 'Апелляционная инстанция', InstanceEvents: [event('2026-01-10', 999)] },
        { Name: 'Первая инстанция', InstanceEvents: [event('2025-11-01', 0), event('2025-09-02', 1_500_000.5, 'Исковое заявление'), event('2025-12-01', '2000000,00')] },
      ]),
      GUID_A,
      '2026-10-06T08:00:00Z',
    );
    expect(claim).toEqual({ fetchedAt: '2026-10-06T08:00:00Z', recognized: true, amount: 1_500_000.5, latest: 2_000_000 });
  });

  it('суммы нет или 0 — «не указана», а не 0 ₽; без первой инстанции — события всех; без инстанций — не распознано', () => {
    expect(mapCaseCard(card([{ Name: 'Первая инстанция', InstanceEvents: [event('2025-09-02', 0), event('2025-09-03', null)] }]), GUID_A, 'x')).toMatchObject({ recognized: true, amount: null, latest: null });
    expect(mapCaseCard(card([{ Name: 'Кассационная инстанция', InstanceEvents: [event('2025-09-02', 300), event('2025-10-02', 300)] }]), GUID_A, 'x')).toMatchObject({ amount: 300, latest: null });
    expect(mapCaseCard({ Success: 1, Cases: [] }, GUID_A, 'x')).toMatchObject({ recognized: false, amount: null });
  });

  const courts = (claims: Map<string, ReturnType<typeof mapCaseCard>>) =>
    mapCourts(
      payload('courts', [
        kadPage(1, [
          kadCase(GUID_A, '2026-09-01', 'Г', [party('Истец', '7705031674')], [ME]),
          kadCase(GUID_B, '2026-08-01', 'Г', [ME], [party('Ответчик')]),
          kadCase(GUID_C, '2026-07-01', 'А', [party('ИФНС')], [ME]),
        ]),
      ]),
      '2026-10-06T08:00:00Z',
      true,
      claims,
    );

  it('карточки нужны только экономическим спорам, где компания — ответчик; сумма — у дела, чья карточка есть', () => {
    const empty = courts(new Map());
    expect(claimCardTargets(empty)).toEqual([GUID_A]);
    expect(empty.claims).toEqual({ wanted: 1, fetched: 0, withAmount: 0 });
    const claim = { fetchedAt: '2026-10-06T09:00:00Z', recognized: true, amount: 5_000_000, latest: null };
    // Карточка дела, где компания — истец, получена для другой стороны: показывается, но в «нужные» не входит.
    const other = { ...claim, amount: 70_000 };
    const view = courts(new Map([[GUID_A, claim], [GUID_B, other]]));
    expect(view.cases.map(c => c.claim?.amount ?? null)).toEqual([5_000_000, 70_000, null]);
    expect(view.claims).toEqual({ wanted: 1, fetched: 1, withAmount: 1 });
  });
});

const proceeding = (n: number, date: string, sums: Record<string, number>, over: Record<string, unknown> = {}) => ({
  process_title: `${n}/26/77007-ИП`,
  process_date: date,
  subjects: [{ title: 'Иные взыскания имущественного характера' }, ...Object.entries(sums).map(([title, sum]) => ({ title, sum: String(sum) }))],
  department_title: 'Кунцевский ОСП',
  document_organization: 'ТВЕРСКОЙ РАЙОННЫЙ СУД',
  ...over,
});

describe('ФССП (T24C-02)', () => {
  const fssp = (result: unknown[]) =>
    mapFssp(payload('fssp', [{ method: 'fssp_ur', params: { inn: INN }, body: { done: 1, result, total_rows_count: String(result.length), total_pages_count: 1 } }]), '2026-10-06T08:00:00Z', true);

  it('даты окончания нет — «не окончено по данным ФССП»; есть — окончено с основанием', () => {
    const view = fssp([
      proceeding(1, '2026-09-01', { 'Сумма долга': 100, 'Остаток долга по исполнительному документу': 80, 'Исполнительский сбор': 7 }),
      proceeding(2, '2025-01-01', { 'Сумма долга': 50 }),
      proceeding(3, '2024-04-05', { 'Сумма долга': 30 }, { stop_date: '2024-07-08', stop_reason: 'ст. 46 ч. 1 п. 3' }),
    ]);
    expect(view.open).toEqual({ count: 2, debt: 150, remaining: 80, remainingCovered: 1, fee: 7 });
    expect(view.ended).toEqual({ count: 1, byReason: [{ reason: 'ст. 46 ч. 1 п. 3', count: 1 }] });
    expect(view.unknownStatus).toBe(0);
  });

  it('остаток — только где ФССП его указала: «у K из N», а не сумма долга вместо остатка', () => {
    const view = fssp([proceeding(1, '2026-09-01', { 'Сумма долга': 100 }), proceeding(2, '2026-09-02', { 'Сумма долга': 40, 'Остаток долга по исполнительному документу': 10 })]);
    expect(view.open).toMatchObject({ remaining: 10, remainingCovered: 1, debt: 140 });
  });

  it('основание окончания без даты — статус не ясен; повтор производства не считается', () => {
    const view = fssp([proceeding(1, '2026-01-01', {}, { stop_reason: 'ст. 47' }), proceeding(2, '2026-01-01', {}), proceeding(2, '2026-01-01', {})]);
    expect(view).toMatchObject({ unknownStatus: 1, open: { count: 1 } });
  });

  it('по годам и за 12 месяцев до проверки; последние — новые сверху', () => {
    const view = fssp([proceeding(1, '2024-05-01', {}), proceeding(2, '2026-09-01', {}), proceeding(3, '2025-12-01', {})]);
    expect(view.openedByYear).toEqual([{ year: 2026, count: 1 }, { year: 2025, count: 1 }, { year: 2024, count: 1 }]);
    expect(view.last12m).toEqual({ from: '2025-10-06', count: 2 });
    expect(view.recent.map(p => p.number)).toEqual(['2/26/77007-ИП', '3/26/77007-ИП', '1/26/77007-ИП']);
  });

  it('нет списка — не распознано, а не «производств нет»', () => {
    expect(mapFssp(payload('fssp', [{ method: 'fssp_ur', params: { inn: INN }, body: { done: 1 } }]), null, true)).toMatchObject({ recognized: false });
  });
});

describe('Федресурс (T24C-03)', () => {
  const search = (records: unknown[]): IDatasetResponse => ({ method: 'fedresurs_ur', params: { orgCode: INN }, body: { success: 1, total_count: String(records.length), records } });

  it('записей нет — найдено: нет, распознано (это ответ сервиса, а не «не проверяли»)', () => {
    expect(mapBankruptcy(payload('bankruptcy', [search([])]))).toMatchObject({ recognized: true, found: false, record: null });
  });

  it('запись — только с тем же ИНН; карточка get_org дополняет имя и адрес', () => {
    const view = mapBankruptcy(
      payload('bankruptcy', [
        search([{ id: 'X', inn: '7704412966', debtor: 'Чужая' }, { id: 'Y', inn: INN, debtor: 'ООО Демо', category: 'Обычная организация', region: 'Москва' }]),
        { method: 'fedresurs_org', params: { id: 'Y' }, body: { success: 1, record: { full_name: 'ОБЩЕСТВО «ДЕМО»', address: 'Москва, ул. 1' } } },
      ]),
    );
    expect(view).toMatchObject({ found: true, record: { name: 'ОБЩЕСТВО «ДЕМО»', category: 'Обычная организация', address: 'Москва, ул. 1' } });
    expect(mapBankruptcy(payload('bankruptcy', [search([{ id: 'X', inn: '7704412966' }])])).found).toBe(false);
  });
});
