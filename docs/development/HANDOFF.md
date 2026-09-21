# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и обращений (рынок РФ). Код — `TG_Info`. План — `prompts/Customer_Dossier_Prompts/` (00–09).

## Текущее состояние (21.09.2026)
Этапы 10–19 в коде. Приёмка 10–19: A0–A3, B0–B4, C1a — PASS с логами пользователя; C1b, C2, C3, D1, D2, E — NOT_RUN.
Исправлены ACC-04…ACC-09; открыты ACC-01…ACC-03, OBS-01, sharp. Подробно — `evidence/acceptance_10_19/DECISION_DRAFT.md`.
PRODUCTION_READY не заявляется. Стенд пользователя: `tg_info_test` содержит синтетику и снимки от E2E; после приёмки
остались worktree `..\tg-info-020`, базы `tg_info_test_upgrade` и `tg_info_test_restore_1019` — можно удалить.

### История до пакета 10–19
Этапы 02–06 — PASS по core-gates. Замер qwen3-8b на extract@3: safety 24/25, recall 3/9 — переразбор рабочей базы не начинать. 07 — PASS. 08A — PASS по core-gates (интеграция 16 файлов / 173, L через API; визуальный проход NOT_RUN). 08B — PASS по core-gates (интеграция 17 файлов / 182, M1–M6; печать в PDF NOT_RUN). 09 — PASS по core-gates (интеграция 18 файлов / 196, N1–N8, копия восстановлена и совпала по количествам; печать в PDF NOT_RUN). **Закрытие приёмки 09 (2026-09-16): PASS (core-gates) по усиленным условиям** — прогон пользователя: unit 35/497, интеграция 19/210, restore `release:manifest` MATCH, перезапуск процесса, отказ БД, bench; PDF/390 px/Cache Storage NOT_RUN. Фикс `assertion_company_merged` — `c289cb1`. Пакет `prompts/TG_Info_Next_Stages_2026-09-16/` (этапы 10–19) **реализован в коде 2026-09-17** (`8b1a944`…итог 19): отчёты `stages/10…19_REPORT.md`, формы прогонов `evidence/10…19/USER_RUN.md` — все NOT_RUN у пользователя; миграции 021–023; пилот PILOT_NOT_RUN (`pilot/`). Статусы готовности не повышались.
Ветка `main` (`dossier-stages` удалена). Проверить при открытии: `git log --oneline -5`, `git status`.

## Порядок работы (указание пользователя 2026-09-14)
После каждого этапа: отчёт → commit (русский, 1–2 предложения, без Co-Authored-By) → push `origin main` → следующий этап.
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
- 09: сквозная приёмка без новых миграций — `backend/src/release/*` (контрольные числа и связность, замеры,
  CLI `release:check` / `release:bench`), `--upto` у раннера миграций, seed `seed:test-release`,
  сквозной тест `release/release.int.test.ts`; `LOCAL_RUNBOOK.md`, `RELEASE_READINESS.md`, BACKLOG с severity.

- Закрытие приёмки 09: общий preflight записи в тестовую цель `db/testTargetBootstrap.ts` (тесты, сиды, bench, `migrate --upto`);
  `release:check` → `local-inventory@2`; содержательный `release:manifest` (`content-manifest@1`, `CONTENT_MANIFEST.md`);
  валидный `release:bench` (`benchCli.ts`, `--pipeline-synthetic`); `release:probe` (перезапуск процесса), `release:fingerprint`;
  решения до слияния видны в досье (`dossier/facts.ts::loadPriorDecisions`, поле `priorDecisions`), без переноса;
  `frontend: npm run check:build`; порядок backup/restore — `LOCAL_RUNBOOK.md` §5.

## Принятые решения
ADR-001…ADR-011. Offsets — code points. Решения аналитика append-only и не удаляются переразбором.
Публикация снимает только вклад своей публикации (evidence → superseded). Completed — только при полном покрытии.
Legacy apply и `clearDocumentContribution` не возвращать. Слияние — только `resolve/entityMerge.ts`; новая ссылка на компанию/объект → в перенос и `dependencyState`.

## Что проверено (среда агента)
Закрытие приёмки 09: typecheck/build backend, unit 35 файлов / 497 (`--maxWorkers=2`), сборка фронтенда и `check:build` с маркерами — PASS, логи `evidence/09/closure/`. Ранее: unit 29 / 421; у пользователя позже 405 + 1 файл OOM (BLOCKED_ENV).

## Что НЕ проверено
Печать снимка в PDF, 390 px и Cache Storage в браузере (закрытие 09 — NOT_RUN); живые сайты и каналы, живой бот; качество Qwen3-8B на extract@3; реальный LLM-smoke; реальный disk-full.

## Остаточные риски
Метрики светофора по legacy-таблицам (этап 07); отзыв права ИИ не снимает опубликованное; UI для запусков и
очереди неоднозначностей нет; решения аналитика при слиянии не переносятся (нужен пересмотр).

## Безопасность
Рабочая база не подключалась; 010–014/backfill/переразбор/слияния к ней не применялись; `.env` не трогался; источники не включались.

## Следующий шаг
Этапы 10–19 реализованы; приёмка 10–19 остановлена владельцем 21.09 на шаге C1b (точка кода `11e88af`).
Варианты: возобновить с C1b по `evidence/acceptance_10_19/USER_RUN_CONSOLIDATED.md`; либо эксплуатация на синтетике
с выключенным фоном и источниками в `paused`. Пилот — только по манифесту (`npm run pilot:check`) и решению владельца.
21.09 починен первый пользовательский маршрут (ручная вставка с метаданными, постановка первого запуска по редакции
из интерфейса, «Запуски» в навигации, `start-portal.ps1`). Ближайшее — прогон пользователя по `FIRST_REAL_DOSSIER.md`
на отдельной постоянной базе: выбор источника, допуск, сбор, разбор, проверка, досье и снимок. Статусы
LOCAL_MODEL_VALIDATED и LIVE_SOURCE_VALIDATED от этого не меняются.

21.09 (задача владельца, не этап пакета): портал больше не предлагает публиковать — обработка идёт сама, из
интерфейса убраны постановка разбора, повтор, отмена и публикация набора; строки каталога и ленты кликаются
целиком; карточка компании считает `signals@2` и показывает плитки во всю ширину; у публикаций появилась тема
от локальной модели (`headline@1`, миграция 027); страница документа отвечает «что портал взял из этого текста»
(`GET /api/items/:id/extraction`). Подробности и что осталось пользователю — `STATE.md`.

## Запреты
Не писать в рабочую БД; не включать MERGE_APPLY_ENABLED на рабочей базе без backup; не подключать источники/облачную модель;
не редактировать `.env`; не запускать Docker в среде агента.

## Что прочитать новой сессии
`09_USER_ACCEPTANCE.md`, `prompts/TG_Info_Next_Stages_2026-09-16/README_START_HERE.md` и `COMMON_RULES.md`, `docs/development/STATE.md`, этот HANDOFF, `stages/09_REPORT.md`, `evidence/09/CLOSURE_MATRIX.md`, `evidence/09/USER_RUN_CLOSURE.md`, `CONTENT_MANIFEST.md`, `LOCAL_RUNBOOK.md`, `FIRST_REAL_DOSSIER.md`, `RELEASE_READINESS.md`, ADR-011,
`TESTING_LOCAL.md`; ключевые файлы: `backend/src/snapshot/*.ts`, `backend/src/graph/*.ts`, `docs/migrations/020_dossier_snapshots.sql`, `frontend/src/pages/SnapshotPage.tsx`.
