// Адрес сайта и приём предложений модели без сети (этап 25A): адрес принимается, только если его хост был
// в выдаче поиска; справочники, соцсети и СМИ сайтом компании не считаются.

import { describe, expect, it } from 'vitest';

import { acceptCandidates, isNotCompanySite, normalizeSiteUrl } from './url.js';

describe('адрес сайта компании', () => {
  it('origin без пути; без схемы — https; www. — только в адресе, не в ключе', () => {
    expect(normalizeSiteUrl('https://WWW.Donstroy.Moscow/about/?a=1#x')).toEqual({ host: 'donstroy.moscow', url: 'https://www.donstroy.moscow/' });
    expect(normalizeSiteUrl('donstroy.ru')).toEqual({ host: 'donstroy.ru', url: 'https://donstroy.ru/' });
    expect(normalizeSiteUrl('http://msk.example.ru')).toEqual({ host: 'msk.example.ru', url: 'http://msk.example.ru/' });
  });

  it('кириллический домен — в punycode', () => {
    expect(normalizeSiteUrl('https://донстрой.рф/')?.host).toMatch(/^xn--.+\.xn--p1ai$/);
  });

  it('не адрес сайта: IP, порт, логин, другая схема, без точки, пробелы', () => {
    for (const raw of ['http://127.0.0.1/', 'https://[::1]/', 'https://example.ru:8443/', 'https://u:p@example.ru/', 'ftp://example.ru/', 'localhost', 'https://www.ru/x', 'a b.ru', '', 'https://example.123/']) {
      expect(normalizeSiteUrl(raw), raw).toBeNull();
    }
  });

  it('справочники, агрегаторы, соцсети, СМИ и госсайты — не сайт компании (с поддоменами)', () => {
    for (const host of ['rusprofile.ru', 'companies.rbc.ru', 'vk.com', 't.me', 'cian.ru', 'xn--80az8a.xn--d1aqf.xn--p1ai', 'minstroy.gov.ru', 'hh.ru', 'kutuzovgrad-ii.novopoisk.msk.ru', 'kvmeter.ru']) {
      expect(isNotCompanySite(host), host).toBe(true);
    }
    expect(isNotCompanySite('donstroy.moscow')).toBe(false);
    expect(isNotCompanySite('notvk.com')).toBe(false);
  });
});

describe('приём предложений модели', () => {
  const citations = [
    { url: 'https://msk.donstroy.moscow/kontakty', title: 'Контакты — Донстрой', content: 'ИНН 7704123456' },
    { url: 'https://www.rusprofile.ru/id/1', title: 'Донстрой — Rusprofile', content: null },
  ];

  it('хост из выдачи или его корень — принят, с заголовком и фрагментом страницы', () => {
    const r = acceptCandidates([{ url: 'https://donstroy.moscow', reason: 'корень сайта из выдачи' }], citations);
    expect(r.accepted).toEqual([
      { host: 'donstroy.moscow', url: 'https://donstroy.moscow/', reason: 'корень сайта из выдачи', title: 'Контакты — Донстрой', snippet: 'ИНН 7704123456' },
    ]);
    expect(r.citationHosts).toEqual(['msk.donstroy.moscow', 'rusprofile.ru']);
  });

  it('выдуманный адрес, поддомен вне выдачи, справочник, мусор и повтор — отброшены с причиной', () => {
    const r = acceptCandidates(
      [
        { url: 'https://donstroy-invest.ru', reason: 'похоже' },
        { url: 'https://spb.msk.donstroy.moscow', reason: 'поддомен' },
        { url: 'https://rusprofile.ru/id/1', reason: 'реквизиты' },
        { url: 'не адрес', reason: '?' },
        { url: 'https://msk.donstroy.moscow/', reason: 'контакты' },
        { url: 'https://msk.donstroy.moscow/about', reason: 'повтор' },
      ],
      citations,
    );
    expect(r.accepted.map(a => a.host)).toEqual(['msk.donstroy.moscow']);
    expect(r.rejected.map(x => x.why)).toEqual(['not_in_search_results', 'not_in_search_results', 'not_company_site', 'bad_url', 'duplicate']);
  });

  it('поиск ничего не вернул — не принят ни один адрес', () => {
    expect(acceptCandidates([{ url: 'https://donstroy.moscow', reason: 'знаю и так' }], []).accepted).toEqual([]);
  });
});
