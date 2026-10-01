// Этап 20D, шаг 2: поиск компаний в реестре застройщиков — адрес поиска, разбор выдачи, совпадение
// по названию, ссылка оператора.

import { describe, expect, it } from 'vitest';

import {
  DomRfCompanyError,
  domRfSearchUrl,
  matchesByName,
  nameCore,
  parseDomRfCardUrl,
  parseDomRfSearchCapture,
  tooGenericToSearch,
} from './domrfCompanies.js';

const HOST = 'https://xn--80az8a.xn--d1aqf.xn--p1ai';

describe('поиск в реестре застройщиков', () => {
  it('строка поиска — параметр search на странице реестра; ИНН и название кодируются', () => {
    expect(domRfSearchUrl('7700001235')).toBe(`${HOST}/${encodeURI('сервисы/единый-реестр-застройщиков')}?search=7700001235`);
    const url = new URL(domRfSearchUrl('Демо «Строй» & Ко'));
    expect(url.searchParams.get('search')).toBe('Демо «Строй» & Ко');
  });

  it('выдача — застройщики и группы по порядку; чужой адрес не принимается', () => {
    const search = parseDomRfSearchCapture({
      format: 'domrf-search-browser@1',
      url: domRfSearchUrl('Демо'),
      results: [
        { kind: 'group', ref: '55', name: 'ДЕМО-ГРУППА' },
        { kind: 'developer', ref: '901', name: 'ООО СЗ ДЕМО-ПРАКТИКА' },
      ],
    });
    expect(search.results.map(r => `${r.kind}:${r.ref}`)).toEqual(['group:55', 'developer:901']);
    expect(() => parseDomRfSearchCapture({ format: 'domrf-search-browser@1', url: 'https://example.com/?search=x', results: [] })).toThrow(/наш.дом.рф/);
    expect(() =>
      parseDomRfSearchCapture({ format: 'domrf-search-browser@1', url: domRfSearchUrl('x'), results: [{ kind: 'object', ref: '1', name: null }] }),
    ).toThrow();
  });

  it('ссылка оператора — страница застройщика или группы на наш.дом.рф, иначе понятный отказ', () => {
    expect(parseDomRfCardUrl(`${HOST}/${encodeURI('сервисы/единый-реестр-застройщиков/застройщик/14929')}`)).toEqual({ kind: 'developer', externalRef: '14929' });
    expect(parseDomRfCardUrl(`${HOST}/сервисы/единый-реестр-застройщиков/группа-компаний/5661/`)).toEqual({ kind: 'group', externalRef: '5661' });
    for (const bad of ['не ссылка', 'http://xn--80az8a.xn--d1aqf.xn--p1ai/x', `${HOST}/сервисы/каталог-новостроек/объект/62087`]) {
      expect(() => parseDomRfCardUrl(bad), bad).toThrow(DomRfCompanyError);
    }
  });

  it('ядро названия — без формы, кавычек и общих слов; кириллица и латиница сводятся', () => {
    expect(nameCore('ООО «СЗ «ДОНСТРОЙ»')).toEqual(['donstroi']);
    expect(nameCore('Группа компаний «ДОНСТРОЙ»')).toEqual(['donstroi']);
    expect(nameCore('Специализированный застройщик Самолёт Девелопмент')).toEqual(['samolet', 'development']);
    expect(nameCore('МР ГРУПП')).toEqual(nameCore('MR Group'));
  });

  it('по названию предлагается только совпавшее: ядро одного целиком входит в ядро другого', () => {
    expect(matchesByName('Донстрой', 'ООО СЗ ДОНСТРОЙ')).toBe(true);
    expect(matchesByName('Донстрой', 'Группа компаний «ДОНСТРОЙ»')).toBe(true);
    expect(matchesByName('ГК «Самолёт»', 'ООО «СЗ «САМОЛЕТ ДЕВЕЛОПМЕНТ»')).toBe(true);
    expect(matchesByName('Донстрой Инвест', 'ДОНСТРОЙ')).toBe(true);
    expect(matchesByName('Донстрой', 'АО «СЗ «Новый ДОН»')).toBe(false);
    expect(matchesByName('Донстрой', 'ООО СЗ АГАТ')).toBe(false);
    expect(matchesByName('Донстрой', null)).toBe(false);
    expect(matchesByName('СЗ', 'ООО СЗ АГАТ')).toBe(false);
  });

  it('название из одних общих слов не ищется; короткий бренд — ищется', () => {
    expect(tooGenericToSearch('СЗ')).toBe(true);
    expect(tooGenericToSearch('Группа компаний')).toBe(true);
    expect(tooGenericToSearch('MR Group')).toBe(false);
    expect(tooGenericToSearch('ГК ПИК')).toBe(false);
  });
});
