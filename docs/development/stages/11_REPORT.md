# Отчёт этапа 11 — Неизменная конфигурация запуска и отзыв допуска

Дата: 2026-09-16. Ветка `main`, основа `8b1a944`. Node v24.14.1. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_11_EXTRACTION_RUNTIME.md`.

## Статусы
IMPLEMENTED: да
CODE_CHECKED: typecheck PASS; unit `src/reprocess`, `src/llm`, `src/pipeline` — 6 файлов / 121 PASS (`--maxWorkers=1`); полный unit — BLOCKED_ENV (свободно 0,5–1,4 ГБ ОЗУ на машине агента)
REVIEWED: NOT_RUN
USER_VALIDATED: NOT_RUN (интеграция `reprocess.int.test.ts`, describe «этап 11», миграция 021)

## Исходная проблема (подтверждено чтением кода)
- **F04 / R10.** `enqueueRun` сохранял отпечаток, `claimNextRun` отдавал только нарезку, `processRun(provider, claim)` принимал
  любой текущий провайдер без сверки: запуск модели A выполнялся моделью B и оставался записанным как A. `worker.ts` захватывал
  любую очередь. Отпечаток не включал эффективное системное сообщение (`/no_think`), шаблон пользовательского сообщения,
  политику повторов и версию проверки кандидатов.
- **F05 / R09.** Допуск проверялся при постановке, захвате и публикации, но не перед каждым чанком: после отзыва между чанками
  следующие вызовы уходили. Повторы внутри `llm/client.ts` (backoff 2 с/8 с, повтор на укороченном тексте) тоже не проверяли
  допуск. Внешний `signal` заменял таймаут вместо совмещения.
- Проверка аренды шла только при записи ответа: потерявший аренду worker успевал сделать ещё один вызов модели.

## Изменения
- `backend/src/reprocess/provider.ts` — `execution-identity@1`: `buildModelIdentity`, `modelIdentityHash`, `systemMessageHash`,
  `userTemplateHash`, `retryPolicy`, `candidateBuildVersion`, `serverReported` (по умолчанию `unknown`), `isHistoricalIdentity`;
  `IExtractContext { signal, beforeAttempt }` у `IModelProvider.extract`.
- `backend/src/llm/client.ts` — `beforeAttempt` перед каждой попыткой (включая повтор на укороченном тексте); `signal`
  совмещается с таймаутом через `AbortSignal.any`; `RETRY_POLICY_VERSION`.
- `backend/src/reprocess/runs.ts` — `IRunClaim.fingerprint`; `claimNextRun(owner, { provider })` отбирает по `modelIdentityHash`;
  `executionMismatch` + статус результата `blocked` (запуск → `queued`, вызовов 0); `assertCanCallModel` (аренда с продлением +
  ИИ-допуск) перед каждым чанком и каждой попыткой; наблюдатель во время ответа (best-effort `AbortController`);
  проверка допуска после ответа и в итоге → `cancelled` без набора; `PolicyRevokedError`; `retryRun` ставит новый запуск с
  `previous_run_id`, заменяет не начатый запуск другой конфигурации (прежний → `cancelled`); ответы прежних чанков не переносятся.
- `backend/src/reprocess/worker.ts` — захват только своей конфигурации. `cli-commands.ts` — `--retry` включает `cancelled` и очередь
  другой конфигурации. `pipeline/cli.ts` — описание.
- `docs/migrations/021_run_execution_identity.sql` (additive): `previous_run_id`, индекс по `modelIdentityHash`.
- `docs/development/ADR-004…` — дополнение этапа 11 (контракт, переходы, старые запуски, откат).
- Тесты: `reprocess/executionIdentity.test.ts` (новый, 9); `reprocess/reprocess.int.test.ts` — describe «этап 11» (7).

Отклонено: перенос ответов старых чанков в новый запуск (контракт совместимости не нужен, по умолчанию не смешиваем);
отдельный статус `config_mismatch` в CHECK (достаточно `blocked` в результате и `cancelled` при замене, без правки миграции 013).
Offline `benchmark:model` не пишет запуски и не читает таблицу источников — отдельный синтетический контракт (этап 14A).

## Проверки

| Scenario ID | Файл/тест | Кем | Exit | Результат | Доказательство |
|---|---|---|---|---|---|
| T11-01 | `executionIdentity.test.ts` «запуск модели A у исполнителя B…»; `reprocess.int` «T11-01: … ноль вызовов, blocked…» | AGENT / USER | 0 / — | unit PASS; int NOT_RUN | вывод vitest (121 passed) |
| T11-02 | `reprocess.int` «T11-02: частичный запуск A не продолжается моделью B…», «поставленный прежней конфигурацией…» | USER | — | NOT_RUN | — |
| T11-03 | `reprocess.int` «T11-03: ИИ-допуск отозван после первого из нескольких чанков…» | USER | — | NOT_RUN | — |
| T11-04 | `executionIdentity.test.ts` «T11-04: перед повтором допуск отозван…»; `reprocess.int` «T11-04: допуск истёк…» | AGENT / USER | 0 / — | unit PASS; int NOT_RUN | vitest |
| T11-05 | `reprocess.int` «T11-05: ответ пришёл после отзыва…» | USER | — | NOT_RUN | — |
| T11-06 | `executionIdentity.test.ts` «T11-06: в идентичность входят…», «другая модель, параметры, схема или нарезка…» | AGENT | 0 | PASS | vitest |
| T11-07 | `executionIdentity.test.ts` «T11-07: несообщённые сервером сведения — unknown…» | AGENT | 0 | PASS | vitest |
| T11-08 | `reprocess.int` «T11-08: аренда перехвачена после первого чанка…»; прежний «два worker'а…» | USER | — | NOT_RUN | — |
| T11-09 | `reprocess.int` «TC-076: сбой позднего чанка ПОСЛЕ релевантного успешного…» (закрытие 09) | USER (09) | 0 | PASS на коде 09; на коде 11 NOT_RUN | прогон 09 B2 |
| регрессия | весь `reprocess.int` (изменены захват и сверка) | USER | — | NOT_RUN | — |

## Неизменённые ограничения
Рабочая БД, `.env`, источники, флаги, модель (LM Studio не вызывался) не трогались. extract@3 остаётся текущей схемой.
Верификация не ослаблялась. Атрибуция исторических запусков не переписывалась.

## Миграция и откат
`021_run_execution_identity.sql` — additive, не destructive; применяет пользователь (`npm run migrate`). Прежние запуски читаются как
historical. После обновления поставленные ранее и не начатые запуски не захватываются новым worker'ом — `pipeline:once -- --retry`
ставит вместо них новые (прежние → `cancelled` с причиной). Откат кода — `git revert`; колонка 021 безвредна для прежнего кода.

## Открытые риски
- Отмена ушедшего запроса — best-effort: текст мог быть обработан моделью до отмены.
- `CANDIDATE_BUILD_VERSION` меняется вручную — при смысловой правке проверки её нужно поднять (записано в ADR-004 и CLAUDE.md).
- Интеграционные сценарии этапа не прогонялись.

## Следующий шаг пользователя
`evidence/11/USER_RUN.md`.
