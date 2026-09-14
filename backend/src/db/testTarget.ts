// Проверка, что интеграционные тесты идут в выделенную тестовую базу.
//
// Одного суффикса _test мало: рабочая база могла так называться, а
// DATABASE_URL в оболочке мог указывать куда угодно. Требования:
//  1. адрес задан отдельной переменной TEST_DATABASE_URL, не DATABASE_URL;
//  2. хост — loopback;
//  3. имя базы — tg_info_test или tg_info_test_<суффикс>;
//  4. цель не совпадает с DATABASE_URL (host/port/db), если он задан;
//  5. после подключения current_database() совпадает с ожидаемым и в базе
//     стоит маркер COMMENT ON DATABASE ... IS 'tg_info:test-target'.
// Любое несоответствие — отказ до первого изменяющего запроса.

import type { Pool } from 'pg';

import { isLoopbackHost } from '../config/parse.js';

export const TEST_DB_MARKER = 'tg_info:test-target';
const TEST_DB_NAME = /^tg_info_test(_[a-z0-9]+)?$/;

export class TestTargetError extends Error {
  constructor(message: string) {
    super(`Тестовая цель отклонена: ${message}`);
    this.name = 'TestTargetError';
  }
}

export interface ITestTarget {
  host: string;
  port: number;
  database: string;
}

const describeTarget = (raw: string): ITestTarget => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TestTargetError('адрес не разбирается');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new TestTargetError('ожидается postgresql://');
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
    port: url.port === '' ? 5432 : Number(url.port),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
};

const sameHost = (a: string, b: string): boolean => {
  const loop = (h: string) => (isLoopbackHost(h) ? 'loopback' : h);
  return loop(a) === loop(b);
};

/** Проверка без подключения. Возвращает цель в обезличенном виде. */
export const assertTestDatabaseUrl = (testUrl: string | undefined, workingUrl: string | undefined): ITestTarget => {
  if (!testUrl || testUrl.trim() === '') {
    throw new TestTargetError('TEST_DATABASE_URL не задан — интеграционные тесты не запускаются');
  }
  const target = describeTarget(testUrl);
  if (!isLoopbackHost(target.host)) {
    throw new TestTargetError('хост не loopback');
  }
  if (!TEST_DB_NAME.test(target.database)) {
    throw new TestTargetError('имя базы должно быть tg_info_test или tg_info_test_<суффикс>');
  }
  if (workingUrl && workingUrl.trim() !== '') {
    let working: ITestTarget | null = null;
    try {
      working = describeTarget(workingUrl);
    } catch {
      working = null;
    }
    if (
      working &&
      sameHost(working.host, target.host) &&
      working.port === target.port &&
      working.database === target.database
    ) {
      throw new TestTargetError('совпадает с DATABASE_URL');
    }
  }
  return target;
};

/** Проверка после подключения: та ли это база и размечена ли она как тестовая. */
export const verifyConnectedTestDatabase = async (pool: Pool, expected: ITestTarget): Promise<void> => {
  const res = await pool.query<{ db: string; marker: string | null }>(
    `SELECT current_database() AS db,
            shobj_description(d.oid, 'pg_database') AS marker
     FROM pg_database d WHERE d.datname = current_database()`,
  );
  const row = res.rows[0];
  if (!row || row.db !== expected.database) {
    throw new TestTargetError('current_database() не совпадает с ожидаемой');
  }
  if (row.marker !== TEST_DB_MARKER) {
    throw new TestTargetError(
      `в базе нет маркера. Разметьте тестовую базу: COMMENT ON DATABASE ${expected.database} IS '${TEST_DB_MARKER}'`,
    );
  }
};
