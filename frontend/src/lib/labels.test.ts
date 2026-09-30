// Числа и деньги — по-русски; права снятых разделов на экран не идут; одна роль и одна стадия
// объекта называются одинаково во всех словарях.
import { describe, expect, it } from 'vitest';

import {
  ASSERTION_ROLE_LABELS,
  CONTEXT_STATE_LABELS,
  HIDDEN_PERMISSIONS,
  ROLE_LABELS,
  STAGE_LABELS,
  formatMoney,
  formatPercent,
  visiblePermissions,
} from './labels';

/** Intl ставит неразрывные пробелы; для сравнения достаточно обычных. */
const plain = (s: string): string => s.replace(/\s/g, ' ');

describe('деньги и числа', () => {
  it('сумма — порядком и с запятой: «38,1 млн ₽»', () => {
    expect(plain(formatMoney(38_100_000))).toBe('38,1 млн ₽');
    expect(plain(formatMoney(1_200_000_000))).toBe('1,2 млрд ₽');
    expect(plain(formatMoney(38_000_000))).toBe('38 млн ₽');
    expect(plain(formatMoney(950_000))).toBe('950 000 ₽');
  });

  it('округление не даёт «1000 млн»: это уже миллиард', () => {
    expect(plain(formatMoney(999_960_000))).toBe('1 млрд ₽');
  });

  it('строка с сервера, чужая и неизвестная валюта — рубль не подставляется', () => {
    expect(plain(formatMoney('38100000.00'))).toBe('38,1 млн ₽');
    expect(plain(formatMoney(2_500_000, 'USD'))).toBe('2,5 млн $');
    expect(plain(formatMoney(2_500_000, null))).toBe('2,5 млн (валюта не указана)');
    expect(formatMoney('не число')).toBe('—');
  });

  it('доля — «83 %»; неизвестное — прочерк, а не ноль', () => {
    expect(plain(formatPercent(0.83))).toBe('83 %');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('словари', () => {
  it('права снятых обращений и снимков на экран не идут, порядок остальных прежний', () => {
    expect(visiblePermissions(['portal.read', 'dossier.view', 'admin.view', 'dossier.manage'])).toEqual(['portal.read', 'admin.view']);
    expect([...HIDDEN_PERMISSIONS].every(p => p.startsWith('dossier.'))).toBe(true);
  });

  it('роль и стадия объекта названы одинаково во всех словарях', () => {
    for (const [role, word] of Object.entries(ROLE_LABELS)) expect(ASSERTION_ROLE_LABELS[role]).toBe(word);
    for (const [state, word] of Object.entries(CONTEXT_STATE_LABELS)) expect(STAGE_LABELS[state]).toBe(word);
  });
});
