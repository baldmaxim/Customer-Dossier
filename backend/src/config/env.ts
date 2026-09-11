// Централизованный разбор env. Значения секретов никогда не логируются.

import 'dotenv/config';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Не задана обязательная переменная окружения ${name} (см. backend/.env.example)`);
  }
  return value;
};

const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
};

const intOf = (raw: string, name: string): number => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} должен быть положительным целым числом, получено: ${raw}`);
  }
  return n;
};

const boolOf = (raw: string): boolean => raw.trim().toLowerCase() !== 'false';

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  DATABASE_SSL: boolOf(optional('DATABASE_SSL', 'true')),
  DATABASE_SSL_REJECT_UNAUTHORIZED: boolOf(optional('DATABASE_SSL_REJECT_UNAUTHORIZED', 'true')),
  DATABASE_SSL_CA_PATH: process.env.DATABASE_SSL_CA_PATH ?? '',
  DATABASE_POOL_MAX: intOf(optional('DATABASE_POOL_MAX', '10'), 'DATABASE_POOL_MAX'),
  DATABASE_STATEMENT_TIMEOUT_MS: intOf(
    optional('DATABASE_STATEMENT_TIMEOUT_MS', '30000'),
    'DATABASE_STATEMENT_TIMEOUT_MS',
  ),

  LMSTUDIO_BASE_URL: optional('LMSTUDIO_BASE_URL', 'http://localhost:1234/v1'),
  LMSTUDIO_MODEL: optional('LMSTUDIO_MODEL', 'qwen3-8b'),
  LMSTUDIO_TIMEOUT_MS: intOf(optional('LMSTUDIO_TIMEOUT_MS', '120000'), 'LMSTUDIO_TIMEOUT_MS'),

  PROMPT_VERSION: optional('PROMPT_VERSION', 'p1'),
  SCHEMA_VERSION: optional('SCHEMA_VERSION', 'extract@1'),

  EXTRACT_CONCURRENCY: intOf(optional('EXTRACT_CONCURRENCY', '2'), 'EXTRACT_CONCURRENCY'),
  EXTRACT_BATCH_SIZE: intOf(optional('EXTRACT_BATCH_SIZE', '8'), 'EXTRACT_BATCH_SIZE'),
  // Значения по умолчанию взяты с живой нагрузки: 6000/4 давали таймауты
  // на длинных статьях, 3500/6 их убрали.
  EXTRACT_CHUNK_SIZE: intOf(optional('EXTRACT_CHUNK_SIZE', '3500'), 'EXTRACT_CHUNK_SIZE'),
  EXTRACT_MAX_CHUNKS: intOf(optional('EXTRACT_MAX_CHUNKS', '6'), 'EXTRACT_MAX_CHUNKS'),

  TG_FETCH_DELAY_MS: intOf(optional('TG_FETCH_DELAY_MS', '4000'), 'TG_FETCH_DELAY_MS'),
  INGEST_USER_AGENT: optional(
    'INGEST_USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  ),

  TG_BOT_TOKEN: process.env.TG_BOT_TOKEN ?? '',
  TG_BOT_ALLOWED_USER_IDS: optional('TG_BOT_ALLOWED_USER_IDS', ''),

  PORT: intOf(optional('PORT', '4100'), 'PORT'),
  CORS_ORIGINS: optional('CORS_ORIGINS', 'http://localhost:5173'),
} as const;
