# Customer Dossier — состояние развития

Обновлено: 2026-09-21 (вечер).

## Упрощение портала (решение владельца 21.09.2026)

Портал сузился до трёх задач: **сбор из Telegram и с сайтов, быстрый поиск последнего, связи
компаний между собой.** Восемь коммитов, каждый с зелёными `typecheck`, `npm test` в обоих
пакетах, `build` и `check:build`.

| Что | Итог |
|---|---|
| Вход по токену | Удалён целиком (код, тесты, документация). Остались loopback-, Host- и Origin-гарды в `api/guards.ts`. **Старые baseline `release:manifest` несравнимы — перевыпустить** |
| Обращения, досье обращения, снимки | Убраны из интерфейса. Бэкенд, маршруты и таблицы целы, дампы сравнимы, тесты бэкенда не тронуты. Флага `VITE_DOSSIER_UI` больше нет |
| Дизайн-система | Шкалы `--sp-*`, `--fs-*`, `--ctl-*`, `--gutter`, `--prose`, `--z-*` в `index.css`; примитивы `components/ui/` (Button, Segmented, Badge, Section, EmptyState, TableScroll, Hint, Term); подсказки по наведению, фокусу и тапу без внешних библиотек |
| Ширина | Каркас во всю ширину экрана, поля 16–24px; ограничения переехали на блоки. Карточка компании с 1200px — две колонки |
| Наезды текста | Вредный `nowrap` один (`.dim` в админке), фиксированные высоты → `min-height`, таблица досье с переносом, шесть сеток с `minmax(0, …)`, снят нерабочий sticky |
| Брейкпоинты | Шесть → три (640 / 768 / 1200), только `min-width` |
| Админка | Конвейер `/admin` (обзор) → `/admin/collect` → `/admin/process[/:id]` → `/admin/result`, плюс `/admin/review`. `AdminPage` на 453 строки разрезана. `/runs` и `/review` — постоянные редиректы |
| Главная | Каталог всех компаний с фильтром по роли, сортировкой, поиском и лентой «Последнее» (`GET /api/feed`) |
| Связи | `GET /graph` вынесен в `api/graph.routes.ts` с флагом `GRAPH_ENABLED`; экран `/links` — один центр в адресе, клик по узлу перецентровывает, границы обхода названы |
| Автопубликация | `INGEST_ENABLED`, `PIPELINE_ENABLED`, `METRICS_AUTO_REFRESH`, `REPROCESS_AUTO_PUBLISH` = true. Проверки не ослаблены. Починен дефект: отказ публикации больше не выглядит падением запуска. Журнал — `GET /api/reprocess/publications` и ступень «Результат» |
| Подписи | Словари видов утверждений, чанков, статусов источника и документов; `npm run check:labels` ловит сырые машинные ключи |

**Не проверено агентом:** e2e Playwright (запускает пользователь), живой прогон сбора и модели,
поведение автопубликации на рабочей базе. Тесты бэкенда 606/606, фронтенда 26/26 — зелёные.

Прежняя запись: Текущий пакет: **`prompts/TG_Info_Next_Stages_2026-09-16/` (этапы 10–19)**, указание пользователя 2026-09-16 — пройти 10→19 подряд, коммит после каждого этапа; пользовательские проверки копятся в `evidence/NN/USER_RUN.md`.

## Пакет 10–19

