// Сводка портфеля ДОМ.РФ: суммы — только по разобранным значениям, распроданность — взвешенная по
// квартирам, цена — диапазоном, объекты без сведений и неразобранное — счётчиками, а не нулями.

import { describe, expect, it } from 'vitest';

import type { ICompanyObject } from '../../api/types';
import { objectRegistry, objectRow } from '../../pages/companyPage.fixtures';
import { summarizePortfolio } from './portfolio';

const obj = (id: number, registry: Record<string, unknown> | null, via: ICompanyObject['via'] = null): ICompanyObject =>
  objectRow({ projectId: id, name: `Объект ${id}`, registry: registry ? objectRegistry(registry) : null, via }) as ICompanyObject;

describe('summarizePortfolio', () => {
  it('числа — по объектам со сведениями, с числом учтённых', () => {
    const items = [
      obj(1, { apartments: '400', sold: '50 %', pricePerSqm: '200 000 ₽', completion: 'IV кв. 2027', status: 'Строится' }),
      obj(2, { apartments: '100', sold: '10 %', pricePerSqm: '300 000 ₽', completion: '30.09.2026', status: 'Сдан', asOf: '2026-09-10' }),
      obj(3, { apartments: 'около 50', sold: '90 %', pricePerSqm: 'по запросу', completion: 'Сдан', status: 'Строится' }, { companyId: 70, name: 'СЗ' }),
      obj(4, null),
    ];
    const p = summarizePortfolio({ items, coverage: { loaded: 4, total: 5, truncated: false } });

    expect(p.total).toBe(5);
    expect(p.withRegistry).toBe(3);
    expect(p.viaGroup).toBe(1);
    expect(p.statuses).toEqual([
      { label: 'Строится', count: 2 },
      { label: 'Сдан', count: 1 },
    ]);
    expect(p.completion).toEqual({ byYear: [{ year: 2026, count: 1 }, { year: 2027, count: 1 }], unparsed: 1, missing: 0 });
    expect(p.apartments).toEqual({ sum: 500, counted: 2, unparsed: 1 });
    // (400 × 0,5 + 100 × 0,1) / 500 = 0,42; у третьего объекта квартиры не разобраны — его доля не входит.
    expect(p.sold.share).toBeCloseTo(0.42);
    expect(p.sold.counted).toBe(2);
    expect(p.price).toEqual({ min: 200000, max: 300000, counted: 2 });
    expect(p.asOf).toEqual({ from: '2026-09-10', to: '2026-09-20' });
  });

  it('без сведений ДОМ.РФ — нули счётчиков и null вместо долей и диапазонов', () => {
    const p = summarizePortfolio({ items: [obj(1, null)], coverage: { loaded: 1, total: 1, truncated: false } });
    expect(p.withRegistry).toBe(0);
    expect(p.sold.share).toBeNull();
    expect(p.price).toBeNull();
    expect(p.asOf).toBeNull();
  });
});
