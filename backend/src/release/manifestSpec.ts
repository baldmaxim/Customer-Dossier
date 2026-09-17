// Перечень содержимого для проверки восстановления (content-manifest@1). Каждая таблица public обязана
// быть здесь с классом и причиной: таблица в базе без записи в перечне — ошибка UNCLASSIFIED_TABLE,
// таблица из перечня, которой нет в базе, — MISSING_TABLE (не то же, что пустая).
//
// Все строки всех перечисленных таблиц хешируются целиком. Исключение колонки допускается только
// с причиной в `excludedColumns`; сейчас исключений нет. Секретов (паролей, токенов, сессий) в базе нет:
// сессии оператора живут в памяти процесса (api/auth.ts), токен — в backend/.local или .env.

export const MANIFEST_VERSION = 'content-manifest@1';
export const ROW_SERIALIZATION = 'pg-text-row@1';

export type TableClass = 'domain' | 'history' | 'pipeline' | 'operational' | 'registry';

export interface ITableSpec {
  table: string;
  class: TableClass;
  why: string;
  /** Колонка → причина исключения из fingerprint. */
  excludedColumns?: Readonly<Record<string, string>>;
}

export const TABLE_SPECS: readonly ITableSpec[] = [
  // Источники и допуск
  { table: 'sources', class: 'domain', why: 'источники, допуск сбора и ИИ, основания, курсоры (cursor JSONB)' },
  { table: 'source_policy_log', class: 'history', why: 'журнал изменений допуска' },
  { table: 'source_runs', class: 'operational', why: 'история проходов сбора, покрытие страниц' },
  { table: 'http_cache', class: 'operational', why: 'ETag/Last-Modified: влияет на следующий сбор' },
  { table: 'bot_processed_updates', class: 'history', why: 'журнал обновлений бота, offset транспорта' },
  // Публикации и редакции
  { table: 'source_items', class: 'domain', why: 'личность публикации' },
  { table: 'document_revisions', class: 'domain', why: 'неизменяемые тексты редакций' },
  { table: 'source_observations', class: 'history', why: 'наблюдения публикаций' },
  { table: 'raw_documents', class: 'domain', why: 'legacy-тексты, к ним привязаны старые цитаты' },
  { table: 'document_sightings', class: 'history', why: 'legacy-наблюдения' },
  { table: 'backfill_checkpoints', class: 'operational', why: 'позиция backfill: повторный запуск продолжает отсюда' },
  // Разбор
  { table: 'extractions', class: 'pipeline', why: 'legacy-ответы модели с версиями промпта' },
  { table: 'extraction_runs', class: 'pipeline', why: 'запуски с отпечатком параметров и арендой (очередь)' },
  { table: 'extraction_chunks', class: 'pipeline', why: 'диапазоны чанков и статусы' },
  { table: 'extraction_chunk_responses', class: 'pipeline', why: 'append-only ответы по чанкам' },
  { table: 'candidate_sets', class: 'pipeline', why: 'наборы кандидатов и их статус публикации' },
  { table: 'candidate_assertions', class: 'pipeline', why: 'кандидаты утверждений' },
  { table: 'candidate_set_evidence', class: 'pipeline', why: 'вклад набора в доказательства (составной ключ)' },
  { table: 'item_publications', class: 'domain', why: 'активный набор публикации и версия' },
  { table: 'publication_history', class: 'history', why: 'журнал публикаций наборов' },
  // Утверждения
  { table: 'assertions', class: 'domain', why: 'утверждения' },
  { table: 'evidence', class: 'domain', why: 'цитаты и span по редакциям' },
  { table: 'review_decisions', class: 'domain', why: 'решения аналитика с атрибуцией' },
  // Канон и идентичность
  { table: 'companies', class: 'domain', why: 'компании, слияния (merged_into_id)' },
  { table: 'entity_identifiers', class: 'domain', why: 'ИНН/ОГРН/ОГРНИП' },
  { table: 'entity_aliases', class: 'domain', why: 'псевдонимы' },
  { table: 'company_relations', class: 'domain', why: 'корпоративные связи' },
  { table: 'projects', class: 'domain', why: 'объекты, очереди, корпуса' },
  { table: 'project_participants', class: 'domain', why: 'legacy-роли' },
  { table: 'events', class: 'domain', why: 'legacy-события' },
  { table: 'mentions', class: 'domain', why: 'упоминания' },
  { table: 'resolution_ambiguities', class: 'domain', why: 'неоднозначности резолвера' },
  { table: 'ambiguity_decisions', class: 'history', why: 'неизменяемые решения по неоднозначным упоминаниям (этап 15A)' },
  { table: 'merge_queue', class: 'domain', why: 'очередь слияний и решения по ней' },
  { table: 'entity_merges', class: 'history', why: 'журнал слияний и отмен' },
  { table: 'entity_merge_moves', class: 'history', why: 'перенос строк слиянием (mapping)' },
  // Сигналы
  { table: 'signal_refreshes', class: 'history', why: 'пересчёты сигналов и их статус' },
  { table: 'company_signal_snapshots', class: 'domain', why: 'снимок сигналов на срез' },
  // Досье
  { table: 'dossier_cases', class: 'domain', why: 'обращения' },
  { table: 'dossier_case_versions', class: 'history', why: 'неизменяемая история обращений' },
  { table: 'dossier_snapshots', class: 'domain', why: 'снимки: payload, hash, метаданные' },
  { table: 'dossier_snapshot_redactions', class: 'history', why: 'журнал вымарываний с hash до/после' },
  // Реестр схемы
  { table: 'schema_migrations', class: 'registry', why: 'применённые миграции и время применения' },
];

