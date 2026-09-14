# Отчёт этапа 03B — Новый конвейер и безопасное переизвлечение

Дата/время: 2026-09-14 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **код готов, ждёт прогона пользователя** (TESTING_LOCAL A5 — 10 файлов / 103 теста, раздел F).
Этап нельзя закрыть unit-моками: обязательные сценарии — в `reprocess/reprocess.int.test.ts` на PostgreSQL.

## Исходная база

- Ветка `dossier-stages`, этап 03A закрыт коммитом `3cced8d` (PASS по прогону пользователя).
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_03B_SAFE_REPROCESSING.md`; зависимость — `03A_REPORT.md`.
- Соответствие путей inspected-архива: `pipeline/worker.ts`, `apply.ts`, `cli.ts`, `cli-commands.ts`, `llm/client.ts`,
  `llm/schema.ts` — на месте; `pipeline/chunks.ts` отдельно нет (нарезка была в `worker.ts`). Новый путь — `backend/src/reprocess/`,
  дубликаты старых модулей не создавались.

## Что изменилось для пользователя

- Разбор моделью снова работает, но **карточки меняются только публикацией набора**: `--reextract --limit N` ставит
  запуски, `pipeline:once` их выполняет, `--preview` показывает, что добавится, что снимется, что поменялось и чьи ручные
  решения затронуты, `--publish` применяет всё одной транзакцией.
- Переразбор документа больше не стирает роли и события, подтверждённые другими источниками, и не трогает решения аналитика.
- Неполный разбор (упал чанк, не поместился хвост, таймаут, ответ на укороченном тексте) не становится «успешным».
- Старый разбор, завершившийся позже нового, не перезаписывает публикацию без `--allow-stale`.
- `PIPELINE_ENABLED=true` запускает новый worker; автопубликация — отдельный флаг `REPROCESS_AUTO_PUBLISH` (по умолчанию выключена).

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/013_extraction_runs_publications.sql` (новый) | `extraction_runs` (fingerprint, lease, fencing), `extraction_chunks` (диапазоны), `extraction_chunk_responses` (append-only), `candidate_sets`, `candidate_assertions`, `item_publications`, `publication_history` (append-only), `candidate_set_evidence`; `evidence.extraction_chunk_id`, статус `superseded`; проекции `replaced_legacy_documents_v`, `published_assertions_v`, `card_participations_v`, `card_events_v` | расширение; CHECK статуса evidence заменён расширенным |
| `backend/src/reprocess/chunking.ts` | нарезка в code points, покрытие по объединению диапазонов | — |
| `backend/src/reprocess/provider.ts` | интерфейс модели, LM Studio, отпечаток параметров | размер чанка в символах — приближение к токенам |
| `backend/src/reprocess/candidates.ts` | проверка по тексту чанка, namespaced mention-id, объединение по имени+реквизиту, события по позиции | заменяет `mergeChunkExtractions` на новом пути |
| `backend/src/reprocess/runs.ts` | постановка, захват, ответы по чанкам, итог, набор кандидатов, повтор новым запуском | — |
| `backend/src/reprocess/publish.ts` | предпросмотр и публикация (версия, политика, stale, идемпотентность, superseded) | резолвер может создать компанию/объект и пару в merge_queue, как раньше |
| `backend/src/reprocess/worker.ts`, `cli-commands.ts` | проход worker'а; команды `--runs/--reextract/--retry/--preview/--publish` | — |
| `backend/src/assertions/repository.ts` | `addEvidence`: `extractionChunkId`, реактивация `superseded` (не `withdrawn`) | обратно совместимо |
| `backend/src/pipeline/cli.ts` | диспетчер на новые команды; legacy-очередь не обрабатывается | `--retry` теперь создаёт новые запуски |
| `backend/src/index.ts`, `jobs.ts`, `jobs.test.ts`, `config/env.ts`, `.env.example` | worker нового конвейера по `PIPELINE_ENABLED`; флаг `REPROCESS_AUTO_PUBLISH=false` | при `PIPELINE_ENABLED=true` пойдут вызовы модели |
| `backend/src/api/reprocess.routes.ts` (новый), `app.ts` | `GET /api/reprocess/runs`, `GET /api/reprocess/sets/:id/preview`, `POST /api/reprocess/sets/:id/publish` (200 с outcome / 409 / 422) | после входа оператора, публикация — с CSRF |
| `backend/src/api/companies.routes.ts` | `/:id/projects`, `/:id/events` читают `card_participations_v` / `card_events_v`, поле `origin` | ответ расширен; лента упоминаний — legacy |
| тесты: `reprocess/reprocess.test.ts` (unit), `reprocess/reprocess.int.test.ts` (интеграция), `reprocess/__fixtures__/extraction.ts`, `__tests__/integration/seedReprocessDemo.ts`, script `seed:test-reprocess` | см. «Тесты» | интеграция — у пользователя |
| `docs/development/ADR-004-extraction-runs-and-publication.md` (новый), `CLAUDE.md`, `README.md`, `TESTING_LOCAL.md` (A, F), `PATCH_COVERAGE.md` (R05, R06, R07, R16) | решения и инструкция | — |

