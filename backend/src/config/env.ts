// Централизованный разбор env. Значения секретов никогда не логируются.

import 'dotenv/config';

import {
  EnvValueError,
  parseListenHost,
  parseLlmBaseUrl,
  parsePositiveInt,
  parseStrictBool,
} from './parse.js';

type EnvSource = Readonly<Record<string, string | undefined>>;

const parseSchemaVersion = (raw: string | undefined): 'extract@2' | 'extract@3' => {
  const value = raw === undefined || raw.trim() === '' ? 'extract@3' : raw.trim();
  if (value !== 'extract@2' && value !== 'extract@3') {
    throw new EnvValueError('EXTRACT_SCHEMA_VERSION: допустимо extract@3 (по умолчанию) или extract@2');
  }
  return value;
};

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
    // Схема ответа модели для новых запусков конвейера (этап 06). extract@2 — откат к прежней
    // схеме: запуски и наборы, уже сделанные по extract@3, остаются как были.
    EXTRACT_SCHEMA_VERSION: parseSchemaVersion(source.EXTRACT_SCHEMA_VERSION),

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

    // Фоновые задания. Портал работает сам: сбор идёт по источникам с
    // подтверждённым допуском, разбор ставится по новым редакциям, сигналы
    // пересчитываются. Каждый флаг остаётся рубильником: =false выключает.
    // Допуск источника это не отменяет — без него живого запроса не будет.
    INGEST_ENABLED: parseStrictBool('INGEST_ENABLED', source.INGEST_ENABLED, true),
    PIPELINE_ENABLED: parseStrictBool('PIPELINE_ENABLED', source.PIPELINE_ENABLED, true),
    METRICS_AUTO_REFRESH: parseStrictBool('METRICS_AUTO_REFRESH', source.METRICS_AUTO_REFRESH, true),
    BOT_ENABLED: parseStrictBool('BOT_ENABLED', source.BOT_ENABLED, false),
    // Запись публикаций и редакций (миграция 011). Выключение — откат к
    // прежнему поведению: правки постов снова теряются, legacy-чтение не страдает.
    REVISION_WRITE_ENABLED: parseStrictBool('REVISION_WRITE_ENABLED', source.REVISION_WRITE_ENABLED, true),
    // Автопубликация наборов кандидатов (этап 03B). Решение владельца 21.09.2026:
    // включена по умолчанию — ручной предпросмотр каждого набора неудобен.
    // Ослабления проверок это не означает: неполный и упавший запуск не публикуются
    // ни при каком флаге, устаревший разбор остаётся кандидатом.
    REPROCESS_AUTO_PUBLISH: parseStrictBool('REPROCESS_AUTO_PUBLISH', source.REPROCESS_AUTO_PUBLISH, true),
    // Применение и отмена слияния сущностей (этап 04). По умолчанию выключено: предпросмотр,
    // журнал и чтение слитых сущностей работают, запись — только после явного включения.
    MERGE_APPLY_ENABLED: parseStrictBool('MERGE_APPLY_ENABLED', source.MERGE_APPLY_ENABLED, false),
    // Схема связей — ядро продукта, у неё свой флаг. false — маршрут /api/graph отключён.
    GRAPH_ENABLED: parseStrictBool('GRAPH_ENABLED', source.GRAPH_ENABLED, true),
    // Снимки досье и выгрузки (этап 08B). Экраны сняты с портала; API и данные целы.
    GRAPH_EXPORT_ENABLED: parseStrictBool('GRAPH_EXPORT_ENABLED', source.GRAPH_EXPORT_ENABLED, true),

    HOST: parseListenHost(source.HOST),
    PORT: parsePositiveInt('PORT', source.PORT, 4100),
    CORS_ORIGINS: optional(source, 'CORS_ORIGINS', 'http://127.0.0.1:5173,http://localhost:5173'),
  } as const;
};

export type IEnv = ReturnType<typeof parseEnv>;

export const env: IEnv = parseEnv(process.env);
