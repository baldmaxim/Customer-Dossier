// Заведение компании по реквизиту (ADR-016): какой реквизит принимается и по какому спрашивается Фокус.

import { describe, expect, it } from 'vitest';

import { focusTargetOf, parseRegistrationIdentifier } from './register.js';

describe('parseRegistrationIdentifier', () => {
  it('ИНН юрлица и ИП, ОГРН и ОГРНИП с верной контрольной суммой — принимаются', () => {
    expect(parseRegistrationIdentifier('7707083893')).toMatchObject({ ok: true, identifier: { identifierType: 'inn', value: '7707083893' } });
    expect(parseRegistrationIdentifier(' 7707 083-893 ')).toMatchObject({ ok: true, identifier: { value: '7707083893' } });
    expect(parseRegistrationIdentifier('500100732259')).toMatchObject({ ok: true, identifier: { identifierType: 'inn' } });
    expect(parseRegistrationIdentifier('1027700132195')).toMatchObject({ ok: true, identifier: { identifierType: 'ogrn' } });
  });

  it('опечатка в цифрах — отказ по контрольной сумме, а не новая компания', () => {
    expect(parseRegistrationIdentifier('7707083894')).toEqual({ ok: false, reason: 'bad_checksum' });
    expect(parseRegistrationIdentifier('1027700132196')).toEqual({ ok: false, reason: 'bad_checksum' });
  });

  it('не реквизит — отказ по формату', () => {
    expect(parseRegistrationIdentifier('12345')).toEqual({ ok: false, reason: 'bad_format' });
    expect(parseRegistrationIdentifier('77070838931')).toEqual({ ok: false, reason: 'bad_format' });
    expect(parseRegistrationIdentifier('ООО Ромашка')).toEqual({ ok: false, reason: 'bad_format' });
  });
});

describe('focusTargetOf', () => {
  it('ИНН — по ИНН, ОГРН и ОГРНИП — по ОГРН', () => {
    const inn = parseRegistrationIdentifier('7707083893');
    const ogrn = parseRegistrationIdentifier('1027700132195');
    if (!inn.ok || !ogrn.ok) throw new Error('реквизиты теста не разобрались');
    expect(focusTargetOf(inn.identifier)).toEqual({ type: 'inn', value: '7707083893' });
    expect(focusTargetOf(ogrn.identifier)).toEqual({ type: 'ogrn', value: '1027700132195' });
  });
});
