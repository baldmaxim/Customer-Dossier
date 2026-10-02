// Перечень содержимого для проверки восстановления (content-manifest@1). Каждая таблица public обязана
// быть здесь с классом и причиной: таблица в базе без записи в перечне — ошибка UNCLASSIFIED_TABLE,
// таблица из перечня, которой нет в базе, — MISSING_TABLE (не то же, что пустая).
//
// Все строки всех перечисленных таблиц хешируются целиком. Исключение колонки допускается только
// с причиной в `excludedColumns`; сейчас исключений нет. Секретов в открытом виде в базе нет (ADR-014):
// пароль — только хеш scrypt, идентификатор сессии — только sha256, ключ OpenRouter из админки — шифротекст
// AES-256-GCM (app_secrets, миграция 032; там же ключ Контур.Фокуса, 040), ключ доступа (passkey) — только открытый ключ (user_passkeys, 034);
// в fingerprint входит хеш от хеша или шифротекста.

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
  { table: 'revision_headlines', class: 'pipeline', why: 'тема публикации, составленная моделью (headline@1); не доказательство' },
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
  { table: 'registry_records', class: 'domain', why: 'снимки записей реестра: типизированные поля редакции (этап 20A)' },
  { table: 'domrf_targets', class: 'domain', why: 'добавленные оператором ссылки ДОМ.РФ и состояние браузерного разбора' },
  // Пользователи и вход (ADR-014)
  { table: 'users', class: 'domain', why: 'пользователи портала, роли, хеши паролей; логины стоят в атрибуции решений' },
  { table: 'user_sessions', class: 'operational', why: 'серверные сессии входа (sha256 идентификатора), отзыв и простой' },
  { table: 'auth_events', class: 'history', why: 'неизменяемый журнал входа и действий с пользователями' },
  { table: 'user_passkeys', class: 'domain', why: 'ключи доступа (passkey): только открытые ключи, счётчик подписей, отзыв (миграция 034)' },
  // Секреты из админки (миграция 032)
  { table: 'app_secrets', class: 'operational', why: 'ключ OpenRouter из админки: шифротекст, четыре последних символа, кто и когда задал' },
  // Объекты застройщика с ДОМ.РФ (миграция 035)
  { table: 'domrf_cards', class: 'operational', why: 'страницы застройщиков и групп в едином реестре: реквизиты, список объектов, очередь чтения' },
  { table: 'domrf_candidates', class: 'domain', why: 'найденные на страницах застройщика объекты и решения оператора: подтвердить, отклонить, заменить' },
  // Заказчики в реестре застройщиков (миграция 037)
  { table: 'domrf_company_searches', class: 'operational', why: 'поиск компании портала в реестре застройщиков: запрос, срок, ошибка' },
  { table: 'domrf_company_links', class: 'domain', why: 'найденные застройщики и группы заказчика и решения оператора: это он, не он, указан вручную' },
  // Контур.Фокус (миграция 040, ADR-015)
  { table: 'focus_checks', class: 'operational', why: 'что и когда спрашивали у Контур.Фокуса: срок следующей проверки, ошибка' },
  { table: 'focus_records', class: 'domain', why: 'ответы Контур.Фокуса (ЕГРЮЛ/ЕГРИП) как есть: новая строка только при изменении' },
  { table: 'focus_requests', class: 'history', why: 'журнал запросов к API Контур.Фокуса: расход тарифа и отказы, без ключа' },
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
  'DOMRF_BROWSER_ENABLED',
  'PIPELINE_ENABLED',
  'METRICS_AUTO_REFRESH',
  'FOCUS_ENABLED',
  'BOT_ENABLED',
  'REPROCESS_AUTO_PUBLISH',
  'MERGE_APPLY_ENABLED',
  'MODEL_REVIEW_ENABLED',
  'MODEL_REVIEW_APPLY',
  'REVISION_WRITE_ENABLED',
  'GRAPH_ENABLED',
  'GRAPH_EXPORT_ENABLED',
  'EXTRACT_SCHEMA_VERSION',
  'PROMPT_VERSION',
  'LLM_PROVIDER',
  'LMSTUDIO_MODEL',
  'EXTRACT_CHUNK_SIZE',
  'EXTRACT_MAX_CHUNKS',
  'EXTRACT_CONCURRENCY',
  'HOST',
  'PORT',
] as const;

/** Никогда не пишутся в manifest ни значением, ни хешем. */
export const CONFIG_DENYLIST = [
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  // Токен входа оператора (AUTH_MODE=token, ADR-013): ни значением, ни хешем.
  'OPERATOR_TOKEN',
  'TG_BOT_TOKEN',
  'TG_BOT_ALLOWED_USER_IDS',
  'LMSTUDIO_BASE_URL',
  // Ключ OpenRouter (LLM_PROVIDER=openrouter): ни значением, ни хешем.
  'LLM_API_KEY',
  // Ключ Контур.Фокуса (ADR-015): ни значением, ни хешем.
  'FOCUS_API_KEY',
  'DATABASE_SSL_CA_PATH',
] as const;

/** Фоновые задания: после восстановления обязаны быть выключены до ручного решения оператора. */
export const BACKGROUND_FLAGS = ['INGEST_ENABLED', 'DOMRF_BROWSER_ENABLED', 'PIPELINE_ENABLED', 'METRICS_AUTO_REFRESH', 'FOCUS_ENABLED', 'BOT_ENABLED', 'REPROCESS_AUTO_PUBLISH', 'MERGE_APPLY_ENABLED', 'MODEL_REVIEW_APPLY'] as const;
