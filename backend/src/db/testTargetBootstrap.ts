// Подготовка процесса, который будет писать в тестовую базу: интеграционные тесты, сиды, замеры,
// частичная миграция (--upto). Вызывается ДО импорта config/env и db/pool — иначе пул успеет
// взять DATABASE_URL из оболочки или backend/.env.
//
// Порядок: известные рабочие адреса (оболочка + backend/.env) → guard адреса TEST_DATABASE_URL →
// подмена DATABASE_URL тестовым → backend/.env больше не читается → фоновые задания выключены.
// Подключение и маркер проверяет verifyConnectedTestDatabase до первой записи (см. assertIsolatedTarget).
// Значения адресов не печатаются.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { assertTestDatabaseUrl, type ITestTarget } from './testTarget.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** backend/src/db (или backend/dist/db) → backend/.env */
export const BACKEND_DOTENV_PATH = path.resolve(HERE, '..', '..', '.env');

/** DATABASE_URL из backend/.env, если файл есть. Значение только сравнивается, не выводится. */
export const readDotenvDatabaseUrl = (file: string = BACKEND_DOTENV_PATH): string | undefined => {
  try {
    if (!fs.existsSync(file)) return undefined;
    return dotenv.parse(fs.readFileSync(file)).DATABASE_URL;
  } catch {
    return undefined;
  }
};

/** Флаги, с которыми процесс против тестовой цели не запускает ничего фонового и не ходит в модель. */
export const TEST_PROCESS_ENV: Readonly<Record<string, string>> = {
  DATABASE_SSL: 'false',
  LMSTUDIO_BASE_URL: 'http://127.0.0.1:1/v1',
  LMSTUDIO_MODEL: 'test-model',
  PROMPT_VERSION: 'test',
  TG_BOT_TOKEN: '',
  TG_BOT_ALLOWED_USER_IDS: '',
  INGEST_ENABLED: 'false',
  PIPELINE_ENABLED: 'false',
  METRICS_AUTO_REFRESH: 'false',
  BOT_ENABLED: 'false',
  REPROCESS_AUTO_PUBLISH: 'false',
  MERGE_APPLY_ENABLED: 'false',
  GRAPH_EXPORT_ENABLED: 'true',
  REVISION_WRITE_ENABLED: 'true',
  HOST: '127.0.0.1',
  TZ: 'UTC',
};

/**
 * Проверяет адрес и переключает процесс на тестовую цель. Повторный вызов безопасен:
 * исходный DATABASE_URL запоминается один раз и дальше участвует в сравнении.
 */
export const prepareTestTargetProcess = (
  env: NodeJS.ProcessEnv = process.env,
  dotenvDatabaseUrl: string | undefined = readDotenvDatabaseUrl(),
): ITestTarget => {
  env.TG_INFO_ORIGINAL_DATABASE_URL ??= env.DATABASE_URL ?? '';
  const target = assertTestDatabaseUrl(env.TEST_DATABASE_URL, [
    env.TG_INFO_ORIGINAL_DATABASE_URL,
    env.DATABASE_URL === env.TEST_DATABASE_URL ? undefined : env.DATABASE_URL,
    dotenvDatabaseUrl,
  ]);
  env.DOTENV_CONFIG_PATH = 'test-target-do-not-load-dotenv.env';
  env.DATABASE_URL = env.TEST_DATABASE_URL;
  for (const [key, value] of Object.entries(TEST_PROCESS_ENV)) env[key] = value;
  return target;
};

/** Повторная проверка адреса для уже подготовленного процесса (без изменения окружения). */
export const assertPreparedTestTarget = (env: NodeJS.ProcessEnv = process.env): ITestTarget => {
  const target = assertTestDatabaseUrl(env.TEST_DATABASE_URL, [env.TG_INFO_ORIGINAL_DATABASE_URL, readDotenvDatabaseUrl()]);
  if (env.DATABASE_URL !== env.TEST_DATABASE_URL) {
    throw new Error('DATABASE_URL процесса не указывает на тестовую цель');
  }
  return target;
};
