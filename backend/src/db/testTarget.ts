// Проверка, что интеграционные тесты, сиды, замеры и частичные миграции идут в выделенную тестовую базу.
//
// Одного суффикса _test мало: рабочая база могла так называться, а
// DATABASE_URL в оболочке мог указывать куда угодно. Требования:
//  1. адрес задан отдельной переменной TEST_DATABASE_URL, не DATABASE_URL;
//  2. хост — loopback;
//  3. имя базы — tg_info_test или tg_info_test_<суффикс>; роль указана явно;
//  4. цель не совпадает ни с одной известной рабочей целью (DATABASE_URL оболочки,
//     исходный DATABASE_URL до подмены, DATABASE_URL из backend/.env) по host/port/db;
//  5. после подключения current_database() и current_user совпадают с заявленными и в базе
//     стоит маркер COMMENT ON DATABASE ... IS 'tg_info:test-target'.
// Любое несоответствие — отказ до первого изменяющего запроса.
//
// Порт и адрес сервера после подключения не сверяются: в Docker inet_server_port() — порт внутри
// контейнера (5432), а не проброшенный 55433. Эти параметры проверяются по адресу (loopback),
// а база, роль и маркер — фактическим запросом.
//
// Неизвестную рабочую базу guard не ищет: сравнение с известными целями — дополнительная защита,
// разрешение даёт только положительная идентификация тестовой цели (имя + роль + маркер).

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
  /** Роль из адреса. Пароль не сохраняется. */
  role: string;
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
    role: decodeURIComponent(url.username),
  };
};

const sameHost = (a: string, b: string): boolean => {
  const loop = (h: string) => (isLoopbackHost(h) ? 'loopback' : h);
  return loop(a) === loop(b);
};

/**
 * Проверка без подключения. Возвращает цель в обезличенном виде.
 * `workingUrls` — известные рабочие адреса (строка или список); пустые значения пропускаются.
 */
export const assertTestDatabaseUrl = (
  testUrl: string | undefined,
  workingUrls: string | undefined | ReadonlyArray<string | undefined>,
): ITestTarget => {
  if (!testUrl || testUrl.trim() === '') {
    throw new TestTargetError('TEST_DATABASE_URL не задан — запись в базу не выполняется');
  }
  const target = describeTarget(testUrl);
  if (!isLoopbackHost(target.host)) {
    throw new TestTargetError('хост не loopback');
  }
  if (!Number.isSafeInteger(target.port) || target.port <= 0) {
    throw new TestTargetError('порт не задан или некорректен');
  }
  if (!TEST_DB_NAME.test(target.database)) {
    throw new TestTargetError('имя базы должно быть tg_info_test или tg_info_test_<суффикс>');
  }
  if (target.role === '') {
    throw new TestTargetError('в адресе не указана роль');
  }
  const list = typeof workingUrls === 'string' || workingUrls === undefined ? [workingUrls] : workingUrls;
  for (const workingUrl of list) {
    if (!workingUrl || workingUrl.trim() === '') continue;
    // Рабочий адрес, совпадающий с тестовым буквально, — тоже совпадение (даже если не разбирается).
    if (workingUrl.trim() === testUrl.trim()) throw new TestTargetError('совпадает с DATABASE_URL');
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

/** Минимальный исполнитель запроса: пул, клиент или подмена в unit-тесте. */
export interface IQueryable {
  query: Pool['query'];
}

/** Проверка после подключения: та ли это база, та ли роль и размечена ли база как тестовая. */
export const verifyConnectedTestDatabase = async (pool: IQueryable, expected: ITestTarget): Promise<void> => {
  const res = await pool.query<{ db: string; role: string; marker: string | null }>(
    `SELECT current_database() AS db, current_user AS role,
            shobj_description(d.oid, 'pg_database') AS marker
     FROM pg_database d WHERE d.datname = current_database()`,
  );
  const row = res.rows[0];
  if (!row || row.db !== expected.database) {
    throw new TestTargetError('current_database() не совпадает с ожидаемой');
  }
  if (row.role !== expected.role) {
    throw new TestTargetError('current_user не совпадает с ролью из TEST_DATABASE_URL');
  }
  if (row.marker !== TEST_DB_MARKER) {
    throw new TestTargetError(
      `в базе нет маркера. Разметьте тестовую базу: COMMENT ON DATABASE ${expected.database} IS '${TEST_DB_MARKER}'`,
    );
  }
};
