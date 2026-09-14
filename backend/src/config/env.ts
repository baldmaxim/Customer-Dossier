// Централизованный разбор env. Значения секретов никогда не логируются.

import 'dotenv/config';

import {
  EnvValueError,
  parseListenHost,
  parseLlmBaseUrl,
  parseOperatorToken,
  parsePositiveInt,
  parseStrictBool,
} from './parse.js';

type EnvSource = Readonly<Record<string, string | undefined>>;

const optional = (source: EnvSource, name: string, fallback: string): string => {
  const value = source[name];
  return value === undefined || value.trim() === '' ? fallback : value;
};

export const parseEnv = (source: EnvSource) => {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl || databaseUrl.trim() === '') {
    throw new EnvValueError('Не задана обязательная переменная окружения DATABASE_URL (см. backend/.env.example)');
  }

  return {
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: parseStrictBool('DATABASE_SSL', source.DATABASE_SSL, true),
    DATABASE_SSL_REJECT_UNAUTHORIZED: parseStrictBool(
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
      source.DATABASE_SSL_REJECT_UNAUTHORIZED,
      true,
    ),
    DATABASE_SSL_CA_PATH: source.DATABASE_SSL_CA_PATH ?? '',
    DATABASE_POOL_MAX: parsePositiveInt('DATABASE_POOL_MAX', source.DATABASE_POOL_MAX, 10),
    DATABASE_STATEMENT_TIMEOUT_MS: parsePositiveInt(
      'DATABASE_STATEMENT_TIMEOUT_MS',
      source.DATABASE_STATEMENT_TIMEOUT_MS,
      30_000,
    ),

    // Доверенный фиксированный адрес локальной модели. Сетевая политика
    // источников к нему не применяется, и адрес не берётся из публикаций.
    LMSTUDIO_BASE_URL: parseLlmBaseUrl(source.LMSTUDIO_BASE_URL),
    LMSTUDIO_MODEL: optional(source, 'LMSTUDIO_MODEL', 'qwen3-8b'),
    LMSTUDIO_TIMEOUT_MS: parsePositiveInt('LMSTUDIO_TIMEOUT_MS', source.LMSTUDIO_TIMEOUT_MS, 120_000),

    PROMPT_VERSION: optional(source, 'PROMPT_VERSION', 'p1'),

    // 1, а не 2: каждый параллельный запрос держит свой кэш контекста в VRAM.
    // На 8 ГБ два запроса к 8B выталкивают модель в оперативную память —
    // тот же механизм, что давал пятиминутные таймауты при контексте 16K.
    EXTRACT_CONCURRENCY: parsePositiveInt('EXTRACT_CONCURRENCY', source.EXTRACT_CONCURRENCY, 1),
    EXTRACT_BATCH_SIZE: parsePositiveInt('EXTRACT_BATCH_SIZE', source.EXTRACT_BATCH_SIZE, 8),
    // Значения по умолчанию взяты с живой нагрузки: 6000/4 давали таймауты
    // на длинных статьях, 3500/6 их убрали.
    EXTRACT_CHUNK_SIZE: parsePositiveInt('EXTRACT_CHUNK_SIZE', source.EXTRACT_CHUNK_SIZE, 3500),
    EXTRACT_MAX_CHUNKS: parsePositiveInt('EXTRACT_MAX_CHUNKS', source.EXTRACT_MAX_CHUNKS, 6),

    TG_FETCH_DELAY_MS: parsePositiveInt('TG_FETCH_DELAY_MS', source.TG_FETCH_DELAY_MS, 4000),
    INGEST_USER_AGENT: optional(
      source,
      'INGEST_USER_AGENT',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    ),

    TG_BOT_TOKEN: source.TG_BOT_TOKEN?.trim() ?? '',
    TG_BOT_ALLOWED_USER_IDS: optional(source, 'TG_BOT_ALLOWED_USER_IDS', ''),

    // Фоновые задания. По умолчанию выключены: открыть портал не значит
    // начать сбор, обращение к модели или пересчёт.
    INGEST_ENABLED: parseStrictBool('INGEST_ENABLED', source.INGEST_ENABLED, false),
    PIPELINE_ENABLED: parseStrictBool('PIPELINE_ENABLED', source.PIPELINE_ENABLED, false),
    METRICS_AUTO_REFRESH: parseStrictBool('METRICS_AUTO_REFRESH', source.METRICS_AUTO_REFRESH, false),
    BOT_ENABLED: parseStrictBool('BOT_ENABLED', source.BOT_ENABLED, false),
    // Запись публикаций и редакций (миграция 011). Выключение — откат к
    // прежнему поведению: правки постов снова теряются, legacy-чтение не страдает.
    REVISION_WRITE_ENABLED: parseStrictBool('REVISION_WRITE_ENABLED', source.REVISION_WRITE_ENABLED, true),

    HOST: parseListenHost(source.HOST),
    PORT: parsePositiveInt('PORT', source.PORT, 4100),
    CORS_ORIGINS: optional(source, 'CORS_ORIGINS', 'http://127.0.0.1:5173,http://localhost:5173'),

    OPERATOR_TOKEN: parseOperatorToken(source.OPERATOR_TOKEN),
    SESSION_IDLE_MINUTES: parsePositiveInt('SESSION_IDLE_MINUTES', source.SESSION_IDLE_MINUTES, 120),
    SESSION_MAX_HOURS: parsePositiveInt('SESSION_MAX_HOURS', source.SESSION_MAX_HOURS, 12),
  } as const;
};

export type IEnv = ReturnType<typeof parseEnv>;

export const env: IEnv = parseEnv(process.env);
