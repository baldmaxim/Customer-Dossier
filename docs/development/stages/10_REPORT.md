# Отчёт этапа 10 — Безопасная проверка данных и актуальная исходная точка

Дата: 2026-09-16. Ветка `main`, основа `e3e6dd6`. Node v24.14.1, cwd `TG_Info`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_10_RELEASE_HARDENING.md`.

## Статусы
IMPLEMENTED: да
CODE_CHECKED: typecheck PASS; unit затронутого файла PASS (`release/bench.test.ts`, 14); полный unit на этом коде — BLOCKED_ENV (на машине агента свободно 0,5–1,4 ГБ ОЗУ, vitest падал «memory allocation failed»; процессы Node не завершались)
REVIEWED: NOT_RUN (Codex-ревью не проводилось)
USER_VALIDATED: T10-04/05/07/08 — да, прогоном закрытия приёмки 09 на `10d83d9` + `c289cb1` (сводка пользователя); правки этапа 10 после него (таймаут выборки bench, документы) — NOT_RUN
Переход к этапу 11: по указанию пользователя «этапы 10–19, коммит после каждого» — продолжаю офлайн-работу, пользовательские gates копятся в `evidence/*/USER_RUN.md`.

## DELTA_BASELINE

| Что | Где | Статус |
|---|---|---|
| Исторически подтверждено пользователем | 09 core-gates (`evidence/09/USER_RUN.md`), закрытие 09 по усиленным условиям (`evidence/09/CLOSURE_MATRIX.md`) | PASS; PDF/390 px/Cache Storage — NOT_RUN |
| Найдено аудитом пакета 10–19 и уже исправлено в 09 | F01 (guard bench), F02 (compare: миграции, отсутствующая таблица, содержимое — `release:manifest`), F03 (HTTP-ошибка как время), R06/R07 | закрыто кодом `10d83d9`, проверено пользователем |
| Найдено в прогоне 09 | ложное `assertion_company_merged` после слияния | исправлено `c289cb1` |
| Добавлено на этапе 10 | отдельный исход `timeout` у выборки bench; выравнивание CLAUDE.md/README с ADR (экраны, светофор, legacy `--shadow/--compare`) | этот отчёт |
| Не относится к 10 | F04–F20 | этапы 11–19 |

## Исходная проблема
F01–F03, R06–R07 — воспроизведены чтением кода при закрытии 09 и исправлены там (подробно `09_REPORT.md`, D1–D4, D9).
Остаток на этапе 10: (1) шаг bench без ограничения времени мог зависнуть без исхода — промт требует «отдельно ошибки, timeout, warm-up»;
(2) `CLAUDE.md` описывал «четыре экрана MVP» и «светофор» вопреки ADR-009/010/011; `CLAUDE.md` и `README.md` предлагали legacy
`--shadow/--compare` (extract@2) как способ выбора модели.

## Изменения
- `backend/src/release/bench.ts`: `timedSample(fn, timeoutMs = 30000)` — зависший ответ даёт выборку `timeout N мс` (ошибка шага), исключение — `исключение: …`.
- `backend/src/release/bench.test.ts`: +2 теста (timeout, исключение).
- `CLAUDE.md`: фактический перечень экранов; «итоговой оценки и светофора нет (ADR-009)»; `--shadow/--compare` помечены legacy extract@2 до этапа 14A.
- `README.md`: `--shadow`, `--compare` помечены LEGACY extract@2.
Миграций, зависимостей и изменений API нет. Прежние снимки и данные не затрагиваются.
Отклонено как ненужное: вынос app factory из `__tests__/integration/http.ts` — импорт без побочных эффектов, собирается настоящий `createApp` с auth/CSRF (проверено в 09).

## Проверки

| Scenario ID | Файл/команда | Кем/где | Exit | Результат | Доказательство |
|---|---|---|---|---|---|
| T10-01 | `release/manifest.test.ts` (текст редакции, цитата, решение); `release/manifest.int.test.ts` | AGENT unit / USER int | 0 / 0 | PASS | `evidence/09/closure/unit-final.log`; прогон 09 B2 19/210, E7 MISMATCH `evidence` |
| T10-02 | `release/inventory.test.ts` → «R06: другая последняя миграция…» | AGENT | 0 | PASS | unit-final.log |
| T10-03 | `inventory.test.ts` → «R07: отсутствующая таблица не равна пустой»; manifest `MISSING_TABLE` | AGENT | 0 | PASS | unit-final.log |
| T10-04 | `db/testTarget.test.ts` (preflight); B1/F0 | AGENT / USER | 0 / 1 (ожидаемый отказ) | PASS | unit-final.log; прогон 09 B1, F0 |
| T10-05 | `release/bench.test.ts` (HTTP 400, пустое досье, медиана только по успешным, timeout) ; F1 | AGENT / USER | 0 / 0 | PASS (timeout-тест — на этом коде, одиночный файл) | прогон 09 F1: все шаги 5/5, поиск 200 |
| T10-06 | `manifest.test.ts` «сериализация строк» | AGENT | 0 | PASS | unit-final.log |
| T10-07 | E1–E6 `USER_RUN_CLOSURE.md` | USER | 0 | PASS | прогон 09: inventory+manifest MATCH, чтение копии |
| T10-08 | `inventoryProblems`, `manifestProblems` (`INTEGRITY_SKIPPED`/`VIOLATION`), exit 1 | AGENT / USER | 0 | PASS | unit-final.log; прогон 09 B2 (фикс D9) |
| T10-09 | `manifest.test.ts` «другая версия формата — INCOMPATIBLE», «manifest не содержит секретов и текстов» | AGENT | 0 | PASS | unit-final.log |
| полный unit на коде этапа 10 | `npx vitest run --maxWorkers=2` | AGENT | 9 | BLOCKED_ENV (OOM машины) | вывод: `memory allocation of 98304 bytes failed` |

## Неизменённые ограничения
Рабочая БД, `.env`, источники, фоновые флаги, публикация, слияние, конфигурация модели не трогались. Docker/БД/браузер агент не запускал.

## Миграция и откат
Миграций нет. Откат — `git revert` коммита этапа; таймаут выборки не меняет формат отчёта `local-bench@2` (добавляется только текст ошибки).

## Ревью
Codex-ревью не проводилось — NOT_RUN.

## Открытые риски
- Полный unit на коде этапа 10 не прогнан из-за памяти машины агента (BLOCKED_ENV). Изменение локально (bench) и покрыто своим файлом тестов.
- Legacy `--shadow/--compare` остаются в коде до 14A.

## Следующий шаг пользователя
`evidence/10/USER_RUN.md`: полный unit на текущем коде и (по желанию) повтор F1 bench. Дальше — этап 11 (выполняется агентом офлайн).
