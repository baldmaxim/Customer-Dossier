// Разбор строк ДОМ.РФ: знакомые форматы — числом, всё остальное — null (не догадкой). Единственный разбор в портале
// (клиентская копия удалена 07.10.2026); перенос срока — одно правило для «Сроков и продаж», «Нового» и паспорта.

import { describe, expect, it } from 'vitest';

import { completionChange, parseCompletion, parseCount, parsePercent, parseRubles, parseSoldCount } from './values.js';

describe('parseCount', () => {
  it('целое с разделителями разрядов', () => {
    expect(parseCount('472')).toBe(472);
    expect(parseCount('1 024')).toBe(1024);
    expect(parseCount('1 024')).toBe(1024);
    expect(parseCount(' 12 ')).toBe(12);
  });

  it('с единицей, приблизительное, пустое — null', () => {
    for (const raw of ['472 кв.', 'около 500', '', null, undefined, '12,5', '1 02']) expect(parseCount(raw)).toBeNull();
  });
});

describe('parsePercent и parseSoldCount', () => {
  it('проценты', () => {
    expect(parsePercent('45 %')).toBe(0.45);
    expect(parsePercent('45%')).toBe(0.45);
    expect(parsePercent('45,5 %')).toBeCloseTo(0.455);
    expect(parsePercent('0 %')).toBe(0);
  });

  it('больше 100 %, слова, число без знака — null', () => {
    for (const raw of ['145 %', 'почти всё', '45', '', '120 из 480']) expect(parsePercent(raw)).toBeNull();
  });

  it('«N квартир из M» — числом; часть больше целого — null', () => {
    expect(parseSoldCount('120 квартир из 472')).toEqual({ sold: 120, total: 472 });
    expect(parseSoldCount('1 квартира из 10')).toEqual({ sold: 1, total: 10 });
    expect(parseSoldCount('500 квартир из 480')).toBeNull();
    expect(parseSoldCount('45 %')).toBeNull();
  });
});

describe('parseRubles', () => {
  it('рубли со знаком и без', () => {
    expect(parseRubles('933 425 ₽')).toBe(933425);
    expect(parseRubles('1 554 843 руб.')).toBe(1554843);
    expect(parseRubles('180000 р.')).toBe(180000);
    expect(parseRubles('180 000')).toBe(180000);
  });

  it('«от», другая валюта, ноль — null', () => {
    for (const raw of ['от 300 000 ₽', '$100', '0 ₽', 'по запросу']) expect(parseRubles(raw)).toBeNull();
  });
});

describe('parseCompletion', () => {
  it('квартал римской и арабской цифрой, дата, год', () => {
    expect(parseCompletion('IV кв. 2027')).toEqual({ year: 2027, quarter: 4 });
    expect(parseCompletion('I кв. 2028')).toEqual({ year: 2028, quarter: 1 });
    expect(parseCompletion('4 квартал 2026')).toEqual({ year: 2026, quarter: 4 });
    expect(parseCompletion('30.09.2028')).toEqual({ year: 2028, quarter: 3 });
    expect(parseCompletion('2027 г.')).toEqual({ year: 2027, quarter: null });
    expect(parseCompletion('2027')).toEqual({ year: 2027, quarter: null });
  });

  it('«Сдан», неверный месяц, пусто — null', () => {
    for (const raw of ['Сдан', '31.13.2028', 'V кв. 2027', '', null]) expect(parseCompletion(raw)).toBeNull();
  });
});

describe('completionChange — перенос срока', () => {
  it('тот же квартал другим форматом, тот же текст или нет значения — не перенос', () => {
    expect(completionChange('31.03.2028', 'I кв. 2028')).toBeNull();
    expect(completionChange('IV кв. 2027', 'IV кв. 2027')).toBeNull();
    expect(completionChange(null, 'IV кв. 2027')).toBeNull();
    expect(completionChange('IV кв. 2027', '')).toBeNull();
  });

  it('направление по сроку; нераспознанная строка — unknown', () => {
    expect(completionChange('III кв. 2027', 'I кв. 2028')).toEqual({ direction: 'later' });
    expect(completionChange('I кв. 2028', '30.09.2027')).toEqual({ direction: 'earlier' });
    expect(completionChange('IV кв. 2027', 'уточняется')).toEqual({ direction: 'unknown' });
  });
});
