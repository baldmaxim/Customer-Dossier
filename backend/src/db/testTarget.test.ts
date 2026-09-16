// TC-002: тесты не подключаются к рабочей базе даже при заданном DATABASE_URL.

import { describe, it, expect } from 'vitest';

import { DEAD_DATABASE_URL } from '../__tests__/setup.js';
import { env } from '../config/env.js';
import { TEST_DB_MARKER, TestTargetError, assertTestDatabaseUrl, verifyConnectedTestDatabase, type IQueryable } from './testTarget.js';
import { prepareTestTargetProcess } from './testTargetBootstrap.js';

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
      role: 'tg_test',
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

describe('общий preflight записи в тестовую цель (этап 09, закрытие приёмки)', () => {
  const ok = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test';
  const fakePool = (row: { db: string; role: string; marker: string | null } | undefined): IQueryable =>
    ({ query: async () => ({ rows: row ? [row] : [] }) }) as unknown as IQueryable;
  const target = { host: '127.0.0.1', port: 55433, database: 'tg_info_test', role: 'tg_test' };

  it('имя со словом test без выделенного TEST_DATABASE_URL отклоняется, DATABASE_URL не подхватывается', () => {
    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/tg_info_test' };
    expect(() => prepareTestTargetProcess(env, undefined)).toThrow(/TEST_DATABASE_URL не задан/);
    expect(env.DATABASE_URL).toBe('postgresql://u:p@127.0.0.1:5432/tg_info_test');
  });

  it('произвольное имя с test и не-loopback адрес отклоняются', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@127.0.0.1:5432/my_test_db', undefined)).toThrow(TestTargetError);
    expect(() => assertTestDatabaseUrl('postgresql://u:p@10.0.0.5:5432/tg_info_test', undefined)).toThrow(/loopback/);
  });

  it('роль в адресе обязательна', () => {
    expect(() => assertTestDatabaseUrl('postgresql://127.0.0.1:55433/tg_info_test', undefined)).toThrow(/роль/);
  });

  it('известная рабочая цель из backend/.env отклоняет совпадающий адрес', () => {
    const env: NodeJS.ProcessEnv = { TEST_DATABASE_URL: ok };
    expect(() => prepareTestTargetProcess(env, 'postgresql://owner:pw@localhost:55433/tg_info_test')).toThrow(/совпадает/);
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('рабочий адрес из оболочки, совпадающий с тестовым, отклоняется', () => {
    expect(() => prepareTestTargetProcess({ TEST_DATABASE_URL: ok, DATABASE_URL: ok }, undefined)).toThrow(/совпадает/);
  });

  it('корректная цель: DATABASE_URL подменён, .env не читается, фоновые задания выключены', () => {
    const env: NodeJS.ProcessEnv = { TEST_DATABASE_URL: ok, DATABASE_URL: 'postgresql://w:p@127.0.0.1:5432/tg_info', INGEST_ENABLED: 'true', BOT_ENABLED: 'true' };
    expect(prepareTestTargetProcess(env, 'postgresql://w:p@127.0.0.1:5432/tg_info')).toEqual(target);
    expect(env.DATABASE_URL).toBe(ok);
    expect(env.DOTENV_CONFIG_PATH).toMatch(/do-not-load/);
    expect(env.INGEST_ENABLED).toBe('false');
    expect(env.BOT_ENABLED).toBe('false');
    expect(env.TG_INFO_ORIGINAL_DATABASE_URL).toBe('postgresql://w:p@127.0.0.1:5432/tg_info');
  });

  it('после подключения: несовпадение базы, роли или отсутствие маркера — отказ', async () => {
    await expect(verifyConnectedTestDatabase(fakePool({ db: 'tg_info', role: 'tg_test', marker: TEST_DB_MARKER }), target)).rejects.toThrow(/current_database/);
    await expect(verifyConnectedTestDatabase(fakePool({ db: 'tg_info_test', role: 'postgres', marker: TEST_DB_MARKER }), target)).rejects.toThrow(/current_user/);
    await expect(verifyConnectedTestDatabase(fakePool({ db: 'tg_info_test', role: 'tg_test', marker: null }), target)).rejects.toThrow(/маркера/);
    await expect(verifyConnectedTestDatabase(fakePool(undefined), target)).rejects.toThrow(TestTargetError);
    await expect(verifyConnectedTestDatabase(fakePool({ db: 'tg_info_test', role: 'tg_test', marker: TEST_DB_MARKER }), target)).resolves.toBeUndefined();
  });

  it('ни одна ошибка preflight не содержит пароль', () => {
    const cases: Array<() => unknown> = [
      () => prepareTestTargetProcess({ TEST_DATABASE_URL: 'postgresql://u:MarkerPw-7781@db.example:5432/tg_info_test' }, undefined),
      () => prepareTestTargetProcess({ TEST_DATABASE_URL: 'postgresql://u:MarkerPw-7781@127.0.0.1:5432/tg_info_test' }, 'postgresql://u:MarkerPw-7781@127.0.0.1:5432/tg_info_test'),
      () => assertTestDatabaseUrl('postgresql://u:MarkerPw-7781@127.0.0.1:5432/prod', undefined),
    ];
    for (const run of cases) {
      expect(run).toThrow();
      try {
        run();
      } catch (err) {
        expect((err as Error).message).not.toContain('MarkerPw-7781');
      }
    }
  });
});
