// Реквизиты и география для точных совпадений (R01, R02) — без БД.

import { describe, it, expect } from 'vitest';

import { compareTaxIds, taxIdKind } from './normalize.js';
import { citiesKnownAndEqual } from './project.js';

describe('taxIdKind / compareTaxIds', () => {
  it('различает ИНН и ОГРН по длине', () => {
    expect(taxIdKind('7707083893')).toBe('inn');
    expect(taxIdKind('500100732259')).toBe('inn');
    expect(taxIdKind('1027700132239')).toBe('ogrn');
    expect(taxIdKind('304500116000157')).toBe('ogrn');
    expect(taxIdKind('12345')).toBeNull();
  });

  it('сравнивает только реквизиты одного вида', () => {
    expect(compareTaxIds('7707083893', '7707083893')).toBe('match');
    expect(compareTaxIds('7707083893', '7736050003')).toBe('conflict');
    expect(compareTaxIds('7707083893', '1027700132239')).toBe('different_kind');
    expect(compareTaxIds(null, '7707083893')).toBe('none');
  });
});

describe('citiesKnownAndEqual (R02)', () => {
  it('совпадение — только когда город известен у обоих', () => {
    expect(citiesKnownAndEqual('Москва', 'москва')).toBe(true);
    expect(citiesKnownAndEqual('Москва', 'Казань')).toBe(false);
    // Неизвестная география — не согласие: одноимённые ЖК не склеиваются вслепую.
    expect(citiesKnownAndEqual(null, 'Москва')).toBe(false);
    expect(citiesKnownAndEqual('Москва', null)).toBe(false);
    expect(citiesKnownAndEqual(null, null)).toBe(false);
  });
});
