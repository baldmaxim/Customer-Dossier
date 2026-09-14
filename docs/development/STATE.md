# Customer Dossier — состояние развития

Обновлено: 2026-09-14 (+02:00). Текущий этап: **03B**. Статус: **PASS** (прогон пользователя, evidence/03B/USER_RUN.md); следующий — 04.
Последний этап с пройденными core-gates: 03B (прогоны пользователя: `evidence/02`, `evidence/03A`, `evidence/03B`).
Порядок работы: после этапа — отчёт, commit, push в `dossier-stages`; проверки с Docker — пауза и прогон пользователя.

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0 (у пользователя Node v24.13.0).
Ветка: `dossier-stages` (origin). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml` или запасной `docker run`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД не изменялась; не идентифицирована. Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/03B_REPORT.md` (00–03A — там же). Handoff: `docs/development/HANDOFF.md`.
ADR: ADR-001 (оператор, допуск источников), ADR-002 (публикации и редакции), ADR-003 (утверждения и решения),
ADR-004 (запуски извлечения и публикация наборов).
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Результаты прогонов: `docs/development/evidence/*/USER_RUN.md`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (новый конвейер 03B), `REPROCESS_AUTO_PUBLISH=false`,
`METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`, `HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`.
Legacy apply и слияние заблокированы в `pipeline/guard.ts`.

## Уровни готовности

LOCAL_FIXTURE_READY: нет. LOCAL_MODEL_VALIDATED: не проверено. LIVE_SOURCE_VALIDATED: нет. Production: не входит.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–013, backfill, переразбор, публикация); массовый reextract/renormalize/merge;
включение источников; изменение `.env`; облачное размещение — без отдельного согласования.
Commit/push в `dossier-stages` — разрешены пользователем.

## Что осталось и следующая безопасная операция

`stages/STAGE_04_IDENTITY_MERGE.md`.
