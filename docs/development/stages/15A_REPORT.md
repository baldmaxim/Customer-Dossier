# Отчёт этапа 15A — Разрешение неоднозначностей и история решений при слиянии

Дата: 2026-09-17. Ветка `main`, основа `1b0cf46`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_15A_IDENTITY_WORKBENCH.md`.

## Статусы
IMPLEMENTED: да (API, резолвер, UI, миграция 023)
CODE_CHECKED: backend typecheck PASS; unit `src/resolve src/dossier src/pipeline src/api` — 207 PASS (13 файлов), `src/release` PASS; frontend `npm run build` PASS
REVIEWED: NOT_RUN
USER_VALIDATED: DB-интеграция и браузер — NOT_RUN (`evidence/15A/USER_RUN.md`)

## Что было на ветке (F14, F15 — подтверждено)
- `GET /api/entities/ambiguities` — `LIMIT 100` без фильтра и пагинации; экрана разбора нет: очередь проверки вела на `/admin`, где неоднозначностей нет.
- Мутации решения по неоднозначности не было; `status/resolved_entity_id` в `resolution_ambiguities` никто не писал.
- Применение слияния сверяло только версии сущностей: новое доказательство или решение аналитика после предпросмотра версию не меняет — старая оценка применялась молча.
- Линия решений (`loadPriorDecisions`, закрытие 09) уже была; при двух путях к одному решению строка могла повториться с разными `merge_id`.

## Изменения
| Файл | Что |
|---|---|
| `docs/migrations/023_ambiguity_decisions.sql` (новый) | `resolution_ambiguities.version`; `ambiguity_decisions` (append-only, reason ≠ пусто, entity_id ⇔ resolved_to, idempotency_key UNIQUE, request_hash); индексы списка |
| `backend/src/resolve/ambiguities.ts` (новый) | `checkAmbiguityChoice` (чистая), `listAmbiguities` (фильтр, курсор, total), `getAmbiguity`, `decideAmbiguity`, `analystMapping` |
| `backend/src/resolve/company.ts`, `project.ts` | при неоднозначности сначала решение аналитика для этой редакции (`analyst_mapping`, без алиаса); смена кандидатов повышает `version` |
| `backend/src/resolve/entityMerge.ts`, `merge.ts` | `previewToken` (`merge-preview@1`), `MergePreviewStaleError`; `ambiguityDecisions` в `dependencyState` |
| `backend/src/api/entities.routes.ts` | список с пагинацией, карточка, `POST …/decisions`; токен предпросмотра обязателен для merge API; 409 `merge_preview_stale` |
| `backend/src/pipeline/cli-merge.ts` | CLI применяет с токеном своего предпросмотра |
| `backend/src/dossier/facts.ts` | `DISTINCT ON (for_id, decision)` — одно решение через цепочку слияний один раз |
| `backend/src/release/manifestSpec.ts`, `inventory.ts` | новая таблица в манифесте (history) и контрольных числах |
| `frontend/src/components/AmbiguityDetail.tsx`, `AmbiguityList.tsx` (новые) | цитата, редакция, кандидаты с реквизитами и запретами, причина неопределённости, три действия, история; ошибки сервера показываются |
| `frontend/src/pages/ReviewQueuePage.tsx` | «нерешённая идентификация» — постраничный список; строка очереди раскрывает разбор |
| `frontend/src/components/MergeQueuePanel.tsx` | токен предпросмотра, без фонового обновления предпросмотра, сообщение об устаревании |
| тесты | `resolve/ambiguities.test.ts` (новый, 13), `api/auth.test.ts` (+401/403 решения), `resolve/identity.int.test.ts` (describe «этап 15A», 6) |
| документы | ADR-005 дополнение, этот отчёт, `evidence/15A/USER_RUN.md`, STATE, CLAUDE.md |

## Контракты
- `ambiguity-decision@1`: `{decision: resolved_to|kept_unknown|dismissed, entityId?, reason, expectedVersion, idempotencyKey}` → 201/200 replay; 400, 404, 409 `version_conflict`, 422 `idempotency_mismatch` | `choice_blocked` (conflicts).
- `merge-preview@1`: `previewToken` в предпросмотре; `POST /api/entities/merge` и `/api/admin/merges/:id/merge` требуют `expectedPreviewToken` (400 без него).
  **Несовместимость:** внешний клиент без токена получает 400 — в проекте таких нет (UI и CLI обновлены).
- `GET /api/entities/ambiguities?status&kind&limit≤100&cursor` → `{items,total,nextCursor}` (раньше `{items}`); курсор — base64url `[updatedAt, id]`.

## Что неизменяемо, что вручную, что не разрешается
- Неизменяемо: `ambiguity_decisions` (триггер), решения аналитика на исходных утверждениях, журнал слияний, снимки.
- Вручную: каждое решение по упоминанию; применение решения к канону — только новым запуском разбора редакции (03B), не этим API.
- Сознательно не разрешено: выбор против реквизита или формы из текста (исключения нет); решение без редакции не применяется
  резолвером; город не сверяется; `unmerge` не добавлялся (существующая отмена — только при неизменных зависимостях).
- Глобальное слияние из очереди проверки не вызывается — только очередь слияний с предпросмотром и флагом.

## Проверки
| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T15A-01 | `ambiguities.test.ts` «два ООО с разными ИНН…»; `identity.int` «решение действует на это упоминание…», «список постраничный…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T15A-02 | `ambiguities.test.ts` «контракт решения»; `identity.int` «неверная версия — 409; решение, повтор…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T15A-03 | `ambiguities.test.ts` форма/слитая/не кандидат; `identity.int` «выбор против реквизита…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T15A-04 | `ambiguities.test.ts` «токен предпросмотра»; `identity.int` «новое доказательство после предпросмотра…» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T15A-05 | `identity.int` «решение на исходном утверждении видно через цепочку слияний…» | USER (DB) | NOT_RUN |
| T15A-06 | то же (одно решение один раз; автор и время прежние) | USER (DB) | NOT_RUN |
| T15A-07 | `auth.test.ts` 401 без сессии, 403 без CSRF для `POST …/decisions` | AGENT | PASS |
| Старый снимок при слиянии | `snapshot.int.test.ts` (закрытие 09, без изменений) | USER (DB) | NOT_RUN на этом коде |
| Браузер: разбор, stale apply, досье, снимок | `evidence/15A/USER_RUN.md` шаг 4 | USER | NOT_RUN |

Полный unit-прогон всех файлов в среде агента не выполнялся (память); запущены затронутые каталоги.

## Миграция и откат
023 — additive (колонка с DEFAULT, новая таблица, индексы, триггер). Прежний код читает старые данные без изменений; старые
неоднозначности получают `version = 1`. Остановить функцию: не вызывать `POST …/decisions` (или `git revert` кода — таблица
и история остаются, резолвер без решений ведёт себя как до 15A). Строки 023 не удалять.

## Открытые риски
- Решение не применяется к уже опубликованному канону само: нужен повторный запуск разбора редакции (массовый — вне этапа).
- Окно ±200 code points для реквизита — эвристика: реквизит соседней компании в том же абзаце может запретить верный выбор (ошибка в безопасную сторону).
- Город и корпус в неоднозначности не сверяются.

## Следующий шаг пользователя
`docs/development/evidence/15A/USER_RUN.md` (можно пакетом после 19).
