# Отчёт этапа 15B — Рабочее место контроля запусков и публикации

Дата: 2026-09-17. Ветка `main`, основа `9ad8023`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_15B_PIPELINE_WORKBENCH.md`.

## Статусы
IMPLEMENTED: да (API, UI; миграций нет)
CODE_CHECKED: backend typecheck PASS; unit `src/api src/reprocess` — 104 PASS (9 файлов); frontend `npm run build` PASS, `npm run check:build` PASS
REVIEWED: NOT_RUN
USER_VALIDATED: DB-интеграция и браузер — NOT_RUN (`evidence/15B/USER_RUN.md`)

## Что было на ветке (F16 подтверждено)
- `GET /api/reprocess/runs` — только `sourceItemId` и `limit ≤ 200`, без total и курсора; 201-й запуск не виден.
- Карточки запуска, отмены, повтора и постановки одной редакции в API нет (только CLI); экрана нет.
- Публикация сверяла только версию публикации: новое решение аналитика или решение по упоминанию после предпросмотра
  не меняли версию — публиковался расчёт по прежнему состоянию. Полнота запуска при публикации явно не проверялась
  (набор создаётся только при completed, но проверки в самой публикации не было).
- Ошибки загрузки в UI в ряде мест выглядели как пустой результат.

## Изменения
| Файл | Что |
|---|---|
| `backend/src/reprocess/workbench.ts` (новый) | `listRuns` (фильтры источник/публикация/редакция/статус/схема/отпечаток, total, курсор `beforeId`), `getRunDetail` (REPEATABLE READ: редакция и последняя редакция, публикация, цепочка повторов, чанки и ответы без raw/payload, кандидаты с цитатами и вердиктом, неоднозначности редакции, in-flight), `cancelRun`, `retryRunOnce`, `enqueueRevision` |
| `backend/src/reprocess/publish.ts` | `publish-preview@1`: `previewToken`, `run.complete` в предпросмотре; публикация отвергает неполный запуск (422) и изменённое состояние (409 `PublishPreviewStaleError`); `nextStep` в отказах |
| `backend/src/api/reprocess.routes.ts` | `GET /runs` (совместимое поле `runs`), `GET /runs/:id`, `POST /revisions/:id/runs`, `POST /runs/:id/retry`, `POST /runs/:id/cancel`; токен обязателен для publish |
| `backend/src/api/assertions.routes.ts` | у доказательства `runId` (через чанк) |
| `frontend/src/pages/RunsPage.tsx`, `RunPage.tsx`, `components/PublishPreviewPanel.tsx`, `lib/loadError.ts` (новые) | список, карточка, предпросмотр и публикация; ошибки соединения/401/403/404/5xx отдельно от пустого списка |
| `frontend/src/App.tsx`, `AdminPage.tsx`, `AssertionDetail.tsx`, `api/types.ts`, `lib/labels.ts` | маршруты `/runs`, `/runs/:id`; ссылка из админки; «запуск #N» у доказательства |
| тесты | `reprocess/workbench.test.ts` (новый), `api/auth.test.ts` (+401 для 4 маршрутов, +403 без CSRF), `reprocess.int.test.ts` (describe «этап 15B», 7; прежний API-тест публикует с токеном) |

## Контракты и переходы
- `GET /api/reprocess/runs?sourceId&sourceItemId&revisionId&status&schemaVersion&fingerprint(hex-префикс)&beforeId&limit≤100` →
  `{items, total, nextBeforeId, runs(=items), worker:{pipelineEnabled, autoPublish}}`. Лимит снижен с 200 до 100 (постранично).
- `usage.tokensIn/tokensOut/latencyMs = null`, если хоть один ответ их не сообщил или ответов нет — не досчитываются.
- `POST /reprocess/revisions/:id/runs` → 201 queued / 200 already_live / 422 refused_policy / 404. Модель не вызывается.
- `POST /reprocess/runs/:id/retry` → 201 queued / 200 already_retried (повтор той же команды) / 422 refused_policy / 409 not_retryable.
- `POST /reprocess/runs/:id/cancel` → 200 `{previousStatus, inFlight, note}` / 409 not_cancellable / 404.
- `POST /reprocess/sets/:id/publish` `{expectedVersion, expectedPreviewToken, allowStale}` → 200 outcome (+`nextStep`) / 409 `version_conflict` | `preview_stale` / 422 `not_publishable` / 400 без токена.
  **Несовместимость:** клиент без токена получает 400; UI и тесты обновлены, CLI `--publish` вызывает сервис напрямую (сверяет версию, как прежде).

Переходы запуска (дополнение к `runs.ts`): `queued|running ─cancel─▶ cancelled` (fencing +1: держатель не пишет ответ и не шлёт
следующий чанк; ушедший запрос не отзывается). Набор: публикация проверяет по порядку статус набора → полноту запуска (422) →
версию (409) → допуск (`rejected_policy`, записывается) → устаревшую редакцию (`rejected_stale`, записывается) → токен (409, без записи).

`publish-preview@1` включает: статус набора и запуска, отпечаток, покрытие, активный набор и версию публикации, последнюю редакцию,
статусы допуска источника, последнее решение аналитика по утверждениям активного набора, последнее решение по упоминаниям
редакции (15A). **Ограничение:** решения по утверждениям, которые появятся впервые при этой публикации, до неё неизвестны.

## Разрешения и недоступные действия
- Все изменяющие маршруты — после входа, с CSRF и проверкой Origin (общий `app.ts`); CORS не авторизация.
- Массовой постановки нет (осознанно): «переобработать всё» не добавлялось; пакет — только CLI `--reextract --limit`.
- `REPROCESS_AUTO_PUBLISH` и `PIPELINE_ENABLED` UI не меняет; при выключенном исполнителе поставленный запуск ждёт
  `npm run pipeline:once` — это показывается, а не подменяется успехом.
- Решения «проверено аналитиком» для кандидатов модели не выставляются; очередь неоднозначностей (15A) — только ссылкой.

## Проверки
| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T15B-01 | `reprocess.int` «невалидный чанк виден в карточке…» | USER (DB) | NOT_RUN |
| T15B-02 | `reprocess.int` «решение аналитика после предпросмотра — 409…», «допуск отозван или новая редакция…» | USER (DB) | NOT_RUN |
| T15B-03 | `reprocess.int` «повтор той же команды идемпотентен; отмена поставленного…» | USER (DB) | NOT_RUN |
| T15B-04 | `reprocess.int` «отмена выполняемого — in-flight…» | USER (DB) | NOT_RUN |
| T15B-05 | `auth.test.ts` 401/403; `reprocess.int` «без cookie, без CSRF и с чужим Origin…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T15B-06 | `reprocess.int` «105 запусков не теряются…» | USER (DB) | NOT_RUN |
| T15B-07 | `workbench.test.ts` (правило полноты); `reprocess.int` «набор запуска с неполным покрытием…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| UI | `evidence/15B/USER_RUN.md` шаг 4 | USER | NOT_RUN |

Полный unit-прогон всех файлов не выполнялся (память среды); запущены затронутые каталоги.

## Миграция и откат
Миграций нет; индексы не менялись. Прежние запуски, наборы и публикации читаются без изменений (исторические отпечатки
помечаются). Остановить функцию: не использовать `/runs` и новые POST (или `git revert`) — история запусков, ответов и публикаций
не удаляется; отменённые запуски остаются `cancelled` с причиной.

## Открытые риски
- Списковый запрос считает агрегаты по чанкам для каждой строки страницы — на больших объёмах измерить (этап 18).
- Отмена не отзывает текст, уже отправленный в модель; фоновый исполнитель узнаёт об отмене на следующей проверке аренды (≤ 5 с).

## Следующий шаг пользователя
`docs/development/evidence/15B/USER_RUN.md` (можно пакетом после 19).
