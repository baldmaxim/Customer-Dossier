# Отчёт этапа 14A — Единая проверка качества текущей схемы

Дата: 2026-09-17. Ветка `main`, основа `03838eb`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_14A_CURRENT_SCHEMA_EVALUATION.md`.

## Статусы
IMPLEMENTED: да
CODE_CHECKED: typecheck PASS; unit `src/reprocess` — 64 PASS (включая `evaluation.test.ts`, 14) (`--maxWorkers=1`); полный unit — BLOCKED_ENV (память)
REVIEWED: NOT_RUN
USER_VALIDATED: REAL_MODEL = NOT_RUN (оценка на LM Studio выполняет пользователь)

## Исходная проблема
- **F11.** `pipeline/compare.ts` и `--shadow/--compare` используют `extractFromText` — extract@2 и legacy `extractions`. `CLAUDE.md` и README
  предлагали этот путь для выбора модели, хотя рабочий конвейер — extract@3.
- **F12.** `reprocess/semantic/benchmark.ts`: при ошибке модели кейс получал `checks: []`, сводка считалась по имеющимся проверкам —
  знаменатель уменьшался (24/25 и 3/9 могли быть из неполного числа проверок). Обрезанный вход (`truncatedInput`) засчитывался как
  извлечённый. Нарезки, покрытия и общей классификации отказа не было — оценка не повторяла путь конвейера. Неизвестный `--case`
  давал пустую выборку без ошибки. Отпечаток конфигурации — только модель, схема и версия промта.
- **F13.** Исходный `benchmark-06.json` в архиве отсутствует: какая именно safety-проверка не прошла на 24/25 — **UNKNOWN**.

## CURRENT_EVALUATION_CONTRACT (`current-eval@1`, `reprocess/semantic/evaluation.ts`)
- **Тот же путь, что у конвейера:** `planCodePointChunks` (те же параметры, что `defaultChunkerParams`) → ответ модели на каждый чанк →
  `classifyExtractResult` (новый общий модуль `reprocess/extractOutcome.ts`, им же пользуется `runs.ts`) → `computeCoverage` →
  `buildCandidates` (verify + assemble). Кейс `extracted` только если конвейер завершил бы запуск `completed`.
- **План до модели.** Знаменатель — запланированные проверки. Ошибка инфраструктуры (`llm_error`, `timeout`) или неполный разбор
  (`truncated_input`, `invalid_json`, `schema_error`, непокрытый хвост): safety — `not_evaluated`, recall — `failed`, с причиной.
  Невыполненный кейс учитывается целиком.
- **Разделение:** safety (не выдумывает), recall (находит), невалидная схема (кейсы), отказ инфраструктуры (кейсы), статус кейса.
  Доли не пересчитываются в «проценты качества». Precision/recall по эталонному набору фактов — не вводились (нет reference set;
  см. 14B).
- **Вердикт:** `FAIL` — нарушена safety или ниже заранее заданного порога recall; `INCOMPLETE` — что-то не оценено или не выполнено;
  `REPORT_ONLY` — порога recall нет (по умолчанию); `PASS` — только при заданном пороге и полной оценке. FAIL/INCOMPLETE → exit 1.
- **Идентичность отчёта:** версия контракта и scoring (`corpus-checks@1`), `corpusHash` (тексты + метки проверок), полный
  `executionFingerprint` этапа 11, схема, пороги; `meta`: время, режим (`model`/`replay`), сведения сервера (`unknown`, если не сообщены),
  загруженные модели.
- **Воспроизводимость:** отчёт хранит ответы модели по чанкам (`recorded`); `--replay` пересчитывает без сети.
- **Сравнение:** `--compare a b` — несовместимо при разных контракте, scoring, корпусе, схеме или порогах; иначе парные изменения по
  каждой проверке, потери safety отдельно, дельта recall.
- **Разбиение корпуса:** `splitViolations` — одна группа происхождения (перепечатки) в одном сплите; holdout, виденный при
  настройке, — нарушение. 17 кейсов этапа 06 — `regression` (видены при настройке semantic@1), не holdout.
- **Legacy:** `pipeline:once -- --shadow/--compare` без `--legacy` отказывают с указанием на `benchmark:model`. Legacy-результаты
  в доказательства не переносятся.
- **benchmark-06:** `--import-legacy benchmark-06.json` показывает только записанные поля (сводка, кейсы с ошибкой модели,
  непрошедшие safety-проверки, если они в файле) и перечень неизвестного. Разбор без исходного файла — UNKNOWN.

## Изменения
- `backend/src/reprocess/extractOutcome.ts` (новый), `runs.ts` (использует общий классификатор; поведение прежнее).
- `backend/src/reprocess/semantic/evaluation.ts` (новый), `evaluation.test.ts` (новый, 14), `benchmark.ts` (переписан на контракт).
- `backend/src/pipeline/cli.ts` — `--legacy` для `--shadow/--compare`.
- `CLAUDE.md`, `README.md` — команды оценки.
Миграций нет. Корпус и его проверки не менялись (регрессионная база).

## Проверки

| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T14A-01 | `pipeline/cli.ts` отказ без `--legacy`; отчёт несёт `schemaVersion` и `executionFingerprint` | AGENT (код) | IMPLEMENTED; CLI-прогон NOT_RUN |
| T14A-02 | `evaluation.test.ts` «все кейсы с ошибкой модели…», «один кейс с ошибкой остаётся в плане…» | AGENT | PASS |
| T14A-03 | «пустой и неизвестный селектор — ошибка…» | AGENT | PASS |
| T14A-04 | «обрезанный вход, невалидный JSON и ошибка схемы…», «несколько чанков…», общий `classifyExtractResult` в `runs.ts` | AGENT | PASS |
| T14A-05 | checks отдельно от precision/recall; эталонный набор фактов и FP/FN — не реализовано | — | NOT_IMPLEMENTED (перенесено в 14B, нужен reference set) |
| T14A-06 | «перепечатка одного исходника…», «holdout, виденный при настройке…» | AGENT | PASS |
| T14A-07 | «разный корпус, схема или пороги — несовместимо…», «парное сравнение…» | AGENT | PASS |
| T14A-08 | «записанные ответы дают тот же результат без сети»; реальный baseline | AGENT / USER (MODEL) | replay PASS; REAL_MODEL NOT_RUN |

## Неизменённые ограничения
Модель не вызывалась; `.env` не менялся; защита цитат и реквизитов не ослаблялась; модели не скачивались; обучения нет.
LOCAL_MODEL_VALIDATED = нет.

## Миграция и откат
Миграций нет. Отчёты прежнего формата читаются только через `--import-legacy` (как неполные). Откат — `git revert`.

## Открытые риски
- Precision/recall по эталонным фактам не считаются — только машинные проверки корпуса.
- Прежние числа 24/25 и 3/9 получены прежним способом и с текущими не сравнимы (другой знаменатель и путь).

## Следующий шаг пользователя
`evidence/14A/USER_RUN.md`.
