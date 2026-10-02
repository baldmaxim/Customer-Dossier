// Наименование ЕГРЮЛ из ответа req (ADR-016). Фикстуры — по известной структуре API, не живой ответ
// (см. map.test.ts): тест проверяет логику, а не имена полей живого Фокуса.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFocusItems } from './client.js';
import { egrulNamesOf, placeholderName } from './identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): Record<string, unknown> => {
  const items = parseFocusItems(fs.readFileSync(path.join(HERE, '__fixtures__', name), 'utf8'));
  if (!items || !items[0]) throw new Error(`фикстура ${name} не разобралась`);
  return items[0].payload;
};

describe('egrulNamesOf', () => {
  it('юрлицо: краткое и полное наименование', () => {
    expect(egrulNamesOf(fixture('req-ul.json'))).toEqual({
      short: 'ООО "ТЕСТСТРОЙ"',
      full: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ТЕСТСТРОЙ"',
    });
  });

  it('предприниматель: «ИП» и ФИО, полного наименования нет', () => {
    expect(egrulNamesOf(fixture('req-ip.json'))).toEqual({ short: 'ИП Сидоров Сидор Сидорович', full: null });
  });

  it('ответ без сведений — имён нет, а не «undefined»', () => {
    expect(egrulNamesOf({ inn: '7707083893' })).toEqual({ short: null, full: null });
  });
});

describe('placeholderName', () => {
  it('временное имя карточки по реквизиту', () => {
    expect(placeholderName({ type: 'inn', value: '7707083893' })).toBe('ИНН 7707083893');
    expect(placeholderName({ type: 'ogrn', value: '1027700132195' })).toBe('ОГРН 1027700132195');
  });
});
