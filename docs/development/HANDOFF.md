# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и обращений (рынок РФ). Код — `TG_Info`. План — `prompts/Customer_Dossier_Prompts/` (00–09).

## Текущее состояние
Этапы 02–05A — PASS. 05B — код готов, ждёт прогона пользователя (ожидается интеграция 13 файлов / 148, раздел I). Затем — 06.
Ветка `dossier-stages`. Проверить при открытии: `git log --oneline -5`, `git status`.

## Порядок работы (указание пользователя 2026-09-14)
После каждого этапа: отчёт → commit (русский, 1–2 предложения, без Co-Authored-By) → push `origin dossier-stages` → следующий этап.
Docker и проверки с базой агент не запускает: пишет инструкцию в `docs/development/TESTING_LOCAL.md`, делает паузу, ждёт отчёт пользователя.

## Уже сделано
- 00: baseline (`stages/00_REPORT.md`, `PATCH_COVERAGE.md`, `BACKLOG.md`).
- 01: безопасный запуск, вход оператора, допуск источников, SSRF-клиент, блокировка канона, изоляция тестов (ADR-001).
- 02: `source_items` / неизменяемые `document_revisions` / `source_observations` (миграция 011), backfill, API и UI версий (ADR-002). PASS.
- 03A: `assertions` / `evidence` / `review_decisions` (миграция 012), backfill, API решений, панель в админке (ADR-003). PASS.
- 03B: миграция 013 — запуски с отпечатком, lease/fencing, чанки с диапазонами, append-only ответы, наборы кандидатов,
  публикация одной транзакцией (`item_publications`, версия, stale, политика, superseded), проекции карточек;
  `backend/src/reprocess/*`, CLI `--reextract --limit/--runs/--preview/--publish/--retry`, API `/api/reprocess/*`,
  worker по `PIPELINE_ENABLED`, флаг `REPROCESS_AUTO_PUBLISH` (ADR-004). PASS.
- 04: миграция 014 — `companies.entity_type`, реестр `entity_identifiers`, `company_relations`, иерархия объектов,
  `resolution_ambiguities`, журнал `entity_merges`/`entity_merge_moves`; резолверы `decideExact`/`decideProjectExact`,
  `resolve/entityMerge.ts` (предпросмотр/применение/отмена), `backfill:identity`, API `/api/entities/*`, панель очереди
  слияний, флаг `MERGE_APPLY_ENABLED` (ADR-005). PASS.
- 05A: миграция 015 — здоровье источника, итоги и покрытие запусков, `http_cache`, точность дат, версия парсера;
  `ingest/sites/*` (профиль, даты, разборщики, fetcher, crawler, probe), транспорт тестов в `safeFetch`,
  `--site-profile`, `--probe-site`, API `/sources/:id/probe|profile`, колонка здоровья в админке (ADR-006).
- 05B: миграция 016 — `bot_processed_updates` (append-only), `source_observations.transport_meta`, исходы
  `policy_blocked/identity_changed/not_found/private`; `ingest/telegram/webCrawler.ts` (курсор `cursor.tg`, разрыв,
  граница истории, перепроверка правок, идентичность канала), `capabilities.ts`, журнал и `edited_message` в
  `telegramBot.ts`, `seed:test-telegram` (ADR-007). Следующая миграция — 017.

## Принятые решения
ADR-001…ADR-007. Offsets — code points. Решения аналитика append-only и не удаляются переразбором.
Публикация снимает только вклад своей публикации (evidence → superseded). Completed — только при полном покрытии.
Legacy apply и `clearDocumentContribution` не возвращать. Слияние — только `resolve/entityMerge.ts`; новая ссылка на компанию/объект → в перенос и `dependencyState`.

## Что проверено (среда агента)
typecheck/build backend и frontend, unit 25 файлов / 356 тестов — PASS.

## Что НЕ проверено
Живые сайты и каналы, живой бот (допуска и токена нет); интеграция 05B; реальный LLM-smoke; визуальные проверки 390 px.

## Остаточные риски
Метрики светофора по legacy-таблицам (этап 07); отзыв права ИИ не снимает опубликованное; UI для запусков и
очереди неоднозначностей нет; решения аналитика при слиянии не переносятся (нужен пересмотр).

## Безопасность
Рабочая база не подключалась; 010–014/backfill/переразбор/слияния к ней не применялись; `.env` не трогался; источники не включались.

## Следующий шаг
После PASS 05B — этап `stages/STAGE_06_RELATIONS_EVENTS.md`: читать COMMON_RULES, DATA_CONTRACTS, отчёты 03B и 04,
`reprocess/*`, `pipeline/verify.ts`, `llm/schema.ts`, миграции 012–014.

## Запреты
Не писать в рабочую БД; не включать MERGE_APPLY_ENABLED на рабочей базе без backup; не подключать источники/облачную модель;
не редактировать `.env`; не запускать Docker в среде агента.

## Что прочитать новой сессии
`prompts/Customer_Dossier_Prompts/COMMON_RULES.md`, `docs/development/STATE.md`, этот HANDOFF, `stages/05B_REPORT.md`, ADR-007,
`TESTING_LOCAL.md`; ключевые файлы: `backend/src/ingest/telegram/*.ts`, `telegramBot.ts`, `docs/migrations/016_telegram_cursors.sql`.
