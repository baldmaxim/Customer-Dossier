// Этап 20A без БД и сети: профиль реестра, карта полей, рендер текста снимка.

import { describe, it, expect } from 'vitest';

import { sourceProfileMetaSchema } from '../profileMeta.js';
import { availablePaths, formatValue, mapRecord, readPath, toIsoDate } from './map.js';
import { RegistryProfileError, buildUrl, isRegistryConfig, parseRegistryProfile, policyForRegistryProfile } from './profile.js';
import { REGISTRY_RENDER_VERSION, renderRecord } from './render.js';

const profile = (over: Record<string, unknown> = {}) =>
  parseRegistryProfile({
    mode: 'registry_api',
    endpoints: { object: 'https://registry-demo.test/api/object?id={id}' },
    objectIds: ['62087'],
    identity: {
      object: {
        idPath: 'objId',
        namePath: 'objCommercNm',
        cityPath: 'city',
        addressPath: 'objAddr',
        developerNamePath: 'developer.shortName',
        developerFormPath: 'developer.orgForm.shortForm',
        developerInnPath: 'developer.devInn',
        groupNamePath: 'groupName',
      },
    },
    fields: {
      object: [
        { label: 'Класс недвижимости', path: 'objClass' },
        { label: 'Срок сдачи', path: 'objReadyDt', format: 'date' },
        { label: 'Количество этажей', path: 'objFloorMax', format: 'number' },
        { label: 'Средняя цена за м2', path: 'objPriceAvg', format: 'money', unit: 'руб.' },
      ],
    },
    limits: { delayMs: 0 },
    ...over,
  });

const answer = (over: Record<string, unknown> = {}) => ({
  objId: 62087,
  objCommercNm: 'Большая Татарская 35',
  city: 'Москва',
  objAddr: 'Москва город, Район Замоскворечье',
  groupName: 'Донстрой',
  developer: { shortName: 'СЗ ПРАКТИКА', devInn: '7704412966', orgForm: { shortForm: 'ООО' } },
  objClass: 'Элитный',
  objReadyDt: '2028-09-30',
  objFloorMax: 26,
  objPriceAvg: 1554843,
  ...over,
});

describe('профиль реестра (T20A-01)', () => {
  it('неизвестные ключи, чужие схемы и пути с кодом отвергаются', () => {
    expect(() => profile({ approved: true })).toThrow(RegistryProfileError);
    expect(() => profile({ endpoints: { object: 'file:///etc/passwd?id={id}' } })).toThrow(/только http/);
    expect(() => profile({ endpoints: { object: 'https://registry-demo.test/api/object' } })).toThrow(/\{id\}/);
    expect(() => profile({ identity: { object: { idPath: 'a()', namePath: 'b' } } })).toThrow(/путь вида/);
  });

  it('профилю нужна работа: без objectIds, developerIds и list он отвергается', () => {
    expect(() => profile({ objectIds: [] })).toThrow(/нечего собирать/);
    expect(() => profile({ objectIds: [], list: { itemsPath: 'data', idPath: 'objId' } })).toThrow(/endpoints.list/);
    expect(() => profile({ developerIds: ['77'] })).toThrow(/endpoints.developer/);
  });

  it('режим определяется профилем, а не видом источника', () => {
    expect(isRegistryConfig({ mode: 'registry_api' })).toBe(true);
    expect(isRegistryConfig({ mode: 'html_list' })).toBe(false);
  });

  it('троттлинг по умолчанию — один запрос в 4 секунды', () => {
    expect(parseRegistryProfile({ ...JSON.parse(JSON.stringify(profile())), limits: undefined }).limits.delayMs).toBe(4000);
  });

  it('подстановки кодируются, allowlist берёт хосты эндпоинтов', () => {
    expect(buildUrl('https://h.test/api?id={id}&offset={offset}', { id: 'a b', offset: 20 })).toBe('https://h.test/api?id=a%20b&offset=20');
    const policy = policyForRegistryProfile('https://registry-demo.test', profile());
    expect(policy.allowedHosts).toContain('registry-demo.test');
  });

  it('кириллический домен попадает в allowlist в punycode', () => {
    const policy = policyForRegistryProfile('https://наш.дом.рф', profile());
    expect(policy.allowedHosts).toContain('xn--80az8a.xn--d1aqf.xn--p1ai');
    // Тот же хост оператор вправе записать и в meta.allowedOrigins.
    expect(sourceProfileMetaSchema.parse({ allowedOrigins: ['xn--80az8a.xn--d1aqf.xn--p1ai'] }).allowedOrigins).toHaveLength(1);
  });
});

