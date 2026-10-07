// Числа и деньги — по-русски; права снятых разделов на экран не идут; одна роль и одна стадия
// объекта называются одинаково во всех словарях.
import { describe, expect, it } from 'vitest';

import {
  ASSERTION_ROLE_LABELS,
  AUTH_EVENT_LABELS,
  CONTEXT_STATE_LABELS,
  HIDDEN_PERMISSIONS,
  LOGIN_FAILURE_LABELS,
  LOGIN_REFUSAL_LABELS,
  formatMoney,
  formatPercent,
  visiblePermissions,
  roleLabel,
  actorLabel,
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
  it('журнал входа называет каждый вид события сервера и каждую причину отказа, включая заявки', () => {
    // Список — как AUTH_EVENTS в backend/src/auth/store.ts (и CHECK миграций 031, 033).
    const events = [
      'login_succeeded', 'login_failed', 'logout', 'password_changed', 'password_reset', 'user_created', 'user_updated',
      'user_disabled', 'user_enabled', 'session_revoked', 'registration_requested', 'registration_approved', 'registration_rejected',
    ];
    for (const e of events) expect(AUTH_EVENT_LABELS[e], e).toBeTruthy();
    for (const r of ['unknown_login', 'bad_password', 'locked', 'disabled', 'registration_pending', 'registration_rejected']) {
      expect(LOGIN_FAILURE_LABELS[r], r).toBeTruthy();
    }
    expect(Object.keys(LOGIN_REFUSAL_LABELS).sort()).toEqual(['registration_pending', 'registration_rejected']);
  });

  it('права снятых обращений и снимков на экран не идут, порядок остальных прежний', () => {
    expect(visiblePermissions(['portal.read', 'dossier.view', 'admin.view', 'dossier.manage'])).toEqual(['portal.read', 'admin.view']);
    expect([...HIDDEN_PERMISSIONS].every(p => p.startsWith('dossier.'))).toBe(true);
  });

  it('роль — одной подписью на весь портал: словарь, незнакомая — «другая роль», без роли — «роль не названа»', () => {
    expect(roleLabel('general_contractor')).toBe(ASSERTION_ROLE_LABELS.general_contractor);
    expect(roleLabel('something_new')).toBe('другая роль');
    expect(roleLabel(null)).toBe('роль не названа');
    expect(CONTEXT_STATE_LABELS.construction).toBe('строится');
  });

  it('кто действовал — одной подписью: служебные авторы словами, модель — своим именем, логин — как есть', () => {
    expect(actorLabel('cli')).toBe('консоль сервера');
    expect(actorLabel('cli-probe')).toBe('консоль сервера');
    expect(actorLabel('scheduler')).toBe('по расписанию');
    expect(actorLabel('operator')).toBe('локальный оператор');
    expect(actorLabel('model:qwen3')).toBe('модель (qwen3)');
    expect(actorLabel('ivanov')).toBe('ivanov');
  });
});
