# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и обращений (рынок РФ). Код — `TG_Info`. План — `prompts/Customer_Dossier_Prompts/` (00–09).

## Текущее состояние
Этапы 02–06 — PASS по core-gates. Замер qwen3-8b на extract@3: safety 24/25, recall 3/9 — переразбор рабочей базы не начинать. 07 — PASS. 08A — PASS по core-gates (интеграция 16 файлов / 173, L через API; визуальный проход NOT_RUN). 08B — PASS по core-gates (интеграция 17 файлов / 182, M1–M6; печать в PDF NOT_RUN). Следующий — 09.
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
  `telegramBot.ts`, `seed:test-telegram` (ADR-007).
- 06: миграция 017 — смысловые столбцы `assertions` (полярность, объект договора, дело, стадия, роли сторон, НДС),
  предикаты `contract`/`corporate_relation`, проекции карточек без плана/слуха/отрицания, `review_queue_v`,
  `project_state_history_v`/`project_current_state_v`, `legal_case_events_v`; схема extract@3 (`llm/semantic/*`),
  проверка смысла `reprocess/semantic/*`, API очереди/истории объекта/дел, `--queue`, `benchmark:model`,
  `seed:test-semantic` (ADR-008).
- 07: миграция 018 — `signal_refreshes`, `company_signal_snapshots`; `backend/src/signals/*` (правила `signals@1` на срез,
  загрузка, пересчёт с журналом и stale, контекст объекта); API `/companies/:id/signals|context|legacy-risk`, список и сводка
  подрядчиков из снимка; карточка без вердикта и RiskBadge (ADR-009).
- 08A: миграция 019 — `dossier_cases`, `dossier_case_versions`, `review_queue_v` (отрицание без корпуса); `backend/src/dossier/*`
  (обращения с версией, факты с доказательствами, шаблоны фраз, досье обращения, объекта, резюме компании); API
  `/cases`, `/cases/:id/dossier`, `/projects/search`, `/projects/:id/dossier`, `/companies/:id/dossier-summary`; причина решения
  обязательна; экраны «Обращения», обращение, объект, «Проверка» за `VITE_DOSSIER_UI` (ADR-010).
- 08B: миграция 020 — `dossier_snapshots` (неизменяемый payload, hash, триггер), `dossier_snapshot_redactions`; `backend/src/graph/*`
  (ограниченный обход, загрузка рёбер из утверждений), `backend/src/snapshot/*` (canonical JSON и hash, сборка payload, доступность
  при выдаче, вымарывание, выгрузки MD/JSON/HTML); API `/graph`, `/cases/:id/snapshots`, `/snapshots/:id`, `/snapshots/:id/export.:format`,
  `/snapshots/:id/redactions`; флаг `GRAPH_EXPORT_ENABLED`; `GraphPanel` (SVG без библиотеки, таблица), `SnapshotsPanel`, `SnapshotPage` (ADR-011).
  Следующая миграция — 021.

## Принятые решения
ADR-001…ADR-011. Offsets — code points. Решения аналитика append-only и не удаляются переразбором.
Публикация снимает только вклад своей публикации (evidence → superseded). Completed — только при полном покрытии.
Legacy apply и `clearDocumentContribution` не возвращать. Слияние — только `resolve/entityMerge.ts`; новая ссылка на компанию/объект → в перенос и `dependencyState`.

## Что проверено (среда агента)
typecheck/build backend и frontend, unit 29 файлов / 421 тест — PASS.

## Что НЕ проверено
Живые сайты и каналы, живой бот (допуска и токена нет); печать снимка в PDF; качество Qwen3-8B на extract@3;  реальный LLM-smoke; визуальные проверки 390 px.

## Остаточные риски
Метрики светофора по legacy-таблицам (этап 07); отзыв права ИИ не снимает опубликованное; UI для запусков и
очереди неоднозначностей нет; решения аналитика при слиянии не переносятся (нужен пересмотр).

## Безопасность
Рабочая база не подключалась; 010–014/backfill/переразбор/слияния к ней не применялись; `.env` не трогался; источники не включались.

## Следующий шаг
Этап `stages/STAGE_09_LOCAL_RELEASE.md`: читать COMMON_RULES, ADR-001…ADR-011, `TESTING_LOCAL.md`,
`backend/src/db/migrate.ts`, миграции 001–020, `package.json` обоих пакетов, `frontend/vite.config.ts`.

## Запреты
Не писать в рабочую БД; не включать MERGE_APPLY_ENABLED на рабочей базе без backup; не подключать источники/облачную модель;
не редактировать `.env`; не запускать Docker в среде агента.

## Что прочитать новой сессии
`prompts/Customer_Dossier_Prompts/COMMON_RULES.md`, `docs/development/STATE.md`, этот HANDOFF, `stages/08B_REPORT.md`, ADR-011,
`TESTING_LOCAL.md`; ключевые файлы: `backend/src/snapshot/*.ts`, `backend/src/graph/*.ts`, `docs/migrations/020_dossier_snapshots.sql`, `frontend/src/pages/SnapshotPage.tsx`.
