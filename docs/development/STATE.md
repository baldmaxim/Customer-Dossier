# Customer Dossier — состояние развития

Обновлено: 2026-09-14 13:45 (+02:00). Текущий этап: **01**. Статус: **PASS**.
Последний этап с пройденными core-gates: 01. Отдельное разрешение на этап 02: **нет** (ждёт сообщения пользователя).

## Фактическая среда

OS/shell/Node: Windows 10 Pro 19045, PowerShell 5.1 + Git Bash, Node v24.14.1, npm 11.11.0.
HEAD: `6431a5b` (`main`); изменения этапов 00–01 не закоммичены.
Test target: `127.0.0.1:55433/tg_info_test` с маркером `tg_info:test-target` (guard `backend/src/db/testTarget.ts`). Поднимает пользователь у себя: `backend/test-db/docker-compose.yml`, шаги — `docs/development/TESTING_LOCAL.md`. Контейнер в среде агента остановлен.
Рабочая БД не изменялась: да (не подключалась). Где она — не установлено (`DATABASE_URL` не задан; на :5432 чужой `quantor-postgres`).
Модель runtime: не проверялась (LM Studio не запущен).

## Последние артефакты

Report: `docs/development/stages/01_REPORT.md` (и `00_REPORT.md`). Review: нет. Handoff: `docs/development/HANDOFF.md`.
ADR: `docs/development/ADR-001-local-operator-and-source-policy.md`. Patch coverage: `PATCH_COVERAGE.md`. Backlog: `BACKLOG.md`.
Логи: `docs/development/evidence/00/`, `docs/development/evidence/01/`.

## Активные флаги (значения по умолчанию в коде)

`INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (и заблокирован константой в `pipeline/guard.ts`), `METRICS_AUTO_REFRESH=false`,
`BOT_ENABLED=false`, `HOST=127.0.0.1`. Фактический `backend/.env` пользователя отсутствует.
Блокировки канона: проход воркера, apply/clear, reextract, retry, retry-skipped, renormalize/recheck без `--dry`, merge, удаление источника с документами.

## Уровни готовности

LOCAL_FIXTURE_READY: нет (этапы 02–09 впереди). LOCAL_MODEL_VALIDATED: не проверено. LIVE_SOURCE_VALIDATED: нет. Production: не входит.

## Неразрешённые действия

Запись в рабочую БД, включая миграцию 010; массовый backfill/reextract/renormalize/merge; включение источников и живой `--probe`;
изменение секретов и `.env`; Git commit/push/merge/stash; облачное размещение — запрещены без отдельного согласования.

## Что осталось и следующая безопасная операция

Этап 01 завершён. Следующий промт — `prompts/Customer_Dossier_Prompts/stages/STAGE_02_DOCUMENT_REVISIONS.md`, только по сообщению пользователя.
Ручные проверки пользователем (не блокируют 02): вход и админка в браузере; Cache Storage без `api`.
Для работы на рабочих данных (не требуется для 02): определить рабочую базу, backup, согласовать миграцию 010.