/** Что сознательно не хешируется как строки, с причиной. Содержимое представлений входит в схему (определение). */
export const NOT_FINGERPRINTED: ReadonlyArray<{ object: string; why: string }> = [
  { object: 'представления *_v, company_risk', why: 'производные от таблиц: определение входит в раздел схемы' },
  { object: 'материализованное представление company_metrics', why: 'legacy-производная; определение в схеме, данные пересчитываются' },
  { object: 'OID, физическое размещение, статистика планировщика', why: 'не доменные данные, законно различаются после restore' },
  { object: 'COMMENT ON DATABASE (маркер тестовой цели)', why: 'свойство базы, а не данных; pg_dump без --create его не переносит' },
  { object: 'роли кластера, пароли, конфигурация сервера', why: 'вне дампа одной базы; готовятся отдельно' },
  { object: 'секреты окружения (.env, токен оператора)', why: 'не публикуются и не хешируются; сверяется только перечень не-секретных параметров' },
];

/** Параметры окружения, которые сравниваются явно. Секреты сюда не входят. */
export const CONFIG_KEYS = [
  'INGEST_ENABLED',
  'PIPELINE_ENABLED',
  'METRICS_AUTO_REFRESH',
  'BOT_ENABLED',
  'REPROCESS_AUTO_PUBLISH',
  'MERGE_APPLY_ENABLED',
  'REVISION_WRITE_ENABLED',
  'GRAPH_EXPORT_ENABLED',
  'EXTRACT_SCHEMA_VERSION',
  'PROMPT_VERSION',
  'LMSTUDIO_MODEL',
  'EXTRACT_CHUNK_SIZE',
  'EXTRACT_MAX_CHUNKS',
  'EXTRACT_CONCURRENCY',
  'HOST',
  'PORT',
  'SESSION_IDLE_MINUTES',
  'SESSION_MAX_HOURS',
] as const;

/** Никогда не пишутся в manifest ни значением, ни хешем. */
export const CONFIG_DENYLIST = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'OPERATOR_TOKEN',
  'TG_BOT_TOKEN',
  'TG_BOT_ALLOWED_USER_IDS',
  'LMSTUDIO_BASE_URL',
  'DATABASE_SSL_CA_PATH',
] as const;

/** Фоновые задания: после восстановления обязаны быть выключены до ручного решения оператора. */
export const BACKGROUND_FLAGS = ['INGEST_ENABLED', 'PIPELINE_ENABLED', 'METRICS_AUTO_REFRESH', 'BOT_ENABLED', 'REPROCESS_AUTO_PUBLISH', 'MERGE_APPLY_ENABLED'] as const;
