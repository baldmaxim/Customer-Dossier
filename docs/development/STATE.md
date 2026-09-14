# Customer Dossier — состояние развития

Обновлено: 2026-09-14 (+02:00). Текущий этап: **03A**. Статус: **IN_PROGRESS — ждёт прогона пользователя** (TESTING_LOCAL A5, E).
Последний этап с пройденными core-gates: 02 (прогон пользователя, `evidence/02/USER_RUN.md`; 01 подтверждён там же, раздел D).
Порядок работы: после этапа — отчёт, commit, push в `dossier-stages`; проверки с Docker — пауза и прогон пользователя.

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0 (у пользователя Node v24.13.0).
Ветка: `dossier-stages` (origin). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml` или запасной `docker run`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД не изменялась; не идентифицирована. Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/03A_REPORT.md` (00–02 — там же). Handoff: `docs/development/HANDOFF.md`.
ADR: `ADR-001-local-operator-and-source-policy.md`, `ADR-002-source-items-and-revisions.md`, `ADR-003-assertions-evidence-reviews.md`.
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Результаты прогонов: `docs/development/evidence/02/USER_RUN.md`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (+ блокировка `pipeline/guard.ts`), `METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`,
`HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`.

## Уровни готовности

LOCAL_FIXTURE_READY: нет. LOCAL_MODEL_VALIDATED: не проверено. LIVE_SOURCE_VALIDATED: нет. Production: не входит.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–012, backfill); массовый reextract/renormalize/merge; включение источников;
изменение `.env`; облачное размещение — без отдельного согласования. Commit/push в `dossier-stages` — разрешены пользователем.

## Что осталось и следующая безопасная операция

Получить результат прогона TESTING_LOCAL (A5, E); исправить найденное; закрыть 03A (PASS), commit/push;
затем `stages/STAGE_03B_SAFE_REPROCESSING.md`.
