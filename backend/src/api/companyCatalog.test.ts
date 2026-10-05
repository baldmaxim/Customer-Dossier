// Каталог от юрлица (ADR-016): порядок строк и наименование/статус ЕГРЮЛ из урезанного ответа Фокуса.

import { describe, expect, it } from 'vitest';

import { catalogSchema, egrulOf, orderBy } from './companyCatalog.js';

describe('catalogSchema', () => {
  it('по умолчанию — юрлица, без фильтров, по числу объектов', () => {
    expect(catalogSchema.parse({})).toEqual({ view: 'legal', watch: false, role: 'any', sort: 'objects' });
  });
  it('роль — только слово из букв и подчёркиваний', () => {
    expect(catalogSchema.safeParse({ role: 'customer' }).success).toBe(true);
    expect(catalogSchema.safeParse({ role: "x' OR 1=1" }).success).toBe(false);
  });
});

describe('orderBy', () => {
  it('юрлица — на контроле первыми, затем объекты; «Без ИНН» — по числу публикаций', () => {
    expect(orderBy('legal', 'objects')).toBe('f.watched DESC, f.objects DESC, f.publications DESC, f.name, f.company_id NULLS LAST, f.group_ref');
    expect(orderBy('unidentified', 'objects')).toBe('f.publications DESC, f.objects DESC, f.name, f.company_id NULLS LAST, f.group_ref');
  });
  it('по названию — без подъёма «на контроле»', () => {
    expect(orderBy('legal', 'name')).toBe('f.name, f.company_id NULLS LAST, f.group_ref');
  });
});

describe('egrulOf', () => {
  it('юрлицо: краткое наименование и статус', () => {
    expect(egrulOf({ legal_name: { short: 'ООО "ДЕМО"', full: 'ОБЩЕСТВО "ДЕМО"' }, ul_status: { statusString: 'Действующее' }, ip: null })).toEqual({
      name: 'ООО "ДЕМО"',
      status: 'Действующее',
    });
  });
  it('предприниматель: «ИП» и ФИО', () => {
    expect(egrulOf({ legal_name: null, ul_status: null, ip: { fio: 'Сидоров С. С.', status: { statusString: 'Действующий' } } })).toEqual({
      name: 'ИП Сидоров С. С.',
      status: 'Действующий',
    });
  });
  it('ответа Фокуса нет — пусто, а не выдуманный статус', () => {
    expect(egrulOf({ legal_name: null, ul_status: null, ip: null })).toEqual({ name: null, status: null });
  });
});
