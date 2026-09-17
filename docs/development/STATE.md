# Customer Dossier — состояние развития

Обновлено: 2026-09-16 (+02:00). Текущий пакет: **`prompts/TG_Info_Next_Stages_2026-09-16/` (этапы 10–19)**, указание пользователя 2026-09-16 — пройти 10→19 подряд, коммит после каждого этапа; пользовательские проверки копятся в `evidence/NN/USER_RUN.md`.

## Пакет 10–19

| Этап | Код агента | Пользователь | Отчёт |
|---|---|---|---|
| 10 | IMPLEMENTED (основа — закрытие 09; +timeout выборки bench, выравнивание CLAUDE/README) | T10-04/05/07/08 PASS в прогоне 09; остальное NOT_RUN | `stages/10_REPORT.md` |
| 11 | IMPLEMENTED: execution-identity@1, сверка конфигурации до вызова, допуск и аренда перед каждым вызовом; миграция 021 | NOT_RUN (`evidence/11/USER_RUN.md`) | `stages/11_REPORT.md` |
| 14A | IMPLEMENTED: current-eval@1 (путь конвейера, общий классификатор ответа, план проверок до модели, replay/compare/import-legacy, разбиение по происхождению); legacy --shadow/--compare только с --legacy | REAL_MODEL NOT_RUN (`evidence/14A/USER_RUN.md`); reference-fact scoring — 14B | `stages/14A_REPORT.md` |
| 13 | IMPLEMENTED: snapshot-request@1 (409 на чужой ключ, конкурентный повтор), чтение сигналов в транзакции снимка, редакция основания в сигналах, coverage@1 фактов и схемы, dossier-snapshot@2; миграция 022 | NOT_RUN (`evidence/13/USER_RUN.md`) | `stages/13_REPORT.md` |
| 12 | IMPLEMENTED: scope-match@1, dossier-template@2 (роль/цепочка/противоречия по объекту, корпусу, работам, роли, дате; контекст и scope_unknown), схема связей тем же правилом | NOT_RUN (`evidence/12/USER_RUN.md`) | `stages/12_REPORT.md` |

Этап 09 — исторический статус: **PASS (core-gates)** (прогон пользователя, evidence/09/USER_RUN.md; PRINT_PDF=NOT_RUN). Закрытие приёмки по усиленным условиям: **PASS (core-gates)** — прогон пользователя 2026-09-16 (`evidence/09/USER_RUN_CLOSURE.md`, `CLOSURE_MATRIX.md`); печать в PDF, 390 px и Cache Storage — NOT_RUN. Этап 10 не открыт. Пакет этапов закрыт. LIVE_SOURCE=NOT_RUN. LOCAL_MODEL (синтетика, qwen3-8b): safety 24/25, recall 3/9 — переразбор рабочей базы на extract@3 не начинать.
Последний этап с пройденными core-gates: 09 (прогоны пользователя: `evidence/02`, `03A`, `03B`, `04`, `05A`, `05B`, `06`, `07`, `08A`, `08B`, `09`).
Порядок работы: после этапа — отчёт, commit, push в `main`; проверки с Docker — пауза и прогон пользователя.

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0 (у пользователя Node v24.13.0).
Ветка: `main` (origin; `dossier-stages` влита fast-forward и удалена 2026-09-16). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml` или запасной `docker run`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД не изменялась; не идентифицирована. Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/09_REPORT.md` (раздел «Закрытие приёмки»; 00–08B — там же). Manifest: `CONTENT_MANIFEST.md`. Эксплуатация: `LOCAL_RUNBOOK.md`, готовность: `RELEASE_READINESS.md`. Handoff: `docs/development/HANDOFF.md`.
ADR: ADR-001 (оператор, допуск источников), ADR-002 (публикации и редакции), ADR-003 (утверждения и решения),
ADR-004 (запуски извлечения и публикация наборов), ADR-005 (идентичность и безопасное слияние), ADR-006 (адаптеры сайтов), ADR-007 (Telegram: курсоры, журнал бота), ADR-008 (смысл связей, время, события), ADR-009 (объяснимые сигналы), ADR-010 (обращения и рабочее досье), ADR-011 (схема связей, снимки, выгрузки).
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Результаты прогонов: `docs/development/evidence/*/USER_RUN.md`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (новый конвейер 03B), `REPROCESS_AUTO_PUBLISH=false`,
`MERGE_APPLY_ENABLED=false`, `EXTRACT_SCHEMA_VERSION=extract@3` (новые запуски), `METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`, `HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`, `GRAPH_EXPORT_ENABLED=true`; фронтенд — `VITE_DOSSIER_UI` (включено).
Legacy apply заблокирован в `pipeline/guard.ts`; слияние — безопасный путь за флагом.

## Уровни готовности

LOCAL_FIXTURE_READY: да (core-gates по усиленным условиям закрытия приёмки, 2026-09-16). LOCAL_MODEL_VALIDATED: нет (полнота 3/9 на extract@3). LIVE_SOURCE_VALIDATED: нет, перечень пуст. Production: не заявляется. Подробно — `RELEASE_READINESS.md`.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–020, пересчёт сигналов, backfill, переразбор, публикация, слияние); массовый reextract/renormalize/merge;
включение источников; изменение `.env`; облачное размещение — без отдельного согласования.
Commit/push в `main` — разрешены пользователем.

## Что осталось и следующая безопасная операция

**Следующее действие агента:** следующий этап пакета 10–19 по таблице выше. **Пользователя:** прогоны `evidence/10…/USER_RUN.md` на итоговом коде (можно пакетом в конце). По желанию: повторить `release:probe` новой версией (JSON без `availability.checkedAt`) и визуальный проход (PDF, 390 px, Cache Storage). Отдельно: разобрать нарушение safety и промахи полноты по `benchmark-06.json` (у пользователя).
