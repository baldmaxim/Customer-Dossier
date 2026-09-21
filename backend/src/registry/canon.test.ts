// Этап 20B без БД: разница снимков реестра.

import { describe, it, expect } from 'vitest';

import { diffPayloads, type IRegistryPayload } from './changes.js';

const payload = (over: Partial<IRegistryPayload['identity']> = {}, fields: Array<{ label: string; value: string }> = []): IRegistryPayload => ({
  identity: {
    externalRef: '62087',
    name: 'Демо-Татарская 35',
    city: 'Москва',
    address: 'Москва город, Район Замоскворечье',
    asOf: null,
    developer: { name: 'СЗ ДЕМО-ПРАКТИКА', legalForm: 'ООО', inn: '7704412966', ogrn: null },
    groupName: 'Демо-Строй',
    ...over,
  },
  fields,
});

describe('разница снимков реестра (T20B-01)', () => {
  it('одинаковые снимки не дают изменений', () => {
    const a = payload({}, [{ label: 'Срок сдачи', value: '30.09.2028' }]);
    expect(diffPayloads(a, payload({}, [{ label: 'Срок сдачи', value: '30.09.2028' }]))).toEqual([]);
  });

  it('перенос срока виден как переход от старого значения к новому', () => {
    const before = payload({}, [{ label: 'Срок сдачи', value: '30.09.2028' }]);
    const after = payload({}, [{ label: 'Срок сдачи', value: '31.03.2029' }]);
    expect(diffPayloads(before, after)).toEqual([{ label: 'Срок сдачи', from: '30.09.2028', to: '31.03.2029' }]);
  });

  it('появление поля — изменение: стадия банкротства возникла, её не было', () => {
    const before = payload({}, []);
    const after = payload({}, [{ label: 'Стадия банкротства застройщика', value: 'наблюдение' }]);
    expect(diffPayloads(before, after)).toEqual([{ label: 'Стадия банкротства застройщика', from: null, to: 'наблюдение' }]);
  });

  it('исчезновение поля — тоже изменение, а не отсутствие новостей', () => {
    const before = payload({}, [{ label: 'Срок сдачи', value: '30.09.2028' }]);
    const after = payload({}, []);
    expect(diffPayloads(before, after)).toEqual([{ label: 'Срок сдачи', from: '30.09.2028', to: null }]);
  });

  it('смена застройщика и его ИНН видна отдельными строками', () => {
    const before = payload();
    const after = payload({ developer: { name: 'СЗ ДРУГАЯ', legalForm: 'ООО', inn: '7707083893', ogrn: null } });
    expect(diffPayloads(before, after)).toEqual([
      { label: 'Застройщик', from: 'СЗ ДЕМО-ПРАКТИКА', to: 'СЗ ДРУГАЯ' },
      { label: 'ИНН застройщика', from: '7704412966', to: '7707083893' },
    ]);
  });
});
