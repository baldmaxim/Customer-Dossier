// ВНИМАНИЕ: фикстуры __fixtures__/*.json написаны по известной структуре ответов API Контур.Фокуса,
// а не скачаны с живого API (ключа у агента нет), реквизиты в них вымышленные. Тесты проверяют
// логику карты, но НЕ подтверждают, что имена полей совпадают с живым ответом. Перед включением
// сверьтесь с живым ответом:  npm run focus -- --probe <ИНН>  (печатает имена полей и строки карточки).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFocusItems } from './client.js';
import {
  availablePaths,
  diffFields,
  focusHrefOf,
  formatAddress,
  FOUNDERS_SHOWN,
  mapEgrDetails,
  mapReq,
  orderFields,
  ruDate,
  summaryOf,
} from './map.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Record<string, unknown> => {
  const items = parseFocusItems(fs.readFileSync(path.join(HERE, '__fixtures__', name), 'utf8'));
  if (!items || !items[0]) throw new Error(`фикстура ${name} не разобралась`);
  return items[0].payload;
};

describe('focus-map@1: req', () => {
  it('юрлицо: наименование, статус, руководитель с даты, адрес, коды', () => {
    const fields = mapReq(fixture('req-ul.json'));
    const byKey = Object.fromEntries(fields.map(f => [f.key, f.value]));
    expect(byKey).toMatchObject({
      name: 'ООО "ТЕСТСТРОЙ"',
      fullName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ТЕСТСТРОЙ"',
      status: 'Действующее',
      registrationDate: '15.08.2002',
      address: '101000, г Москва, ул Мясницкая, д 1, офис 5',
      heads: 'Иванов Иван Иванович — Генеральный директор, с 01.04.2021',
      opf: 'Общество с ограниченной ответственностью',
      kpp: '770101001',
      okpo: '12345678',
    });
    // Пустой список управляющих компаний — не строка «нет данных».
    expect(byKey.managementCompanies).toBeUndefined();
    // ИНН физлица руководителя на экран не идёт.
    expect(fields.some(f => f.value.includes('770100000000'))).toBe(false);
  });

  it('сводные оценки Фокуса (экспресс-отчёт) в строки не попадают — светофора нет (ADR-009)', () => {
    const fields = mapReq(fixture('req-ul.json'));
    expect(fields.some(f => /green|red|yellow|зелён|красн/i.test(`${f.key} ${f.label} ${f.value}`))).toBe(false);
  });

  it('предприниматель: ФИО, прекращение деятельности с датой', () => {
    const byKey = Object.fromEntries(mapReq(fixture('req-ip.json')).map(f => [f.key, f.value]));
    expect(byKey).toMatchObject({
      fio: 'Сидоров Сидор Сидорович',
      status: 'Индивидуальный предприниматель прекратил деятельность (с 31.12.2020)',
      dissolutionDate: '31.12.2020',
    });
  });

  it('статус без строки — словами по признакам; без статуса — поля нет', () => {
    expect(mapReq({ UL: { status: { dissolving: true } } })).toEqual([{ key: 'status', label: 'Статус', value: 'В стадии ликвидации' }]);
    expect(mapReq({ UL: { status: { dissolved: true, date: '2024-05-06' } } })[0]?.value).toBe('Прекратило деятельность (с 06.05.2024)');
    expect(mapReq({ UL: {} })).toEqual([]);
    expect(mapReq({})).toEqual([]);
  });
});

describe('focus-map@1: egrDetails', () => {
  it('основной вид деятельности, капитал, учредители с долями', () => {
    const byKey = Object.fromEntries(mapEgrDetails(fixture('egrDetails-ul.json')).map(f => [f.key, f.value]));
    expect(byKey).toEqual({
      activity: '41.20 Строительство жилых и нежилых зданий',
      capital: '10 000 ₽',
      founders: 'Иванов Иван Иванович — 51%; Петров Пётр Петрович — 49%',
    });
  });

  it('учредителей больше десяти — перечислены первые, остальные числом; юрлицо — с ИНН', () => {
    const many = Array.from({ length: FOUNDERS_SHOWN + 3 }, (_, i) => ({ fio: `Учредитель ${i + 1}` }));
    const value = mapEgrDetails({ UL: { foundersFL: many, foundersUL: [{ fullName: 'АО "ХОЛДИНГ"', inn: '7702000002', share: { percentagePlain: 10 } }] } })[0]!.value;
    expect(value.startsWith('Учредитель 1; Учредитель 2')).toBe(true);
    expect(value.endsWith('; и ещё 4')).toBe(true);
    expect(mapEgrDetails({ UL: { foundersUL: [{ fullName: 'АО "ХОЛДИНГ"', inn: '7702000002', share: { percentagePlain: 10 } }] } })[0]).toEqual({
      key: 'founders',
      label: 'Учредители',
      value: 'АО "ХОЛДИНГ", ИНН 7702000002 — 10%',
    });
  });
});

