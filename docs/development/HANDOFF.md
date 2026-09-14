# Передача контекста — Customer Dossier

## Задача
Локальный портал доказательного досье строительных компаний и обращений (рынок РФ). Код — `TG_Info`. План — `prompts/Customer_Dossier_Prompts/` (00–09).

## Текущее состояние
Этап 03A — код готов, ждёт прогона пользователя (TESTING_LOCAL A5 — 9 файлов / 82 теста, раздел E). Этап 02 — PASS. Ветка `dossier-stages`.
Проверить при открытии: `git log --oneline -5`, `git status`.

## Порядок работы (указание пользователя 2026-09-14)
После каждого этапа: отчёт → commit (русский, 1–2 предложения, без Co-Authored-By) → push `origin dossier-stages` → следующий этап.
Docker и проверки с базой агент не запускает: пишет инструкцию в `docs/development/TESTING_LOCAL.md`, делает паузу, ждёт отчёт пользователя.

## Уже сделано
- 00: baseline (`stages/00_REPORT.md`, `PATCH_COVERAGE.md`, `BACKLOG.md`).
- 01: безопасный запуск, вход оператора, допуск источников, SSRF-клиент, блокировка канона, изоляция тестов (`stages/01_REPORT.md`, ADR-001).
- 02: `source_items` / неизменяемые `document_revisions` / `source_observations` (миграция 011), запись в `ingest/store.ts`
  с мостом к legacy, полнота по адаптерам, backfill `npm run backfill:revisions`, API и UI версий (`stages/02_REPORT.md`, ADR-002). PASS.
- 03A: `assertions` / `evidence` / `review_decisions` (миграция 012), `backend/src/assertions/*`, backfill `npm run backfill:assertions`,
  API решений с версией и идемпотентностью, панель в админке (`stages/03A_REPORT.md`, ADR-003). Следующая миграция — 013.

## Принятые решения
ADR-001, ADR-002. Личность публикации — `(source_id, item_key)`; legacy-документ только для первой редакции; редакции неизменяемы (триггер);
stale-наблюдения не двигают текущее состояние; history_before_import='unknown' для импорта; single writer.

## Последние изменения
Этап 02 — см. таблицу в `stages/02_REPORT.md`. Следующая миграция — 012.

## Что проверено (среда агента)
typecheck backend/frontend, build backend/frontend, unit 20 файлов / 297 тестов — PASS.

## Что НЕ проверено
Интеграционные тесты (7 файлов / 61 тест ожидается), backfill CLI, UI панели версий — у пользователя.

## Безопасность
Рабочая база не подключалась; 010/011/backfill к ней не применялись; `.env` не трогался; источники не включались.

## Следующий шаг
Дождаться отчёта пользователя по TESTING_LOCAL (A5, E). Исправить упавшее, обновить 03A_REPORT до PASS, commit/push.
Затем `stages/STAGE_03B_SAFE_REPROCESSING.md`: читать COMMON_RULES, DATA_CONTRACTS (ExtractionRun/Chunk, promotion),
`pipeline/worker.ts`, `apply.ts`, `guard.ts`, `assertions/repository.ts`, миграции 004, 011, 012.

## Запреты
Не писать в рабочую БД; не снимать блокировки `pipeline/guard.ts` вне 03B/04; не подключать источники/облачную модель;
не редактировать `.env`; не запускать Docker в среде агента.

## Что прочитать новой сессии
`prompts/Customer_Dossier_Prompts/COMMON_RULES.md`, `docs/development/STATE.md`, этот HANDOFF, `stages/02_REPORT.md`, ADR-001, ADR-002,
`TESTING_LOCAL.md`; ключевые файлы: `backend/src/ingest/store.ts`, `revisions/*.ts`, `docs/migrations/011_source_items_revisions.sql`.
