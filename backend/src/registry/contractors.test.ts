// Этап 24D без БД: строка «Генподрядчики» ДОМ.РФ → название и ИНН.

import { describe, it, expect } from 'vitest';

import { parseRegistryContractors } from './contractors.js';

describe('строка «Генподрядчики» ДОМ.РФ (T24D-01)', () => {
  it('одно название с ИНН', () => {
    expect(parseRegistryContractors('ООО СУ-10 (ИНН: 7736255508)')).toEqual([{ name: 'ООО СУ-10', inn: '7736255508' }]);
  });

  it('несколько через запятую и точку с запятой', () => {
    expect(parseRegistryContractors('ООО СУ-10 (ИНН: 7736255508), ООО «СЗ ДЕМО» (ИНН: 7704412966); АО Строй')).toEqual([
      { name: 'ООО СУ-10', inn: '7736255508' },
      { name: 'ООО «СЗ ДЕМО»', inn: '7704412966' },
      { name: 'АО Строй', inn: null },
    ]);
  });

  it('ИНН с неверной контрольной суммой не используется для поиска, название остаётся', () => {
    expect(parseRegistryContractors('ООО Ошибка (ИНН: 7736255509)')).toEqual([{ name: 'ООО Ошибка', inn: null }]);
  });

  it('без ИНН запятая внутри названия не режет компанию, запятая перед формой — режет', () => {
    expect(parseRegistryContractors('ООО «Строй, Монтаж», АО «Второй»')).toEqual([
      { name: 'ООО «Строй, Монтаж»', inn: null },
      { name: 'АО «Второй»', inn: null },
    ]);
  });

  it('повтор одного ИНН — одна запись; пусто — пустой список', () => {
    expect(parseRegistryContractors('ООО СУ-10 (ИНН: 7736255508), ООО СУ 10 (ИНН 7736255508)')).toHaveLength(1);
    expect(parseRegistryContractors('')).toEqual([]);
    expect(parseRegistryContractors(null)).toEqual([]);
  });
});
