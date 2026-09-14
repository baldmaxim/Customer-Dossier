// TC-002: тесты не подключаются к рабочей базе даже при заданном DATABASE_URL.

import { describe, it, expect } from 'vitest';

import { DEAD_DATABASE_URL } from '../__tests__/setup.js';
import { env } from '../config/env.js';
import { TestTargetError, assertTestDatabaseUrl } from './testTarget.js';

describe('unit-профиль не наследует DATABASE_URL (TC-002)', () => {
  it('в unit-тестах база — заведомо мёртвый адрес, что бы ни было в оболочке', () => {
    // setup.ts присваивает, а не ??=. Проверка прогоняется и с внешним
    // DATABASE_URL (см. evidence/01): значение из оболочки сюда не доходит.
    expect(process.env.DATABASE_URL).toBe(DEAD_DATABASE_URL);
    expect(env.DATABASE_URL).toBe(DEAD_DATABASE_URL);
  });

  it('часовой пояс тестов — UTC, а не пояс машины разработчика', () => {
    expect(process.env.TZ).toBe('UTC');
  });
});

describe('assertTestDatabaseUrl', () => {
  const ok = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test';

  it('принимает локальную базу tg_info_test', () => {
    expect(assertTestDatabaseUrl(ok, undefined)).toEqual({
      host: '127.0.0.1',
      port: 55433,
      database: 'tg_info_test',
    });
  });

  it('без TEST_DATABASE_URL отказывает, а не берёт DATABASE_URL', () => {
    expect(() => assertTestDatabaseUrl(undefined, ok)).toThrow(TestTargetError);
    expect(() => assertTestDatabaseUrl('', ok)).toThrow(TestTargetError);
  });

  it('удалённый хост отклоняется даже с правильным именем базы', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://u:p@db.internal.example:5432/tg_info_test', undefined),
    ).toThrow(/loopback/);
  });

  it('имя базы без префикса tg_info_test отклоняется', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@127.0.0.1:5432/tg_info', undefined)).toThrow(TestTargetError);
    expect(() => assertTestDatabaseUrl('postgresql://u:p@127.0.0.1:5432/prod_test', undefined)).toThrow(
      TestTargetError,
    );
  });

  it('цель, совпадающая с DATABASE_URL, отклоняется', () => {
    const same = 'postgresql://other:pw@localhost:55433/tg_info_test';
    expect(() => assertTestDatabaseUrl(ok, same)).toThrow(/совпадает с DATABASE_URL/);
  });

  it('текст ошибки не содержит пароль', () => {
    try {
      assertTestDatabaseUrl('postgresql://u:SuperSecret@db.example:5432/tg_info_test', undefined);
    } catch (err) {
      expect((err as Error).message).not.toContain('SuperSecret');
    }
  });
});
