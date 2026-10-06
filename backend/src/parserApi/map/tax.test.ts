// Карта «Прозрачного бизнеса» без сети (этап 24B, T24B-02): форма — как в живом ответе 06.10.2026, числа — синтетические.

import { describe, expect, it } from 'vitest';

import type { IDatasetPayload } from '../datasets.js';
import { mapTax } from './tax.js';

const INN = '7736255508';

const payload = (org: unknown[]): IDatasetPayload => ({
  format: 'parser-api-dataset@1',
  dataset: 'tax',
  inn: INN,
  window: null,
  missing: [],
  responses: [{ method: 'pb_org', params: { inn: INN }, body: { success: 1, org } }],
});

const org = (over: Record<string, unknown> = {}) => ({
  inn: INN,
  avg_headcount: [{ year: 2024, count: 31 }, { year: 2025, count: 65 }],
  income_expenses: [{ year: 2025, income: 5_000_000, expense: 4_000_000 }],
  taxes_paid: [
    { year: 2025, kbk: 'Р.1.', kbk_name: 'Налог на имущество', sum: 100.5 },
    { year: 2025, kbk: 'М.1.', kbk_name: 'Земельный налог', sum: 50 },
    { year: 2024, kbk: 'Р.1.', kbk_name: 'Налог на имущество', sum: 70 },
  ],
  arrears: [
    { year: 2026, period: 5, kbk_name: 'Суммы пеней', total_sum: 20, arrear_sum: 0, penalty_sum: 20, fine_sum: 0 },
    { year: 2026, period: 5, kbk_name: 'Налог на прибыль', total_sum: 72, arrear_sum: 72, penalty_sum: 0, fine_sum: 0 },
    { year: 2025, period: 11, kbk_name: 'Государственная пошлина', total_sum: 11, arrear_sum: 11, penalty_sum: 0, fine_sum: 0 },
    { year: 2026, period: 2, kbk_name: 'НДС', total_sum: 5, arrear_sum: 5, penalty_sum: 0, fine_sum: 0 },
  ],
  has_bailiff_debt: false,
  has_no_reporting: true,
  flags_date: '2026-09-01',
  tax_modes: [],
  msp: null,
  ...over,
});

describe('карта «Прозрачного бизнеса» (T24B-02)', () => {
  it('численность и налоги по годам, по убыванию; налоги — сумма строк года', () => {
    const view = mapTax(payload([org()]));
    expect(view.headcount).toEqual([{ year: 2025, count: 65 }, { year: 2024, count: 31 }]);
    expect(view.taxesPaid).toEqual([{ year: 2025, total: 150.5, lines: 2 }, { year: 2024, total: 70, lines: 1 }]);
    expect(view.incomeExpenses).toEqual([{ year: 2025, income: 5_000_000, expense: 4_000_000 }]);
  });

  it('недоимка — последняя выгрузка (год, затем период); прежние — итогом', () => {
    const view = mapTax(payload([org()]));
    expect(view.arrears).toMatchObject({ year: 2026, period: 5, total: 92, arrear: 72, penalty: 20, fine: 0 });
    expect(view.arrears!.items.map(i => i.name)).toEqual(['Налог на прибыль', 'Суммы пеней']);
    expect(view.arrearsHistory).toEqual([{ year: 2026, period: 2, total: 5 }, { year: 2025, period: 11, total: 11 }]);
  });

  it('флаги — на дату ФНС; нет недоимки — null, а не ноль', () => {
    const view = mapTax(payload([org({ arrears: [] })]));
    expect(view.flags).toEqual({ bailiffDebt: false, noReporting: true, asOf: '2026-09-01' });
    expect(view.arrears).toBeNull();
  });

  it('запись с чужим ИНН не берётся — не распознано', () => {
    const view = mapTax(payload([org({ inn: '7704412966' })]));
    expect(view).toMatchObject({ recognized: false, headcount: [] });
    expect(view.problems[0]).toMatch(/ИНН/);
  });

  it('tax-map@2: правонарушения по годам, статус и число юрлиц у руководителя и учредителей — словами ФНС', () => {
    const view = mapTax(
      payload([
        org({
          status: 'Находится в процедуре банкротства',
          offenses: [{ year: 2023, fine_sum: 5000 }, { year: 2024, fine_sum: 11527564.2 }],
          director: [{ inn: '770000000001', name: 'ИВАНОВ ИВАН', position: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР', count: 7 }],
          owner: [{ inn: '770000000001', name: 'ИВАНОВ ИВАН', count: 1 }, { name: '' }],
        }),
      ]),
    );
    expect(view.status).toBe('Находится в процедуре банкротства');
    expect(view.offenses).toEqual([{ year: 2024, fine: 11527564.2 }, { year: 2023, fine: 5000 }]);
    expect(view.people).toEqual({
      directors: [{ name: 'ИВАНОВ ИВАН', position: 'ГЕНЕРАЛЬНЫЙ ДИРЕКТОР', companies: 7 }],
      owners: [{ name: 'ИВАНОВ ИВАН', position: null, companies: 1 }],
    });
  });

  it('пустой список правонарушений — «нарушений нет» ([]), нет поля — не знаем (null)', () => {
    expect(mapTax(payload([org({ offenses: [] })])).offenses).toEqual([]);
    expect(mapTax(payload([org()])).offenses).toBeNull();
  });
});
