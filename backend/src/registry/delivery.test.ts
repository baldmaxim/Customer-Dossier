// Сроки и продажи по снимкам ДОМ.РФ без базы (этап 24E, T24E-01…03).

import { describe, expect, it } from 'vitest';

import { summarizeDelivery, type IHouseInput, type IHouseSnapshot } from './delivery.js';
import { completionEnd, parseCompletion, parseSoldCount } from './values.js';

const snap = (fetchedAt: string, over: Partial<IHouseSnapshot> = {}): IHouseSnapshot => ({
  fetchedAt,
  asOf: null,
  status: 'Строится',
  completion: 'IV кв. 2027',
  apartments: '400',
  soldPercent: '50%',
  soldCount: null,
  price: '500 000 ₽',
  ...over,
});

const house = (ref: string, snapshots: IHouseSnapshot[], name = `Дом ${ref}`): IHouseInput => ({ externalRef: ref, name, projectId: 1, projectName: 'ЖК Река', snapshots });

const NOW = new Date('2026-10-06T00:00:00Z');

describe('строки ДОМ.РФ на сервере (T24E-01)', () => {
  it('срок: квартал, дата, год; конец срока — последний день квартала или года', () => {
    expect(parseCompletion('IV кв. 2027')).toEqual({ year: 2027, quarter: 4 });
    expect(parseCompletion('30.09.2028')).toEqual({ year: 2028, quarter: 3 });
    expect(parseCompletion('Сдан')).toBeNull();
    expect(completionEnd({ year: 2025, quarter: 1 })).toBe('2025-03-31');
    expect(completionEnd({ year: 2026, quarter: null })).toBe('2026-12-31');
  });

  it('«120 квартир из 472» — продано и всего; часть больше целого — null', () => {
    expect(parseSoldCount('120 квартир из 472')).toEqual({ sold: 120, total: 472 });
    expect(parseSoldCount('1 квартира из 21')).toEqual({ sold: 1, total: 21 });
    expect(parseSoldCount('500 квартир из 472')).toBeNull();
  });
});

describe('сроки сдачи по домам (T24E-02)', () => {
  const view = summarizeDelivery(
    [
      house('1', [snap('2026-09-21T00:00:00Z', { completion: 'II кв. 2026' })]),
      house('2', [snap('2026-09-21T00:00:00Z', { status: 'Сдан', completion: 'IV кв. 2025', apartments: '300' })]),
      house('3', [snap('2026-09-21T00:00:00Z', { status: 'Сдан', completion: 'IV кв. 2023', apartments: '100' })]),
      house('4', [snap('2026-09-21T00:00:00Z', { completion: 'III кв. 2027' }), snap('2026-10-01T00:00:00Z', { completion: 'I кв. 2028' })]),
      house('5', [snap('2026-09-21T00:00:00Z', { completion: 'когда-нибудь' })]),
    ],
    NOW,
  );

  it('срок по декларации прошёл, а дом не сдан, — в отдельном списке; сданный в срок туда не попадает', () => {
    expect(view.pastDue.map(h => h.externalRef)).toEqual(['1']);
    expect(view.list[0]!.externalRef).toBe('1');
  });

  it('сдано за 24 месяца — по сроку сданного дома; старше окна — отдельным числом', () => {
    expect(view.delivered).toEqual({ recent: 1, recentApartments: 300, older: 1, windowFrom: '2024-10-06' });
    expect(view.inProgress).toEqual({ count: 3, apartments: 1200 });
  });

  it('тот же срок другим форматом («31.03.2028» → «I кв. 2028») — не перенос', () => {
    const same = summarizeDelivery([house('9', [snap('2026-09-21T00:00:00Z', { completion: '31.03.2028' }), snap('2026-09-28T00:00:00Z', { completion: 'I кв. 2028' })])], NOW);
    expect(same.shifts).toEqual([]);
  });

  it('перенос срока — по ряду снимков, со стороной сдвига; незнакомый срок — «не распознано»', () => {
    expect(view.shifts).toEqual([{ externalRef: '4', name: 'Дом 4', from: 'III кв. 2027', to: 'I кв. 2028', at: '2026-10-01', direction: 'later' }]);
    expect(view.unparsed.completion).toBe(1);
    expect(view.observedSince).toBe('2026-09-21');
  });
});

describe('продажи (T24E-03)', () => {
  it('доля — взвешенная по квартирам строящихся домов; цена — диапазоном', () => {
    const view = summarizeDelivery(
      [house('1', [snap('2026-09-21T00:00:00Z', { apartments: '100', soldPercent: '10%', price: '400 000 ₽' })]), house('2', [snap('2026-09-21T00:00:00Z', { apartments: '300', soldCount: '270 квартир из 300', price: '600 000 ₽' })])],
      NOW,
    );
    // (100 × 0,1 + 300 × 0,9) / 400 = 0,7.
    expect(view.sales).toEqual({ apartments: 400, share: 0.7, counted: 2, price: { min: 400_000, max: 600_000, counted: 2 } });
  });

  it('продажи между снимками — только если между первым и последним снимком 30 дней и больше', () => {
    const long = summarizeDelivery(
      [house('1', [snap('2026-08-01T00:00:00Z', { soldCount: '100 квартир из 400' }), snap('2026-09-15T00:00:00Z', { soldCount: '130 квартир из 400' })])],
      NOW,
    );
    expect(long.dynamics).toEqual({ houses: 1, sold: 30, fromDate: '2026-08-01', toDate: '2026-09-15' });
    const short = summarizeDelivery(
      [house('1', [snap('2026-09-01T00:00:00Z', { soldCount: '100 квартир из 400' }), snap('2026-09-15T00:00:00Z', { soldCount: '130 квартир из 400' })])],
      NOW,
    );
    expect(short.dynamics).toBeNull();
  });

  it('нет домов — пустая сводка без выдуманных чисел', () => {
    expect(summarizeDelivery([], NOW)).toMatchObject({ houses: 0, observedSince: null, sales: { share: null, price: null }, dynamics: null });
  });
});
