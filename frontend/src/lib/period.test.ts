import { describe, expect, it } from 'vitest';

import { withLegalForm, shortenLegalForm } from './legalForm';
import { formatPeriod, formatPreciseDate } from './period';

describe('даты сведений с их точностью', () => {
  it('день, месяц, квартал и год — без выдуманного дня', () => {
    expect(formatPreciseDate('2024-03-01', 'day')).toBe('01.03.2024');
    expect(formatPreciseDate('2024-03-01', 'month')).toBe('03.2024');
    expect(formatPreciseDate('2024-08-01', 'quarter')).toBe('3 кв. 2024');
    expect(formatPreciseDate('2024-01-01', 'year')).toBe('2024');
    expect(formatPreciseDate(null)).toBe('');
  });

  it('период словами: с — по, открытый с одной стороны, пустой', () => {
    expect(formatPeriod('2024-03-01', '2025-12-31', 'day')).toBe('с 01.03.2024 по 31.12.2025');
    expect(formatPeriod('2024-03-01', null, 'month')).toBe('с 03.2024');
    expect(formatPeriod(null, '2025-12-31')).toBe('по 31.12.2025');
    expect(formatPeriod(null, null)).toBe('');
  });
});

describe('форма собственности в названии', () => {
  it('не повторяется: «ООО» перед «Общество с ограниченной ответственностью» не ставится', () => {
    expect(withLegalForm('Общество с ограниченной ответственностью «Ромашка»', 'ООО')).toBe('Общество с ограниченной ответственностью «Ромашка»');
    expect(withLegalForm('ООО «Ромашка»', 'ООО')).toBe('ООО «Ромашка»');
    expect(withLegalForm('ПАО «Сбербанк»', 'АО')).toBe('ПАО «Сбербанк»');
    expect(withLegalForm('СЗ ДЕМО-ПРАКТИКА', 'ООО')).toBe('ООО СЗ ДЕМО-ПРАКТИКА');
    expect(withLegalForm('Ромашка', null)).toBe('Ромашка');
  });

  it('сокращается для тесных мест', () => {
    expect(shortenLegalForm('Общество с ограниченной ответственностью Специализированный застройщик "Север"')).toBe('ООО СЗ "Север"');
    expect(shortenLegalForm('Акционерное общество «Мостотрест»')).toBe('АО «Мостотрест»');
    expect(shortenLegalForm('ООО «Ромашка»')).toBe('ООО «Ромашка»');
  });
});