describe('карта полей (T20A-02)', () => {
  it('путь читает вложенные объекты и элементы массивов', () => {
    expect(readPath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(readPath({ a: null }, 'a.b')).toBeUndefined();
    expect(readPath({ a: 'строка' }, 'a.b')).toBeUndefined();
  });

  it('значения форматируются, но не пересчитываются', () => {
    expect(formatValue(1554843, { label: 'ц', path: 'p', format: 'money', unit: 'руб.' })).toBe('1 554 843 руб.');
    expect(formatValue('2028-09-30', { label: 'д', path: 'p', format: 'date' })).toBe('30.09.2028');
    expect(formatValue(29, { label: 'п', path: 'p', format: 'percent' })).toBe('29%');
    expect(formatValue(true, { label: 'б', path: 'p', format: 'bool' })).toBe('да');
    // Дата, которую реестр отдал в непонятном виде, остаётся как есть — догадок нет.
    expect(formatValue('I кв. 2028', { label: 'д', path: 'p', format: 'date' })).toBe('I кв. 2028');
    expect(toIsoDate('30.09.2028')).toBe('2028-09-30');
    expect(toIsoDate('когда-нибудь')).toBeNull();
  });

  it('отсутствующее поле пропускается, а не становится «не указано»', () => {
    const record = mapRecord(answer({ objClass: null, objPriceAvg: undefined }), profile(), 'object');
    expect(record?.fields.map(f => f.label)).toEqual(['Срок сдачи', 'Количество этажей']);
  });

  it('без идентификатора или названия записи нет', () => {
    expect(mapRecord(answer({ objId: null }), profile(), 'object')).toBeNull();
    expect(mapRecord(answer({ objCommercNm: '  ' }), profile(), 'object')).toBeNull();
    expect(mapRecord('не объект', profile(), 'object')).toBeNull();
  });

  it('пути ответа подсказывают карту полей: имена ключей, без значений', () => {
    const paths = availablePaths(answer());
    expect(paths).toContain('objId');
    expect(paths).toContain('developer.devInn');
    expect(paths).toContain('developer.orgForm.shortForm');
    // Значения в подсказку не попадают — только пути.
    expect(paths.join(' ')).not.toContain('7704412966');
  });

  it('массив описывается по первому элементу, глубина и число путей ограничены', () => {
    expect(availablePaths({ list: [{ id: 1 }, { id: 2 }] })).toEqual(['list.0.id']);
    expect(availablePaths({ a: { b: { c: { d: { e: 1 } } } } })).toEqual([]);
    expect(availablePaths({ a: 1, b: 2, c: 3 }, 2)).toHaveLength(2);
  });

  it('карточка застройщика требует своей identity', () => {
    expect(mapRecord(answer(), profile(), 'developer')).toBeNull();
  });
});

describe('текст снимка registry-render@1 (T20A-03)', () => {
  const record = () => mapRecord(answer(), profile(), 'object')!;

  it('одни и те же данные дают побайтово одинаковый текст', () => {
    expect(renderRecord(record())).toBe(renderRecord(record()));
    expect(REGISTRY_RENDER_VERSION).toBe('registry-render@1');
  });

  it('в тексте нет ничего изменчивого извне реестра: иначе каждый сбор — «новая редакция»', () => {
    const body = renderRecord(record());
    expect(body).not.toMatch(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/);
    expect(body).not.toContain(String(new Date().getFullYear()) + '-');
    // Дата сведений появляется только если её сообщил сам реестр.
    expect(body).not.toContain('Сведения реестра на');
    const withAsOf = mapRecord(answer({ asOf: '2026-09-21' }), profile({ identity: { object: { idPath: 'objId', namePath: 'objCommercNm', asOfPath: 'asOf' } } }), 'object')!;
    expect(renderRecord(withAsOf)).toContain('Сведения реестра на 21.09.2026');
  });

  it('связь застройщика — одной строкой с обеими сторонами и реквизитом', () => {
    const line = renderRecord(record())
      .split('\n')
      .find(l => l.startsWith('Застройщик объекта'));
    expect(line).toBe('Застройщик объекта «Большая Татарская 35» — ООО СЗ ПРАКТИКА, ИНН 7704412966.');
    expect(line).toContain('Большая Татарская 35');
    expect(line).toContain('ООО СЗ ПРАКТИКА');
  });

  it('группа компаний — отдельная связь, а не поле объекта', () => {
    expect(renderRecord(record())).toContain('Застройщик ООО СЗ ПРАКТИКА входит в группу компаний «Донстрой».');
  });

  it('поля идут в порядке профиля и с его подписями', () => {
    const body = renderRecord(record());
    expect(body.endsWith('Класс недвижимости: Элитный\nСрок сдачи: 30.09.2028\nКоличество этажей: 26\nСредняя цена за м2: 1 554 843 руб.')).toBe(true);
  });
});
