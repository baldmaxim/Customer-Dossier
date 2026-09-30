// Правила учётной записи на клиенте — зеркало серверных (auth/service.ts, auth/password.ts): те же
// границы, иначе форма пропустит то, что сервер отвергнет, или наоборот. Тексты имени и пароля —
// серверные; у логина — точнее: что именно не так (общее правило — в подсказке к полю).
import { describe, expect, it } from 'vitest';

import { displayNameProblem, LOGIN_RE, loginProblem, normalizeLogin, passwordProblem } from './accountRules';

describe('правила учётной записи', () => {
  it('логин: нормализация, что именно не так, зарезервированные', () => {
    expect(normalizeLogin('  Ivanov@Firma.RU ')).toBe('ivanov@firma.ru');
    for (const ok of ['ivanov', 'ivanov@firma.ru', 'i.ivanov-2', '007', 'a_b']) expect(loginProblem(ok), ok).toBeNull();
    expect(loginProblem('')).toBe('Укажите логин');
    expect(loginProblem('иван иванов')).toMatch(/^Только латинские буквы/);
    expect(loginProblem('Ivanov')).toMatch(/^Только латинские буквы/);
    expect(loginProblem('iv anov')).toMatch(/без пробелов/);
    expect(loginProblem('.ivanov')).toBe('Логин начинается с латинской буквы или цифры');
    expect(loginProblem('ab')).toBe('Логин — не короче 3 знаков');
    expect(loginProblem('a'.repeat(65))).toBe('Логин — не длиннее 64 знаков');
    expect(loginProblem('operator')).toBe('Этот логин зарезервирован системой');
  });

  it('шаги проверки логина дают ровно правило сервера', () => {
    // LOGIN_RE — копия серверного (auth/service.ts); шаги loginProblem не должны пропускать лишнего.
    expect(LOGIN_RE.source).toBe('^[a-z0-9][a-z0-9._@-]{2,63}$');
    const samples = ['', 'a', 'ab', 'abc', '-ab', '_ab', '@ab', 'a-b', 'a..', '0@0', 'Abc', 'абв', 'a b', 'a\tb', 'a'.repeat(64), 'a'.repeat(65), 'x😀y'];
    for (const login of samples) expect(loginProblem(login) === null, JSON.stringify(login)).toBe(LOGIN_RE.test(login));
  });

  it('имя: от 1 до 120 символов, без управляющих', () => {
    expect(displayNameProblem('Иван Иванов')).toBeNull();
    expect(displayNameProblem('')).toMatch(/от 1 до 120/);
    expect(displayNameProblem('x'.repeat(121))).toMatch(/от 1 до 120/);
    expect(displayNameProblem('Иван\nИванов')).toBe('Имя содержит управляющие символы');
  });

  it('пароль: длина, пробелы, логин внутри, разнообразие', () => {
    expect(passwordProblem('Own-Secret-Pass-9', 'ivanov')).toBeNull();
    expect(passwordProblem('Short-1', 'ivanov')).toBe('Пароль — не короче 10 символов');
    expect(passwordProblem('x'.repeat(257), 'ivanov')).toBe('Пароль — не длиннее 256 символов');
    expect(passwordProblem('            ', 'ivanov')).toBe('Пароль не может состоять из одних пробелов');
    expect(passwordProblem('My-IVANOV-pass-1', 'ivanov')).toBe('Пароль не должен содержать логин');
    expect(passwordProblem('abababababab', 'ivanov')).toBe('В пароле слишком мало разных символов');
    // Логин ещё не введён — «без логина внутри» не проверяется: иначе любой пароль «содержит» пустую строку.
    expect(passwordProblem('Own-Secret-Pass-9', '')).toBeNull();
    // Длина — в символах, а не в единицах UTF-16: эмодзи — один символ, как на сервере.
    expect(passwordProblem('😀😀😀😀😀😀😀😀😀', 'ivanov')).toBe('Пароль — не короче 10 символов');
  });
});
