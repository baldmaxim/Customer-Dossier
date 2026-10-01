// Этап 20D: страницы застройщика и группы ДОМ.РФ. Реквизиты — только верные; снимок застройщика —
// своя запись реестра; реквизиты в снимок объекта — только по ссылке самой карточки. Данные синтетические.

import { describe, expect, it } from 'vitest';

import { mapDomRfBrowserCapture } from './browserCapture.js';
import { developerIdentity, domRfCardUrl, domRfObjectUrl, mapDomRfDeveloperCapture, parseDomRfCardCapture } from './domrfCards.js';
import { renderRecord } from './render.js';

const INN = '7700001235';
const OGRN = '1027700000129';
const HOST = 'https://xn--80az8a.xn--d1aqf.xn--p1ai';

const developerCard = (over: Record<string, unknown> = {}) => ({
  format: 'domrf-card-browser@1',
  url: domRfCardUrl('developer', '901'),
  kind: 'developer',
  externalRef: '901',
  title: 'ООО СЗ ДЕМО-ПРАКТИКА',
  documentTitle: 'ООО СЗ ДЕМО-ПРАКТИКА',
  inn: INN,
  kpp: '770001001',
  ogrn: OGRN,
  legalAddress: 'город Москва, улица Демонстрационная, дом 1',
  groupRef: '55',
  groupName: 'ДЕМО-ГРУППА',
  objects: [
    { ref: '7001', status: 'Строится', name: 'Демо-квартал', place: 'г. Москва, Район Демо' },
    { ref: '7002', status: 'Строится', name: 'Демо-квартал', place: 'г. Москва, Район Демо' },
  ],
  ...over,
});

const objectCapture = (over: Record<string, unknown> = {}) => ({
  format: 'domrf-browser@1',
  url: domRfObjectUrl('7001'),
  title: '"Демо-квартал"',
  address: 'Москва город, улица Демонстрационная, дом 2',
  status: 'Строится',
  contractor: 'ООО «Демо-Строй»',
  developerRef: '901',
  groupRef: '55',
  developer: { name: 'СЗ ДЕМО-ПРАКТИКА', group: 'ДЕМО-ГРУППА' },
  characteristics: [{ label: 'Количество квартир', value: '120' }],
  ...over,
});

describe('страницы реестра застройщиков', () => {
  it('адреса страниц — на наш.дом.рф, вид и номер сверяются с адресом', () => {
    expect(domRfCardUrl('group', '55')).toBe(`${HOST}/${encodeURI('сервисы/единый-реестр-застройщиков/группа-компаний/55')}`);
    expect(domRfObjectUrl('7001')).toBe(`${HOST}/${encodeURI('сервисы/каталог-новостроек/объект/7001')}`);
    expect(parseDomRfCardCapture(developerCard()).objects).toHaveLength(2);
    expect(() => parseDomRfCardCapture(developerCard({ externalRef: '902' }))).toThrow(/не совпадает/);
    expect(() => parseDomRfCardCapture(developerCard({ url: 'https://example.com/застройщик/901' }))).toThrow(/наш.дом.рф/);
    expect(() => parseDomRfCardCapture(developerCard({ format: 'domrf-browser@1' }))).toThrow();
  });

  it('реквизиты — только с верной контрольной суммой; у группы застройщика нет', () => {
    expect(developerIdentity(parseDomRfCardCapture(developerCard()))).toEqual({
      externalRef: '901',
      name: 'ООО СЗ ДЕМО-ПРАКТИКА',
      inn: INN,
      ogrn: OGRN,
      groupName: 'ДЕМО-ГРУППА',
    });
    const typo = developerIdentity(parseDomRfCardCapture(developerCard({ inn: '7700001236' })));
    expect(typo).toMatchObject({ inn: null, ogrn: OGRN });
    expect(developerIdentity(parseDomRfCardCapture(developerCard({ inn: '123', ogrn: null })))).toBeNull();
    const group = parseDomRfCardCapture(
      developerCard({ kind: 'group', url: domRfCardUrl('group', '55'), externalRef: '55', title: 'Группа компаний', documentTitle: 'ДЕМО-ГРУППА' }),
    );
    expect(developerIdentity(group)).toBeNull();
  });

  it('снимок застройщика — запись реестра со строкой реквизитов и группой; список объектов в неё не входит', () => {
    const record = mapDomRfDeveloperCapture(developerCard());
    expect(record.type).toBe('developer');
    expect(record.payload.captureMethod).toBe('browser_page');
    const text = renderRecord(record);
    expect(text).toContain(`Реквизиты застройщика ООО СЗ ДЕМО-ПРАКТИКА: ИНН ${INN}, ОГРН ${OGRN}.`);
    expect(text).toContain('Застройщик ООО СЗ ДЕМО-ПРАКТИКА входит в группу компаний «ДЕМО-ГРУППА».');
    expect(text).not.toContain('7002');
    // Новый объект в списке застройщика не меняет его снимок: редакция не плодится.
    const more = mapDomRfDeveloperCapture(developerCard({ objects: [{ ref: '7003', status: null, name: null, place: null }] }));
    expect(more.payloadHash).toBe(record.payloadHash);
    expect(() => mapDomRfDeveloperCapture(developerCard({ inn: null, ogrn: null }))).toThrow(/реквизит|ИНН/);
  });
});

describe('снимок объекта и застройщик со своей страницы', () => {
  const identity = { externalRef: '901', name: 'ООО СЗ ДЕМО-ПРАКТИКА', inn: INN, ogrn: OGRN, groupName: 'ДЕМО-ГРУППА' };

  it('карточка ссылается на эту страницу застройщика — в снимке строка роли с реквизитами и номер страницы', () => {
    const record = mapDomRfBrowserCapture(objectCapture(), identity);
    expect(record.identity.developer).toEqual({ name: 'ООО СЗ ДЕМО-ПРАКТИКА', legalForm: null, inn: INN, ogrn: OGRN });
    expect(record.payload.developerCardRef).toBe('901');
    expect(renderRecord(record)).toContain(`Застройщик объекта «Демо-квартал» — ООО СЗ ДЕМО-ПРАКТИКА, ИНН ${INN}, ОГРН ${OGRN}.`);
  });

  it('ссылки нет или она ведёт на другого застройщика — реквизитов нет, снимок прежний', () => {
    const plain = mapDomRfBrowserCapture(objectCapture({ developerRef: undefined, groupRef: undefined }));
    expect(plain.identity.developer).toBeNull();
    expect(mapDomRfBrowserCapture(objectCapture({ developerRef: '902' }), identity).identity.developer).toBeNull();
    // Номера ссылок сами по себе в снимок не входят: прежние снимки не превращаются в новые редакции.
    expect(mapDomRfBrowserCapture(objectCapture(), null).payloadHash).toBe(plain.payloadHash);
  });
});
