// Дом ДОМ.РФ — единица сведений реестра (07.10.2026): свод объекта по домам, ключ дома с источником, одно правило фото.

import { describe, expect, it, vi } from 'vitest';

vi.mock('./photos.js', () => ({ hasPhoto: (ref: string) => ref === 'B' || ref === 'C' }));

const { groupHouses, houseField, housesByProject, photoHouse, summarizeObject } = await import('./houses.js');
type IRegistryPayload = import('./changes.js').IRegistryPayload;

const payload = (ref: string, fields: Record<string, string>, over: Partial<IRegistryPayload['identity']> = {}): IRegistryPayload => ({
  identity: { externalRef: ref, name: `Дом ${ref}`, city: 'Москва', address: 'Москва, ул. Демо', asOf: null, developer: { name: 'СЗ Демо', legalForm: 'ООО', inn: null, ogrn: null }, groupName: null, ...over },
  fields: Object.entries(fields).map(([label, value]) => ({ label, value })),
});

const row = (sourceId: number, ref: string, fetchedAt: string, fields: Record<string, string>, over: Partial<IRegistryPayload['identity']> = {}) => ({
  sourceId,
  sourceTitle: 'наш.дом.рф',
  externalRef: ref,
  projectId: 5,
  projectName: 'ЖК Демо',
  companyId: null,
  fetchedAt: new Date(fetchedAt),
  asOf: null,
  payload: payload(ref, fields, over),
});

describe('подписи полей — одна таблица', () => {
  it('первая непустая подпись по приоритету: «Сдача дома» раньше «Срок сдачи», «Продано квартир» раньше «Распроданности»', () => {
    const p = payload('A', { 'Срок сдачи': 'IV кв. 2027', 'Сдача дома': 'I кв. 2028', 'Распроданность квартир': '10 %', 'Продано квартир': '45 %' });
    expect(houseField(p, 'completion')).toBe('I кв. 2028');
    expect(houseField(p, 'soldPercent')).toBe('45 %');
    expect(houseField(payload('A', { 'Сдача дома': ' ', 'Срок сдачи': 'IV кв. 2027' }), 'completion')).toBe('IV кв. 2027');
  });
});

describe('дома: ключ — источник + номер записи', () => {
  it('один номер записи у двух источников — два дома, ряд снимков — по дому', () => {
    const houses = groupHouses([
      row(1, 'A', '2026-09-01', { 'Статус строительства': 'Строится' }),
      row(1, 'A', '2026-10-01', { 'Статус строительства': 'Сдан' }),
      row(2, 'A', '2026-09-15', { 'Статус строительства': 'Строится' }),
    ]);
    expect(houses.map(h => [h.key, h.snapshots.length])).toEqual([
      ['1:A', 2],
      ['2:A', 1],
    ]);
    expect(housesByProject(houses).get(5)).toHaveLength(2);
  });
});

describe('свод объекта по домам', () => {
  const houses = groupHouses([
    row(1, 'A', '2026-10-01', { 'Статус строительства': 'Сдан', 'Сдача дома': 'II кв. 2024', 'Количество квартир': '100', 'Генподрядчики': 'ООО СУ-10 (ИНН: 7736255508)' }),
    row(1, 'B', '2026-09-01', {
      'Статус строительства': 'Строится',
      'Сдача дома': 'IV кв. 2027',
      'Количество квартир': '300',
      'Продано квартир, количество': '150 квартир из 300',
      'Средняя цена за 1 м²': '400 000 ₽',
      'Генподрядчики': 'ООО СУ-10 (ИНН: 7736255508), АО Стройка',
    }),
    row(1, 'C', '2026-09-20', { 'Статус строительства': 'Строится', 'Сдача дома': 'II кв. 2026', 'Количество квартир': '100', 'Продано квартир': '50 %', 'Средняя цена за 1 м²': '500 000 ₽' }),
  ]);

  it('страница, изменившаяся последней, свод не подменяет: статус «сдано 1 из 3», срок — по строящимся', () => {
    const s = summarizeObject(houses)!;
    expect(s).toMatchObject({ houses: 3, delivered: 1, inProgress: 2, status: null, completion: { from: 'II кв. 2026', to: 'IV кв. 2027' } });
    expect(s.apartments).toBe(500);
    // Продано — по строящимся, взвешенно по квартирам: (300 × 0,5 + 100 × 0,5) / 400.
    expect(s.soldShare).toBeCloseTo(0.5);
    expect(s.pricePerSqm).toEqual({ min: 400_000, max: 500_000 });
    // Генподрядчики всех домов без повторов.
    expect(s.contractors).toEqual([{ name: 'ООО СУ-10', inn: '7736255508' }, { name: 'АО Стройка', inn: null }]);
    expect(s.address).toBe('Москва, ул. Демо');
    expect(s.asOf).toBe('2026-10-01');
  });

  it('фото — дом со снятым фото и самым свежим снимком; у объекта и у паспорта одно правило', () => {
    expect(photoHouse(houses)?.externalRef).toBe('C');
    expect(summarizeObject(houses)).toMatchObject({ photoRef: 'C', hasPhoto: true });
  });

  it('один дом — его статус и срок как есть; домов нет — сведений нет', () => {
    const one = summarizeObject(groupHouses([row(1, 'A', '2026-09-01', { 'Статус строительства': 'Строится', 'Сдача дома': 'IV кв. 2027' })]))!;
    expect(one).toMatchObject({ houses: 1, status: 'Строится', completion: { from: 'IV кв. 2027', to: 'IV кв. 2027' }, hasPhoto: false });
    expect(summarizeObject([])).toBeNull();
  });
});