| Этап | Код агента | Пользователь | Отчёт |
|---|---|---|---|
| 10 | IMPLEMENTED (основа — закрытие 09; +timeout выборки bench, выравнивание CLAUDE/README) | T10-04/05/07/08 PASS в прогоне 09; остальное NOT_RUN | `stages/10_REPORT.md` |
| 11 | IMPLEMENTED: execution-identity@1, сверка конфигурации до вызова, допуск и аренда перед каждым вызовом; миграция 021 | NOT_RUN (`evidence/11/USER_RUN.md`) | `stages/11_REPORT.md` |
| 19 | PILOT_NOT_RUN: pilot-manifest@1 и pilot-gate@1 (`npm run pilot:check`), готовность по компонентам, решение, маршрут проверки человеком, остановки, копия/хранение/обновление; миграций нет | NOT_RUN (`evidence/19/USER_RUN.md`); нет манифеста и источников | `stages/19_REPORT.md` |
| 18 | IMPLEMENTED (инструменты): компонентные тесты фронтенда (vitest+jsdom, 14), E2E Playwright (6 сценариев × desktop/390 px), профиль SQL в release:bench (--profile-queries, p95 при 20+, --case-id), seed:test-large; оптимизаций нет — ждут EXPLAIN пользователя; миграций нет | NOT_RUN (`evidence/18/USER_RUN.md`) | `stages/18_REPORT.md` |
| 17 | IMPLEMENTED: negotiation-brief@1 в dossier-template@3 (разделы вокруг вопроса обращения, статус словами, scope, свежесть, происхождение публикаций, новая редакция, ограничения данных), выгрузки с тем же блоком, стрелка и легенда схемы, seed:test-brief (3 обращения); миграций нет | NOT_RUN (`evidence/17/USER_RUN.md`) | `stages/17_REPORT.md` |
| 16 | READY_FOR_OPERATOR_CONFIG: source-profile@1 (meta профиля, допуск не выдаёт, префиксы пути), source-health@1 (6 состояний, полнота истории неизвестна), реестр возможностей, остановка цикла пагинации, --telegram-profile, шаблоны и runbook; миграций нет | NOT_RUN (`evidence/16/USER_RUN.md`); LIVE_SOURCE_VALIDATED пусто | `stages/16_REPORT.md` |
| 15B | IMPLEMENTED: рабочее место запусков (список с фильтрами и курсором, карточка: чанки, ответы, кандидаты с цитатами, цепочка повторов, in-flight), точечные enqueue/retry/cancel, publish-preview@1 (409 preview_stale, 422 неполный запуск, nextStep); миграций нет | NOT_RUN (`evidence/15B/USER_RUN.md`) | `stages/15B_REPORT.md` |
| 15A | IMPLEMENTED: решение по одному упоминанию (ambiguity-decision@1, 422 против реквизита/формы, 409 версия, повтор), резолвер analyst_mapping только для той же редакции, merge-preview@1 (409 stale), линия решений без дублей; UI разбора с пагинацией; миграция 023 | NOT_RUN (`evidence/15A/USER_RUN.md`) | `stages/15A_REPORT.md` |
| 14B | IMPLEMENTED (инфраструктура): реестр экспериментов, вариант промта recall-a@1 только для оценки, причины пропусков, 24 предложенных кейса без оценки; решение PENDING | USER_RUN_REQUIRED (`evidence/14B/USER_RUN.md`), LOCAL_MODEL_VALIDATED = нет | `stages/14B_REPORT.md` |
| 14A | IMPLEMENTED: current-eval@1 (путь конвейера, общий классификатор ответа, план проверок до модели, replay/compare/import-legacy, разбиение по происхождению); legacy --shadow/--compare только с --legacy | REAL_MODEL NOT_RUN (`evidence/14A/USER_RUN.md`); reference-fact scoring — 14B | `stages/14A_REPORT.md` |
| 13 | IMPLEMENTED: snapshot-request@1 (409 на чужой ключ, конкурентный повтор), чтение сигналов в транзакции снимка, редакция основания в сигналах, coverage@1 фактов и схемы, dossier-snapshot@2; миграция 022 | NOT_RUN (`evidence/13/USER_RUN.md`) | `stages/13_REPORT.md` |
| 12 | IMPLEMENTED: scope-match@1, dossier-template@2 (роль/цепочка/противоречия по объекту, корпусу, работам, роли, дате; контекст и scope_unknown), схема связей тем же правилом | NOT_RUN (`evidence/12/USER_RUN.md`) | `stages/12_REPORT.md` |

