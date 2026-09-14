# Customer Dossier — состояние развития

Обновлено: 2026-09-14 (+02:00). Текущий этап: **02**. Статус: **IN_PROGRESS — ждёт прогона пользователя** (интеграционные тесты и UI).
Последний этап с пройденными core-gates: 01 (в среде агента; контрольный прогон у пользователя — TESTING_LOCAL, раздел D).
Порядок работы: после этапа — отчёт, commit, push в `dossier-stages`; проверки с Docker — пауза и прогон пользователя.

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0.
Ветка: `dossier-stages` (origin). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД не изменялась; не идентифицирована. Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/02_REPORT.md` (00, 01 — там же). Handoff: `docs/development/HANDOFF.md`.
ADR: `ADR-001-local-operator-and-source-policy.md`, `ADR-002-source-items-and-revisions.md`.
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Логи агента: `docs/development/evidence/`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (+ блокировка `pipeline/guard.ts`), `METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`,
`HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`.

## Уровни готовности

LOCAL_FIXTURE_READY: нет. LOCAL_MODEL_VALIDATED: не проверено. LIVE_SOURCE_VALIDATED: нет. Production: не входит.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–011, backfill); массовый reextract/renormalize/merge; включение источников;
изменение `.env`; облачное размещение — без отдельного согласования. Commit/push в `dossier-stages` — разрешены пользователем.

## Что осталось и следующая безопасная операция

Получить результат прогона TESTING_LOCAL (A–C) от пользователя; исправить найденное; закрыть 02 (PASS), commit/push;
затем `stages/STAGE_03A_ASSERTIONS_EVIDENCE.md`.