describe('карточка, ссылка, разница', () => {
  it('порядок строк: наименование, статус, руководитель, адрес, деятельность… коды в конце', () => {
    const fields = orderFields([...mapReq(fixture('req-ul.json')), ...mapEgrDetails(fixture('egrDetails-ul.json'))]);
    expect(fields.map(f => f.key)).toEqual([
      'name',
      'fullName',
      'status',
      'heads',
      'address',
      'activity',
      'registrationDate',
      'capital',
      'founders',
      'opf',
      'kpp',
      'okpo',
    ]);
    expect(summaryOf(fields)).toEqual({
      status: 'Действующее',
      head: 'Иванов Иван Иванович — Генеральный директор, с 01.04.2021',
      address: '101000, г Москва, ул Мясницкая, д 1, офис 5',
    });
  });

  it('ссылка на Фокус — только https://focus.kontur.ru', () => {
    expect(focusHrefOf(fixture('req-ul.json'))).toBe('https://focus.kontur.ru/entity?query=1027700000001');
    expect(focusHrefOf({ focusHref: 'javascript:alert(1)' })).toBeNull();
    expect(focusHrefOf({ focusHref: 'https://evil.example/entity' })).toBeNull();
    expect(focusHrefOf({ focusHref: 'http://focus.kontur.ru/entity' })).toBeNull();
  });

  it('разница: смена руководителя, новое поле, исчезнувшее поле', () => {
    const before = [
      { key: 'heads', label: 'Руководитель', value: 'Иванов И. И.' },
      { key: 'kpp', label: 'КПП', value: '770101001' },
    ];
    const after = [
      { key: 'heads', label: 'Руководитель', value: 'Петров П. П.' },
      { key: 'status', label: 'Статус', value: 'В стадии ликвидации' },
    ];
    expect(diffFields(before, after)).toEqual([
      { label: 'Руководитель', from: 'Иванов И. И.', to: 'Петров П. П.' },
      { label: 'Статус', from: null, to: 'В стадии ликвидации' },
      { label: 'КПП', from: '770101001', to: null },
    ]);
    expect(diffFields(after, after)).toEqual([]);
  });

  it('адрес: регион «обл» после названия, «Респ» и «г» — перед; сырые номера дома; иностранный', () => {
    expect(
      formatAddress({
        parsedAddressRF: {
          zipCode: '620000',
          regionName: { topoShortName: 'обл', topoValue: 'Свердловская' },
          city: { topoShortName: 'г', topoValue: 'Екатеринбург' },
          street: { topoShortName: 'ул', topoValue: 'Ленина' },
          houseRaw: '5А',
        },
      }),
    ).toBe('620000, Свердловская обл, г Екатеринбург, ул Ленина, 5А');
    expect(formatAddress({ parsedAddressRF: { regionName: { topoShortName: 'Респ', topoValue: 'Татарстан' } } })).toBe('Респ Татарстан');
    expect(formatAddress({ foreignAddress: { countryName: 'Казахстан', addressString: 'Алматы, пр. Абая, 1' } })).toBe('Казахстан, Алматы, пр. Абая, 1');
    expect(formatAddress(null)).toBeNull();
  });

  it('даты: ISO → ДД.ММ.ГГГГ, прочее — как есть', () => {
    expect(ruDate('2020-01-31')).toBe('31.01.2020');
    expect(ruDate('2020-01-31T00:00:00')).toBe('31.01.2020');
    expect(ruDate('31.01.2020')).toBe('31.01.2020');
    expect(ruDate(null)).toBeNull();
  });

  it('пробе — имена полей без значений', () => {
    const paths = availablePaths(fixture('req-ul.json'));
    expect(paths).toContain('UL.legalName.short');
    expect(paths).toContain('UL.heads[].fio');
    expect(paths.some(p => p.includes('ТЕСТСТРОЙ') || p.includes('7701000001'))).toBe(false);
  });
});