Этап 09 — исторический статус: **PASS (core-gates)** (прогон пользователя, evidence/09/USER_RUN.md; PRINT_PDF=NOT_RUN). Закрытие приёмки по усиленным условиям: **PASS (core-gates)** — прогон пользователя 2026-09-16 (`evidence/09/USER_RUN_CLOSURE.md`, `CLOSURE_MATRIX.md`); печать в PDF, 390 px и Cache Storage — NOT_RUN. Пакет 10–19 после этого реализован и принят до C1b (разделы выше). LIVE_SOURCE=NOT_RUN. LOCAL_MODEL (синтетика, qwen3-8b): safety 24/25, recall 3/9 — переразбор рабочей базы на extract@3 не начинать.
Последний этап с пройденными core-gates: 09 (прогоны пользователя: `evidence/02`, `03A`, `03B`, `04`, `05A`, `05B`, `06`, `07`, `08A`, `08B`, `09`).
Порядок работы: после этапа — отчёт, commit, push в `main`; проверки с Docker — пауза и прогон пользователя.

## Приёмка 10–19 (пакет `prompts/TG_Info_Acceptance_10-19_2026-09-17/`)

Проведена 17–21.09 по `docs/development/evidence/acceptance_10_19/` (`COVERAGE.md` — AC-01…AC-44,
`USER_RUN_CONSOLIDATED.md` — маршрут, `DECISION_DRAFT.md` — статусы и дефекты). Точка кода — `11e88af`.

| Шаг | Итог |
|---|---|
| A0–A3 (офлайн) | PASS: typecheck, build, unit backend 619/619, frontend 14/14, `check:build`, аудит зависимостей |
| B0 | PASS: guard тестовой цели, отрицательные контроли — exit 1 |
| B1 | PASS на `09f0c93`: интеграция 19 файлов, 239/239, 0 skipped |
| B2 | PASS по данным: апгрейд 020→023 на непустой базе, расхождения только ожидаемые; снимков и решений в данных не было |
| B3 | PASS: дамп/restore → `release:manifest --compare` MATCH; негативный контроль — MISMATCH, exit 1 |
| B4 | PASS: приложение на копии, `release:probe --compare` совпал, запись после restore без конфликта последовательностей |
| C1a | PASS на `ef1bece`: Playwright 12/12 (desktop и phone-390) |
| C1b, C2, C3, D1, D2, E | NOT_RUN — остановка по решению владельца 21.09 (приоритет: рабочая версия) |