Старые `pipeline/worker.ts` / `apply.ts` не удалены и из CLI/API не вызываются; `pipeline/guard.ts` не менялся —
legacy apply, `clearDocumentContribution`, `--retry-skipped`, `--renormalize`/`--recheck` без `--dry`, `--merge` заблокированы.

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Typecheck backend/frontend | `tsc --noEmit`, `tsc -b` | — | 0/0 | PASS | среда агента |
| Сборка backend | `npm run build` | — | 0 | PASS | среда агента |
| Unit | `npm test` | мёртвый URL | 0 | PASS: 22 / 325 (было 21 / 311) | среда агента |
| Нарезка в code points, перекрытие, непокрытый хвост, дыра в покрытии (логика) | `reprocess.test.ts` | unit | 0 | PASS | — |
| Одинаковые имена с разными ИНН, два суда, перекрытие чанков, локальность цитаты, отпечаток (логика) | `reprocess.test.ts` | unit | 0 | PASS | — |
| Полный путь, evidence → chunk → run → revision, проекция карточки, `reviewed_supported` машиной не ставится | `reprocess.int.test.ts` | tg_info_test | — | NOT_RUN | ждёт прогона пользователя |
| Падение последнего чанка → partial; повтор новым запуском | то же | tg_info_test | — | NOT_RUN | — |
| Непокрытый хвост → failed без вызова модели | то же | tg_info_test | — | NOT_RUN | — |
| Timeout → исход `timeout`, failed | то же | tg_info_test | — | NOT_RUN | — |
| Crash до commit итога → тот же запуск продолжается без повторных вызовов | то же | tg_info_test | — | NOT_RUN | — |
| Crash после commit → повторного захвата нет, набор один | то же | tg_info_test | — | NOT_RUN | — |
| Crash внутри публикации → контрольные количества не изменились | то же | tg_info_test | — | NOT_RUN | — |
| Два worker'а: один захват; прежний держатель после перехвата не пишет | то же | tg_info_test | — | NOT_RUN | — |
| Поздний старый разбор → `rejected_stale`, указатель не тронут, история | то же | tg_info_test | — | NOT_RUN | — |
| Нерелевантная новая версия при двух источниках и ручном решении: решение и чужое доказательство на месте, `needs_revalidation`, компании не удалены, строки evidence не удалены | то же | tg_info_test | — | NOT_RUN | — |
| Набор старой редакции после появления новой → устаревший | то же | tg_info_test | — | NOT_RUN | — |
| Отзыв права ИИ до публикации → `rejected_policy`; захват и постановка запрещены | то же | tg_info_test | — | NOT_RUN | — |
| Одинаковые имена с разными ИНН → две компании | то же | tg_info_test | — | NOT_RUN | — |
| Идемпотентный повтор публикации; 409 на версию (функция и API); без CSRF — 401/403 | то же | tg_info_test | — | NOT_RUN | — |
| Legacy-событие замещённого документа скрыто, подтверждённое вручную — видно, строки не удалены | то же | tg_info_test | — | NOT_RUN | — |
| Повторная публикация новой редакции не размножает объект без города и компанию без ИНН | то же | tg_info_test | — | NOT_RUN | — |
| CLI: `--runs`, `--preview`, `--publish` (stale, published, already), `--reextract` без лимита, `--merge` заблокирован | TESTING_LOCAL F | tg_info_test | — | NOT_RUN | — |
| Регрессия 01–03A (9 файлов / 82) | `npm run test:integration` | tg_info_test | — | NOT_RUN | ожидается 10 / 103 |
| Реальный LLM-smoke | `pipeline:once` с LM Studio | — | — | NOT_RUN | модель не проверялась; `LOCAL_MODEL_VALIDATED` не выставляется |

## Данные, безопасность и откат

- Рабочая БД не подключалась; миграция 013 к ней не применялась; переразбор рабочей базы не выполнялся. Docker в среде
  агента не запускался. `.env` не менялся; `.env.example` дополнен флагом.
- Активные флаги по умолчанию: `PIPELINE_ENABLED=false`, `REPROCESS_AUTO_PUBLISH=false`, остальные без изменений.
- Откат: `PIPELINE_ENABLED=false` (writer остановлен, карточки читают последний опубликованный набор); вернуть прежний
  набор — `--publish <набор> --allow-stale`. Не возвращать `clearDocumentContribution`; строки 013 не удалять.

## Непроверенное, остаточные риски, решения

- Все интеграционные сценарии и CLI — у пользователя (выше NOT_RUN до прогона).
- Метрики светофора и статистика подрядчиков (`company_metrics`) считаются по legacy-таблицам и не видят замещения
  переразобранных документов — до этапа 07. Лента упоминаний — legacy.
- Отзыв `ai_processing` не снимает уже опубликованные наборы и не помечает их в карточке — отражение статуса источника
  вместе с сигналами (этапы 05–07).
- Автопостановка worker'а берёт только ещё не разобранные последние редакции (без запусков и без legacy-статуса
  `extracted/skipped`); переразбор разобранного — только `--reextract` с лимитом.
- Связь «компания — объект» без собственной цитаты берёт основанием цитату компании в том же чанке (R03 — этап 06).
- Цитата, найденная моделью неточно (регистр/пробелы), подтверждает сущность в `verifyExtraction`, но без точного
  однозначного вхождения не даёт доказательства — такой кандидат не публикуется (консервативно).
- Панели UI для запусков и предпросмотра нет — CLI и API; UI — по мере необходимости в следующих этапах.
- Одинаковая позиция в повторном разборе переиспользует строку evidence (ссылка на чанк — первого запуска).

## Завершение

Следующий промт после подтверждения прогона: **`prompts/Customer_Dossier_Prompts/stages/STAGE_04_IDENTITY_MERGE.md`**.
