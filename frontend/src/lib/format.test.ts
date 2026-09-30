import { describe, expect, it } from 'vitest';

import { formatCount, formatCountWord, formatDuration, pluralize } from './format';

const FORMS = ['компания', 'компании', 'компаний'] as const;

describe('format', () => {
  it('разделитель тысяч — неразрывный пробел: число не рвётся и не читается как два', () => {
    expect(formatCount(24817)).toBe('24 817');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('—');
  });

  it('русские формы слова', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 111].map(n => pluralize(n, FORMS))).toEqual([
      'компания',
      'компании',
      'компаний',
      'компаний',
      'компания',
      'компании',
      'компаний',
      'компаний',
    ]);
    expect(formatCountWord(12334, FORMS)).toBe('12 334 компании');
  });

  it('длительность словами', () => {
    expect(formatDuration(800)).toBe('0,8 с');
    expect(formatDuration(42_000)).toBe('42 с');
    expect(formatDuration(185_000)).toBe('3 мин 5 с');
    expect(formatDuration(360_000)).toBe('6 мин');
    expect(formatDuration(4_320_000)).toBe('1 ч 12 мин');
    expect(formatDuration(null)).toBe('—');
  });
});