Дефекты, найденные приёмкой и исправленные: ACC-04 (`query parser = simple`), ACC-05 (отпечаток запуска от порядка
ключей JSONB — все запуски уходили в `blocked`), ACC-06 (тест с кириллическим курсором), ACC-07 (после «Выйти» досье
оставалось на экране), ACC-08 (`/admin` шире окна на 390 px), ACC-09 (hash в HTML-выгрузке не переносился).
Открыты: ACC-01 (отпечаток не включает шаблоны, читаемые тестами), ACC-02 (нет автотеста апгрейда 020→023),
ACC-03 (`pilot:check` без preflight), OBS-01 (параллельные `client.query` на одном клиенте — сломается на `pg@9`),
sharp 0.34.5 (генератор иконок держим выключенным).

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0 (у пользователя Node v24.13.0).
Ветка: `main` (origin; `dossier-stages` влита fast-forward и удалена 2026-09-16). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml` или запасной `docker run`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД (21.09.2026): контейнер `tg-info-pg`, `127.0.0.1:5434/tg_info`, роль `tg_info` — поднята пользователем,
агент к ней не подключался. Схема была на 009; применены миграции 010–023, затем переносы `backfill:revisions`
(255 публикаций, 256 редакций и наблюдений; 1 помеченная неоднозначность порядка) и `backfill:assertions`
(382 утверждения, 418 доказательств; 42 строки без найденной цитаты и 2 с неоднозначной цитатой утверждениями не стали),
`metrics:refresh` (снимок сигналов #1, 105 компаний). `backfill:identity --renormalize --dry` показал 0 расхождений — не применялся.
Копии: `before-backfill.dump` (проверена восстановлением, manifest MATCH) и `after-backfill.dump`.
Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/09_REPORT.md` (раздел «Закрытие приёмки»; 00–08B — там же). Manifest: `CONTENT_MANIFEST.md`. Эксплуатация: `LOCAL_RUNBOOK.md`, первый настоящий прогон: `FIRST_REAL_DOSSIER.md`, готовность: `RELEASE_READINESS.md`. Handoff: `docs/development/HANDOFF.md`.
ADR: ADR-001 (оператор, допуск источников), ADR-002 (публикации и редакции), ADR-003 (утверждения и решения),
ADR-004 (запуски извлечения и публикация наборов), ADR-005 (идентичность и безопасное слияние), ADR-006 (адаптеры сайтов), ADR-007 (Telegram: курсоры, журнал бота), ADR-008 (смысл связей, время, события), ADR-009 (объяснимые сигналы), ADR-010 (обращения и рабочее досье), ADR-011 (схема связей, снимки, выгрузки).
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Результаты прогонов: `docs/development/evidence/*/USER_RUN.md`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=true`, `PIPELINE_ENABLED=true` (новый конвейер 03B), `REPROCESS_AUTO_PUBLISH=true`,
`METRICS_AUTO_REFRESH=true` — поток «сбор → разбор → публикация» идёт сам (решение владельца 21.09.2026).
`MERGE_APPLY_ENABLED=false`, `BOT_ENABLED=false`, `EXTRACT_SCHEMA_VERSION=extract@3` (новые запуски),
`HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`, `GRAPH_ENABLED=true`, `GRAPH_EXPORT_ENABLED=true`.
Вход по токену снят; флага `VITE_DOSSIER_UI` больше нет — обращения и снимки убраны с портала.
Legacy apply заблокирован в `pipeline/guard.ts`; слияние — безопасный путь за флагом.

## Уровни готовности

LOCAL_FIXTURE_READY: да (core-gates 2026-09-16; приёмка 10–19 A0–C1a на `11e88af`, 21.09). LOCAL_MODEL_VALIDATED: нет (полнота 3/9 на extract@3). LIVE_SOURCE_VALIDATED: нет, перечень пуст. Production: не заявляется. Подробно — `RELEASE_READINESS.md`.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–020, пересчёт сигналов, backfill, переразбор, публикация, слияние); массовый reextract/renormalize/merge;
включение источников; изменение `.env`; облачное размещение — без отдельного согласования.
Commit/push в `main` — разрешены пользователем.

## Что осталось и следующая безопасная операция

**Пакет 10–19 завершён (2026-09-17); приёмка остановлена на C1b (21.09).** 21.09 отдельной задачей починен первый
пользовательский маршрут: ручная вставка сохраняет публикацию с метаданными, первый запуск ставится из интерфейса
по конкретной редакции, «Запуски» есть в навигации; порядок первого прогона — `FIRST_REAL_DOSSIER.md`, запуск портала —
`start-portal.ps1`. Готовность этим не повышается: прогон на настоящем источнике и модели — за пользователем.
**Следующее действие агента:** нет — ждать задачи
или логов пользователя. При возобновлении приёмки — C1b по `evidence/acceptance_10_19/USER_RUN_CONSOLIDATED.md`. **Пользователя:** прогоны `evidence/10…/USER_RUN.md` на итоговом коде (можно пакетом в конце). По желанию: повторить `release:probe` новой версией (JSON без `availability.checkedAt`) и визуальный проход (PDF, 390 px, Cache Storage). Отдельно: разобрать нарушение safety и промахи полноты по `benchmark-06.json` (у пользователя).
