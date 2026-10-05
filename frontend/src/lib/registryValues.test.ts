// Разбор строк ДОМ.РФ: знакомые форматы — числом, всё остальное — null (не догадкой).

import { describe, expect, it } from 'vitest';

import { parseCompletion, parseCount, parsePercent, parseRubles } from './registryValues';

describe('parseCount', () => {
  it('целое с разделителями разрядов', () => {
    expect(parseCount('472')).toBe(472);
    expect(parseCount('1 024')).toBe(1024);
    expect(parseCount('1 024')).toBe(1024);
    expect(parseCount(' 12 ')).toBe(12);
  });

  it('с единицей, приблизительное, пустое — null', () => {
    for (const raw of ['472 кв.', 'около 500', '', null, undefined, '12,5', '1 02']) expect(parseCount(raw)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('проценты и «N из M»', () => {
    expect(parsePercent('45 %')).toBe(0.45);
    expect(parsePercent('45%')).toBe(0.45);
    expect(parsePercent('45,5 %')).toBeCloseTo(0.455);
    expect(parsePercent('0 %')).toBe(0);
    expect(parsePercent('120 из 480')).toBe(0.25);
  });

  it('больше 100 %, часть больше целого, слова — null', () => {
    for (const raw of ['145 %', '500 из 480', 'почти всё', '45', '']) expect(parsePercent(raw)).toBeNull();
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
