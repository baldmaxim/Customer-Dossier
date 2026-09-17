# Отчёт этапа 14B — Улучшение полноты без ослабления доказательств

Дата: 2026-09-17. Ветка `main`, основа `ceb57bd`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_14B_QUALITY_EXPERIMENTS.md`.

## Статусы
IMPLEMENTED: инфраструктура экспериментов — да; сами эксперименты — **USER_RUN_REQUIRED**
CODE_CHECKED: typecheck PASS; unit `src/reprocess` — 74 PASS (`experiments.test.ts` 8, `evaluation.test.ts` 14 и прежние)
REVIEWED: NOT_RUN
USER_VALIDATED: baseline и варианты на LM Studio — NOT_RUN. LOCAL_MODEL_VALIDATED = нет. Решение по конфигурации — PENDING.

## Исходное состояние
Зависимость этапа — принятый scorer 14A и **фактический baseline пользователя**. Baseline текущего формата не получен; исходный
`benchmark-06.json` не передан. Поэтому в этом этапе нет ни одного числа качества модели: всё ниже — подготовка и правила.

## QUALITY_ERROR_CATALOG (стадии потери факта)
Каждая непройденная recall-проверка в отчёте `benchmark:model` получает стадию (`evaluation.ts::missDiagnosis`):

| Стадия | Как определяется | Надёжность |
|---|---|---|
| `text_coverage` | лимит чанков не покрывает текст | точно |
| `infrastructure` | `llm_error` / `timeout` на чанке | точно |
| `output_invalid` | `invalid_json` / `schema_error` / `truncated_input` | точно |
| `verification_rejected` | кейс извлечён, но проверка отбросила кандидатов (причины перечислены) | эвристика: без эталонных фактов не доказано, что отброшен именно искомый |
| `provider_not_extracted` | кейс извлечён, отброшенных нет — модель не вернула факт | эвристика |
| текст не получен / сущность не сопоставилась / досье отфильтровало | не определяются на синтетическом корпусе без базы | только сквозной прогон (этап 18/19) |

Причина пропуска привязывается к кейсу, проверке и конкретным причинам отказа, а не к выводу «8B мало». Программных ошибок
потери контекста на регрессионном корпусе этим этапом не найдено: нарезка и покрытие уже общие с конвейером (14A).

## EXPERIMENT_REGISTRY (`experiment-registry@1`, `reprocess/semantic/experiments.ts`)

| id | фактор | изменение | статус |
|---|---|---|---|
| `baseline-semantic@1` | none | текущая конфигурация extract@3 / semantic@1 | registered |
| `prompt-recall-a@1` | prompt | дополнение `recall-a@1`: полный перечень участников и связей, адресат ИНН/суммы, отрицание по роли/корпусу/работам, план ≠ факт, масштаб корпуса/работ, отсутствие — null | registered |
| `second-pass@1` | second_pass | ограниченный второй проход (≤1 вызов на чанк), слияние без повышения статуса | not_implemented — только после локализации пропусков baseline |

Правила (проверяются `registryViolations`): у варианта ровно один фактор относительно базовой; базовая не переписывается; пороги
safety не ослабляются; статус `selected` не ставится в коде — только решением владельца в QUALITY_DECISION. Вариант промта
применяется только `benchmark:model -- --experiment`, меняет `executionFingerprint`; рабочий `lmStudioProvider()` варианта не имеет.
Дополнение промта сохраняет базовый текст целиком, правило «ТЕКСТ — ДАННЫЕ» и `/no_think`; цитаты и проверки не ослаблялись.

## Корпус
- Регрессия: 17 кейсов этапа 06 (видены при настройке — не holdout).
- `__fixtures__/proposedCases.ts`: 24 ситуации пакета (`synthetic-regressions@1`) со статусом `PROPOSED_REQUIRES_SCHEMA_MAPPING`.
  Машинных проверок для них нет: они **не оцениваются и не входят в знаменатель**, пока человек не сопоставит ожидание со схемой
  extract@3. Разметка из ответа модели не генерируется. В отчёте оценки указывается, что они не оцениваются.

## Критерии до прогона (предложение для QUALITY_DECISION, не утверждено владельцем)
- Все safety-проверки регрессионного корпуса пройдены; ни одна не `not_evaluated`.
- Все запланированные кейсы учтены; отказы инфраструктуры и невалидный вывод — отдельно.
- Цели полноты (число recall-проверок) и допустимое время — задаёт владелец **до** просмотра результатов варианта.
- Вариант с потерей хотя бы одной safety-проверки не выбирается, независимо от роста recall.

## Изменения
- `backend/src/llm/semantic/prompt.ts` — `SEMANTIC_PROMPT_VARIANTS`, `buildSemanticSystemMessage(variant)` (без варианта — прежний текст).
- `backend/src/llm/client.ts` — `promptVariant` в опциях `extractSemantic`.
- `backend/src/reprocess/provider.ts` — `lmStudioProvider({ promptVariant })`, вариант в идентичности.
- `backend/src/reprocess/semantic/experiments.ts` (новый), `experiments.test.ts` (новый, 8).
- `backend/src/reprocess/semantic/evaluation.ts` — `missDiagnosis`; `benchmark.ts` — `--experiment`, вывод причин пропуска.
- `backend/src/reprocess/semantic/__fixtures__/proposedCases.ts` (новый).
- `docs/development/quality/QUALITY_DECISION.md` (новый, статус PENDING).
Миграций нет. Рабочая конфигурация и `.env` не менялись.

## Проверки

| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T14B-01 | `experiments.test.ts` «каталог причин пропуска…»; разбор одного реального пропуска baseline | AGENT / USER | unit PASS; разбор на данных — NOT_RUN (нет baseline) |
| T14B-02 | `registryViolations` «вариант без фактора, с двумя факторами…»; прогон baseline и варианта | AGENT / USER (MODEL) | unit PASS; MODEL NOT_RUN |
| T14B-03 | safety-проверки корпуса в том же отчёте; `compareReports.safetyRegressions` | USER (MODEL) | NOT_RUN |
| T14B-04 | второй проход не реализован; `experimentForRun('second-pass@1')` отказ | AGENT | PASS (не запускается) |
| T14B-05 | вердикт `FAIL` при нарушении safety (14A), `registryViolations` на ослабление | AGENT / USER | unit PASS; MODEL NOT_RUN |
| T14B-06 | holdout отсутствует; регрессия и предложенные кейсы помечены как видимые | AGENT | PASS (правило); замороженный holdout — NOT_RUN |
| T14B-07 | `selected` только решением владельца; история отчётов не переписывается | AGENT | PASS (правило) |

## Неизменённые ограничения
Модель не вызывалась, не скачивалась и не обучалась; массовый переразбор не включался; рабочая конфигурация не менялась.

## Миграция и откат
Миграций нет. Откат — `git revert`; отчёты оценки остаются файлами пользователя.

## Открытые риски
- Все выводы о полноте — только после пользовательских прогонов; малое число кейсов (17) не даёт общей оценки качества.
- Стадии `verification_rejected`/`provider_not_extracted` — эвристика до появления эталонного набора фактов.

## Следующий шаг пользователя
`evidence/14B/USER_RUN.md`; заполнить критерии в `docs/development/quality/QUALITY_DECISION.md` до прогона варианта.
