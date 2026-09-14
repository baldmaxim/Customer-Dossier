// Этап 04 без БД: типы реквизитов, решения точного совпадения, география и иерархия объектов.

import { describe, it, expect } from 'vitest';

import { decideExact, inferEntityType, type IExactCandidate } from './company.js';
import { parseProjectPath } from './hierarchy.js';
import { classifyTaxId, findIdentifierConflicts } from './identifiers.js';
import { decideProjectExact, scoreProjectCandidate } from './project.js';

const INN_A = '7707083893';
const INN_B = '7736050003';
const OGRN = '1027700132239';

const candidate = (over: Partial<IExactCandidate> & { id: number }): IExactCandidate => ({
  tax_id: null,
  legal_form: null,
  entity_type: 'unknown',
  identifiers: 0,
  ...over,
});

describe('classifyTaxId / findIdentifierConflicts', () => {
  it('ИНН, ОГРН и ОГРНИП — разные типы; ведущие нули сохраняются', () => {
    expect(classifyTaxId(INN_A)).toMatchObject({ identifierType: 'inn', validationStatus: 'checksum_valid' });
    expect(classifyTaxId(OGRN)).toMatchObject({ identifierType: 'ogrn', validationStatus: 'checksum_valid' });
    expect(classifyTaxId('304500116000157')).toMatchObject({ identifierType: 'ogrnip' });
    expect(classifyTaxId('0012345678')).toMatchObject({ value: '0012345678', validationStatus: 'format_only' });
    expect(classifyTaxId('12345')).toBeNull();
  });

  it('конфликт — только тот же тип и юрисдикция с разными значениями', () => {
    const inn = (value: string) => ({ jurisdiction: 'RU', identifier_type: 'inn' as const, value });
    const ogrn = { jurisdiction: 'RU', identifier_type: 'ogrn' as const, value: OGRN };
    expect(findIdentifierConflicts([inn(INN_A)], [inn(INN_B)])).toHaveLength(1);
    expect(findIdentifierConflicts([inn(INN_A)], [ogrn])).toHaveLength(0);
    expect(findIdentifierConflicts([inn(INN_A)], [inn(INN_A)])).toHaveLength(0);
  });
});

describe('decideExact — точное имя не обходит реквизиты (TC-034…TC-036)', () => {
  it('упоминание с ИНН: одноимённая компания с другим ИНН — запрет, без ИНН — пара в очередь', () => {
    const decision = decideExact(
      [candidate({ id: 1, tax_id: INN_B, identifiers: 1, entity_type: 'legal_entity' }), candidate({ id: 2 })],
      INN_A,
      'ООО',
    );
    expect(decision).toEqual({ kind: 'create', forbidWith: [1], queueWith: [2], provisional: false });
  });

  it('бренд без формы и реквизитов не прикрепляется к ООО с ИНН (TC-035)', () => {
    const decision = decideExact([candidate({ id: 1, tax_id: INN_A, identifiers: 1, entity_type: 'legal_entity', legal_form: 'ООО' })], null, null);
    expect(decision).toEqual({ kind: 'create', forbidWith: [], queueWith: [1], provisional: true });
  });

  it('повтор того же названия без реквизитов — та же provisional-сущность, а не новый дубль', () => {
    const decision = decideExact(
      [candidate({ id: 1, tax_id: INN_A, identifiers: 1, entity_type: 'legal_entity' }), candidate({ id: 2 })],
      null,
      null,
    );
    expect(decision).toEqual({ kind: 'reuse', id: 2, provisional: true });
  });

  it('несколько равноправных кандидатов — неоднозначность, первая строка не выбирается (TC-036)', () => {
    expect(decideExact([candidate({ id: 1 }), candidate({ id: 2 })], null, null)).toEqual({ kind: 'ambiguous', candidateIds: [1, 2] });
    expect(
      decideExact([candidate({ id: 3, legal_form: 'ООО' }), candidate({ id: 4, legal_form: 'ООО' })], null, 'ООО'),
    ).toEqual({ kind: 'ambiguous', candidateIds: [3, 4] });
  });

  it('форма без реквизита: единственный совместимый кандидат — он; разные формы — отдельная сущность', () => {
    expect(decideExact([candidate({ id: 5, legal_form: 'АО' })], null, 'АО')).toEqual({ kind: 'reuse', id: 5, provisional: false });
    expect(decideExact([candidate({ id: 6, legal_form: 'ООО' })], null, 'АО')).toMatchObject({ kind: 'create', queueWith: [6] });
  });

  it('вид сущности берётся из текста: ГК — группа, форма или реквизит — юрлицо, иначе неизвестно', () => {
    expect(inferEntityType('ГК', false)).toBe('group');
    expect(inferEntityType('ООО', false)).toBe('legal_entity');
    expect(inferEntityType(null, true)).toBe('legal_entity');
    expect(inferEntityType(null, false)).toBe('unknown');
  });
});

