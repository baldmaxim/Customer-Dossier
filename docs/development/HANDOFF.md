# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и обращений (рынок РФ). Код — `TG_Info`. План — `prompts/Customer_Dossier_Prompts/` (00–09).

## Текущее состояние
Этапы 02, 03A, 03B — PASS (03B: интеграция 10 файлов / 103, раздел F, evidence/03B/USER_RUN.md). Следующий — 04.
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
  worker по `PIPELINE_ENABLED`, флаг `REPROCESS_AUTO_PUBLISH` (ADR-004). Следующая миграция — 014.

## Принятые решения
ADR-001…ADR-004. Offsets — code points. Решения аналитика append-only и не удаляются переразбором.
Публикация снимает только вклад своей публикации (evidence → superseded). Completed — только при полном покрытии.
Legacy apply, `clearDocumentContribution` и слияние не возвращать (слияние — этап 04).

## Что проверено (среда агента)
typecheck backend/frontend, build backend, unit 22 файла / 325 тестов — PASS.

## Что НЕ проверено
Реальный LLM-smoke; визуальные проверки 390 px (02, 03A).

## Остаточные риски
Метрики светофора по legacy-таблицам не видят замещения (этап 07); отзыв права ИИ не снимает опубликованное;
UI для запусков/предпросмотра нет.

## Безопасность
Рабочая база не подключалась; 010–013/backfill/переразбор к ней не применялись; `.env` не трогался; источники не включались.

## Следующий шаг
Этап `stages/STAGE_04_IDENTITY_MERGE.md`: читать COMMON_RULES, DATA_CONTRACTS, `resolve/merge.ts`, `company.ts`, `project.ts`,
`pipeline/guard.ts`, `reprocess/publish.ts` (findPriorEntity), миграции 006, 012, 013.

## Запреты
Не писать в рабочую БД; не снимать блокировку слияния вне 04; не подключать источники/облачную модель;
не редактировать `.env`; не запускать Docker в среде агента.

## Что прочитать новой сессии
`prompts/Customer_Dossier_Prompts/COMMON_RULES.md`, `docs/development/STATE.md`, этот HANDOFF, `stages/03B_REPORT.md`, ADR-004,
`TESTING_LOCAL.md`; ключевые файлы: `backend/src/reprocess/*.ts`, `docs/migrations/013_extraction_runs_publications.sql`.
