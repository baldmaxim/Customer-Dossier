# Customer Dossier — состояние развития

Обновлено: 2026-09-15 (+02:00). Текущий этап: **05B**. Статус: **AWAITING_USER_RUN** (unit/build PASS в среде агента; интеграция и раздел I — у пользователя). LIVE_SOURCE=NOT_RUN.
Последний этап с пройденными core-gates: 05A (прогоны пользователя: `evidence/02`, `03A`, `03B`, `04`, `05A`).
Порядок работы: после этапа — отчёт, commit, push в `dossier-stages`; проверки с Docker — пауза и прогон пользователя.

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0 (у пользователя Node v24.13.0).
Ветка: `dossier-stages` (origin). Test target: `127.0.0.1:55433/tg_info_test` с маркером — поднимает пользователь
(`backend/test-db/docker-compose.yml` или запасной `docker run`, `docs/development/TESTING_LOCAL.md`). В среде агента Docker не используется.
Рабочая БД не изменялась; не идентифицирована. Модель runtime: не проверялась.

## Последние артефакты

Report: `docs/development/stages/05B_REPORT.md` (00–05A — там же). Handoff: `docs/development/HANDOFF.md`.
ADR: ADR-001 (оператор, допуск источников), ADR-002 (публикации и редакции), ADR-003 (утверждения и решения),
ADR-004 (запуски извлечения и публикация наборов), ADR-005 (идентичность и безопасное слияние), ADR-006 (адаптеры сайтов), ADR-007 (Telegram: курсоры, журнал бота).
Проверка у пользователя: `docs/development/TESTING_LOCAL.md`. Результаты прогонов: `docs/development/evidence/*/USER_RUN.md`.

## Активные флаги (по умолчанию)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (новый конвейер 03B), `REPROCESS_AUTO_PUBLISH=false`,
`MERGE_APPLY_ENABLED=false`, `METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`, `HOST=127.0.0.1`, `REVISION_WRITE_ENABLED=true`.
Legacy apply заблокирован в `pipeline/guard.ts`; слияние — безопасный путь за флагом.

## Уровни готовности

LOCAL_FIXTURE_READY: нет. LOCAL_MODEL_VALIDATED: не проверено. LIVE_SOURCE_VALIDATED: нет (approved-сайтов и каналов нет, токен бота не задавался агентом). Production: не входит.

## Неразрешённые действия

Запись в рабочую БД (миграции 010–016, backfill, переразбор, публикация, слияние); массовый reextract/renormalize/merge;
включение источников; изменение `.env`; облачное размещение — без отдельного согласования.
Commit/push в `dossier-stages` — разрешены пользователем.

## Что осталось и следующая безопасная операция

Прогон пользователя по `TESTING_LOCAL.md` (A1–A5, I); после PASS — `stages/STAGE_06_RELATIONS_EVENTS.md`.
