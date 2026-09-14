# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и конкретных обращений (рынок РФ). Код — `TG_Info` (Express+TS+pg, React+Vite). План — `prompts/Customer_Dossier_Prompts/` (этапы 00–09, строго по одному).

## Текущее состояние
Этап 01 — PASS, 2026-09-14. Корень `Odintsov/TG_Info`, HEAD `6431a5b`, все изменения 00–01 не закоммичены (commit не разрешён). Проверить при открытии: `git status`, `docker ps --filter name=tg-info-test-db`.

## Уже сделано
- 00: baseline, PATCH_COVERAGE, BACKLOG (`docs/development/stages/00_REPORT.md`).
- 01 (`docs/development/stages/01_REPORT.md`):
  - запуск без фоновых заданий, флаги (`backend/src/jobs.ts`, `config/env.ts`, `config/parse.ts`), loopback;
  - вход оператора, сессия, CSRF, Host/Origin (`backend/src/api/auth.ts`, `operatorToken.ts`, `app.ts`); экран входа (`frontend/src/pages/LoginPage.tsx`, `hooks/useSession.ts`);
  - сетевой клиент источников (`backend/src/net/safeFetch.ts`, `addressPolicy.ts`);
  - допуск источников: миграция `docs/migrations/010_source_policy.sql`, gate `backend/src/ingest/policy.ts`, UI `frontend/src/components/SourcePolicyEditor.tsx`;
  - блокировка изменения канона `backend/src/pipeline/guard.ts`;
  - migrate dry-run без DDL, 009 под `--allow-destructive`;
  - тестовая изоляция: `src/db/testTarget.ts`, `vitest.integration.config.ts`, `src/__tests__/integration/`;
  - адресно R01, R02, R04, R05, R06/B-15, R18, R19, R20, R12, R14; PWA без кэша API и внешних шрифтов; legacy-метка светофора;
  - точечные правки CLAUDE.md/README/USAGE.

## Принятые решения
ADR-001 (`docs/development/ADR-001-local-operator-and-source-policy.md`): один оператор, серверная сессия; `access_status`/`ai_processing_status` + журнал; `safeFetch` — единственный клиент источников, LM Studio отдельно; блокировка канона константой. Single writer.

## Последние изменения
57 изменённых и ~30 новых файлов (см. таблицу в 01_REPORT). `backend/package-lock.json`: исправлена одна битая запись. Тестовая база — `backend/test-db/docker-compose.yml` (у пользователя). Вне репозитория: `backend/.local/operator-token` (git-ignore); остановленный контейнер `tg-info-test-db` в среде агента.

## Что проверено
typecheck backend/frontend — PASS; build backend/frontend — PASS; unit 267/267 (и с внешним DATABASE_URL); integration PostgreSQL 34/34; smoke запуска (TC-001) с одобренным источником; CLI-gates; миграции CLI на пустой схеме; HTTP-сценарий UI→Vite-прокси→API. Логи: `docs/development/evidence/01/`.

## Что НЕ проверено
UI в браузере и очистка старых SW-кэшей (нет браузера); реальная LM Studio; живые источники; рабочая БД (не идентифицирована, миграция 010 не применялась).

## Безопасность
Тестовая цель: `postgresql://tg_test:***@127.0.0.1:55433/tg_info_test` (маркер обязателен). Рабочая база не изменялась, источники не включались, `.env` не трогался, секреты не выводились.

## Следующий шаг
Дождаться сообщения пользователя с промтом `stages/STAGE_02_DOCUMENT_REVISIONS.md`. Первая операция 02: прочитать COMMON_RULES, STATE, этот HANDOFF, 01_REPORT, `reference/DATA_CONTRACTS.md` (SourceItem/DocumentRevision), затем `backend/src/ingest/store.ts` — единственная точка записи документов (вызывают `scheduler.ts`, `telegramBot.ts`, `api/manual.routes.ts`). Номер следующей миграции — 011.

Порядок работы (указание пользователя 2026-09-14): после каждого этапа — отчёт, commit и push, затем следующий этап.
Docker и DB/интеграционные проверки агент не запускает: пишет инструкцию (как `docs/development/TESTING_LOCAL.md`),
делает паузу, пользователь прогоняет и присылает результат.

Тесты у агента — только без базы:
```bash
cd backend && npm run typecheck && npm test
```

## Запреты
Не делать commit/push/reset/merge/stash; не писать в рабочую БД и не применять к ней 010; не снимать блокировки `pipeline/guard.ts` вне этапов 03B/04; не подключать новые источники/облачную модель; не редактировать `.env`; не переходить к следующему stage без сообщения пользователя.

## Что прочитать новой сессии
`prompts/Customer_Dossier_Prompts/COMMON_RULES.md`, `docs/development/STATE.md`, текущий stage prompt, этот HANDOFF, `docs/development/stages/01_REPORT.md`, `ADR-001`, `PATCH_COVERAGE.md`, `BACKLOG.md`; ключевые файлы: `backend/src/ingest/store.ts`, `ingest/policy.ts`, `pipeline/guard.ts`, `db/migrate.ts`, `db/testTarget.ts`, `docs/migrations/003_raw_documents.sql`, `010_source_policy.sql`, `TG_Info/CLAUDE.md`.