describe('decideProjectExact — география (TC-037)', () => {
  const rows = [
    { id: 1, city: 'Москва' },
    { id: 2, city: 'Казань' },
  ];

  it('одинаковый ЖК в двух городах — выбирается только совпавший город', () => {
    expect(decideProjectExact(rows, 'москва')).toEqual({ kind: 'reuse', id: 1 });
    expect(decideProjectExact(rows, 'Самара')).toEqual({ kind: 'create', queueWith: [] });
  });

  it('неизвестный город не равен известному; стабильная запись без города переиспользуется', () => {
    expect(decideProjectExact(rows, null)).toEqual({ kind: 'create', queueWith: [1, 2] });
    expect(decideProjectExact([...rows, { id: 3, city: null }], null)).toEqual({ kind: 'reuse', id: 3 });
    expect(decideProjectExact([{ id: 3, city: null }, { id: 4, city: null }], null)).toEqual({ kind: 'ambiguous', candidateIds: [3, 4] });
  });

  it('известный город не подставляется в запись без города', () => {
    expect(decideProjectExact([{ id: 3, city: null }], 'Москва')).toEqual({ kind: 'create', queueWith: [3] });
  });

  it('общий участник — пояснение, а не балл', () => {
    const base = { id: 1, name: 'x', city: 'Москва', s_latin: 0.9, s_norm: 0.9, shared_participants: 0 };
    const withShared = scoreProjectCandidate({ ...base, shared_participants: 3 }, { city: 'Москва' });
    const without = scoreProjectCandidate(base, { city: 'Москва' });
    expect(withShared.score).toBe(without.score);
    expect(withShared.reasons.shared_participants).toBe(3);
  });
});

describe('parseProjectPath — корпуса и очереди (TC-038)', () => {
  it('два корпуса одного ЖК — один комплекс, разные обозначения', () => {
    const a = parseProjectPath('ЖК «Берег», корпус 3');
    const b = parseProjectPath('ЖК «Берег» корп. 4');
    expect(a.complex).toBe('ЖК «Берег»');
    expect(b.complex).toBe('ЖК «Берег»');
    expect([a.building, b.building]).toEqual(['3', '4']);
  });

  it('очередь и корпус вместе; порядковая форма', () => {
    expect(parseProjectPath('ЖК «Лес», 2-я очередь, корпус 5')).toEqual({ complex: 'ЖК «Лес»', phase: '2', building: '5' });
    expect(parseProjectPath('ЖК «Сосны» 3-й корпус')).toEqual({ complex: 'ЖК «Сосны»', phase: null, building: '3' });
    expect(parseProjectPath('ЖК «Лес» (очередь 1)')).toEqual({ complex: 'ЖК «Лес»', phase: '1', building: null });
  });

  it('названия, похожие на уровни, не разбираются', () => {
    for (const name of ['ЖК Дом на Набережной', 'Квартал 5 корпус', 'Дом 7', 'ЖК «Корпусной»', 'ЖК Очередной дом']) {
      expect(parseProjectPath(name)).toEqual({ complex: name, phase: null, building: null });
    }
  });
});
