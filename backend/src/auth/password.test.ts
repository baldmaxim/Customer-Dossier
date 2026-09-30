// Пароли (ADR-014): scrypt с параметрами в строке, отказ на испорченной строке, правило пароля.

import { describe, expect, it } from 'vitest';

import { CURRENT_PARAMS, generatePassword, hashPassword, needsRehash, passwordProblem, verifyPassword } from './password.js';

describe('хеш пароля', () => {
  it('верный пароль проходит, неверный — нет; соль у каждого хеша своя', async () => {
    const a = await hashPassword('Correct-Horse-7731');
    const b = await hashPassword('Correct-Horse-7731');
    expect(a).not.toBe(b);
    expect(a.startsWith(`scrypt$ln=${CURRENT_PARAMS.ln},r=${CURRENT_PARAMS.r},p=${CURRENT_PARAMS.p}$`)).toBe(true);
    expect(a).not.toContain('Correct-Horse');
    expect(await verifyPassword('Correct-Horse-7731', a)).toBe(true);
    expect(await verifyPassword('correct-horse-7731', a)).toBe(false);
  });

  it('одинаковый пароль в разных нормальных формах Unicode — один пароль', async () => {
    const composed = 'Пароль-ёлка-2026';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it('испорченная или чужая строка хеша — отказ, а не исключение', async () => {
    for (const bad of ['', 'plain-text', '$2b$10$abcdefghijklmnopqrstuv', 'scrypt$ln=30,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAA']) {
      expect(await verifyPassword('anything', bad), bad).toBe(false);
      expect(needsRehash(bad)).toBe(true);
    }
  });

  it('хеш с прежними параметрами проходит и помечается к пересчёту', async () => {
    const current = await hashPassword('Correct-Horse-7731');
    expect(needsRehash(current)).toBe(false);
    const weaker = current.replace(`ln=${CURRENT_PARAMS.ln},r=8,p=${CURRENT_PARAMS.p}`, 'ln=12,r=8,p=1');
    expect(needsRehash(weaker)).toBe(true);
  });
});

describe('правило пароля', () => {
  it('короткий, из одного символа, с логином — отказ; текст без самого пароля', () => {
    expect(passwordProblem('short', 'ivanov')).toMatch(/не короче/);
    expect(passwordProblem('aaaaaaaaaaaa', 'ivanov')).toMatch(/разных символов/);
    expect(passwordProblem('my-IVANOV-pass-1', 'ivanov')).toMatch(/логин/);
    expect(passwordProblem(' '.repeat(12), 'ivanov')).not.toBeNull();
    expect(passwordProblem('x'.repeat(300), 'ivanov')).toMatch(/не длиннее/);
    expect(passwordProblem('Correct-Horse-7731', 'ivanov')).toBeNull();
    expect(passwordProblem('short-secret', 'ivanov') ?? '').not.toContain('short-secret');
  });

  it('сгенерированный пароль проходит правило', () => {
    for (let i = 0; i < 20; i += 1) expect(passwordProblem(generatePassword(), 'admin')).toBeNull();
  });
});
