# Отчёт этапа 02 — Публикации, версии и полнота исходных данных

Дата/время: 2026-09-14 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **PASS** (2026-09-14, по прогону пользователя — [evidence/02/USER_RUN.md](../evidence/02/USER_RUN.md)).
Интеграционные тесты на PostgreSQL 7 файлов / 61 тест, backfill CLI, API и данные панели версий — ок.
Визуальная проверка UI (390 px, метки, ссылка «версии») — NOT_RUN. Замечание прогона (compose и File Sharing)
исправлено: compose без bind-mount, в инструкции добавлен запасной `docker run`.

## Исходная база

- Ветка `dossier-stages`, этап 01 — коммит `d5ad8a3` (pushed). Stage prompt:
  `prompts/Customer_Dossier_Prompts/stages/STAGE_02_DOCUMENT_REVISIONS.md`; зависимость — `01_REPORT.md`.
- Порядок работы по указанию пользователя: коммит и push после этапа; Docker и тесты с базой — у пользователя.

## Что изменилось для пользователя

- Правка поста больше не теряется: сохраняется новая неизменяемая редакция, прежний текст и цитаты целы.
- Один и тот же текст в разных каналах — отдельные публикации со своей историей; общий текст виден как перепечатка.
- У каждой редакции видно, полный ли это текст, анонс, подпись к фото или неизвестно, и какие вложения не прочитаны.
- В карточке компании у упоминания появилась ссылка «версии»: список публикаций документа, их редакции,
  текст любой редакции и построчное сравнение двух.
- Старые документы можно перенести в новую модель командой `npm run backfill:revisions` (по умолчанию dry-run).

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/011_source_items_revisions.sql` (новый) | `source_items`, `document_revisions` (UPDATE/DELETE запрещены триггером), `source_observations`, `backfill_checkpoints`, enum полноты и состояния | только расширение; legacy-таблицы не меняются |
| `backend/src/revisions/identity.ts` (новый) | канонический URL (закрытый список tracking-параметров), ключ публикации, каноническая форма и хэш текста редакции | — |
| `backend/src/revisions/decide.ts` (новый) | решение: new_item / new_revision / unchanged / stale, хронология | — |
| `backend/src/revisions/store.ts` (новый) | запись наблюдения в транзакции с блокировкой публикации; tombstone наблюдённого удаления | — |
| `backend/src/ingest/store.ts` | единая точка записи: публикация + legacy-документ только для первой редакции; новые исходы `new_revision/unchanged/stale`; вне транзакции — собственная транзакция | `edited_skipped` остаётся только при `REVISION_WRITE_ENABLED=false` |
| `backend/src/config/env.ts`, `backend/.env.example` | флаг `REVISION_WRITE_ENABLED` (по умолчанию true) | откат — false |
| `backend/src/ingest/telegramWeb.ts`, `telegramBot.ts`, `website.ts`, `scheduler.ts`, `api/manual.routes.ts`, `ingest/cli.ts` | полнота и вложения по происхождению текста, представление текста, `fetchedAt`; бот различает текст и подпись; ручная вставка без даты — `published_at NULL` (B-16 для ручной вставки) | поведение сбора не включалось |
| `backend/src/ingest/sources.ts` | удаление источника учитывает и публикации | — |
| `backend/src/revisions/backfill.ts`, `revisions/cli.ts` (новые), `package.json` | идемпотентный backfill с dry-run, пакетами, checkpoint, advisory lock и отчётом неоднозначностей; script `backfill:revisions` | рабочий backfill не выполнялся |
| `backend/src/revisions/diff.ts` (новый), `api/revisions.routes.ts` (новый), `api/admin.routes.ts`, `app.ts`, `api/companies.routes.ts` | API: `/api/documents/:id/items`, `/api/items/:id`, `/api/items/:id/revisions`, `/api/revisions/:id`, `/api/revisions/:id/diff?against=`, `/api/admin/sources/:id/health`; `documentId` в упоминаниях | только чтение, под входом оператора |
| `frontend/src/pages/DocumentPage.*`, `components/RevisionHistory.*` (новые), `App.tsx`, `CompanyPage.tsx`, `AdminPage.tsx`, `api/types.ts`, `lib/labels.ts` | панель публикаций и редакций, diff, ссылка «версии», подписи полноты | — |
| тесты: `revisions/revisions.test.ts`, `ingest/telegramBot.test.ts` (новые), `ingest/website.test.ts`, `ingest/telegramWeb.test.ts`; интеграционные `revisions/revisions.int.test.ts`, `revisions/revisions.api.int.test.ts`, `revisions/backfill.int.test.ts`, `__tests__/integration/http.ts`, `__tests__/integration/seedRevisionsDemo.ts` (новые) | см. «Тесты» | интеграционные — у пользователя |
| `docs/development/ADR-002-source-items-and-revisions.md` (новый), `CLAUDE.md`, `README.md`, `TESTING_LOCAL.md` | решения, правило «публикация ≠ текст», инструкция проверки | — |

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Typecheck backend/frontend | `tsc --noEmit` | — | 0/0 | PASS | среда агента |
| Сборка backend/frontend | `npm run build` | — | 0/0 | PASS | среда агента |
| Unit | `npm test` | мёртвый URL | 0 | PASS: 20 файлов / 297 тестов (было 267) | среда агента |
| canonical URL, ключ публикации, хэш редакции, решение о версии, diff, полнота адаптеров | `revisions.test.ts`, `telegramWeb.test.ts`, `website.test.ts`, `telegramBot.test.ts` | unit | 0 | PASS | — |
| TC-011 новый текст при прежнем external_id | `revisions.int.test.ts` | tg_info_test | — | PASS | evidence/02/USER_RUN.md (A5: 7 файлов / 61) |
| TC-012 повтор текущей редакции | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| TC-013 A → B → A | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| TC-014 гонка двух одинаковых записей | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| TC-015 одинаковый текст в двух источниках | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| TC-016 caption/excerpt/вложение | unit + то же | unit / tg_info_test | 0 / 0 | PASS | evidence/02/USER_RUN.md |
| TC-017 содержательный query-параметр | unit + то же | unit / tg_info_test | 0 / 0 | PASS | evidence/02/USER_RUN.md |
| Исправление без даты, запоздалое наблюдение, «пропал со страницы» без delete, tombstone | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| FK, неизменяемость, CHECK наблюдения | то же | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| TC-018 backfill дважды, с начала, неоднозначность | `backfill.int.test.ts` + CLI (TESTING_LOCAL B) | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| API версий и здоровья источника | `revisions.api.int.test.ts` | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| UI панели версий: данные через API | seed + HTTP (TESTING_LOCAL C) | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |
| UI визуально: 390 px, метка «текущая», ссылка «версии» | браузер | — | — | NOT_RUN | глазами не проверено |
| Compose тестовой базы | `docker compose … up -d --wait` | — | 1 | FAIL → исправлено | File Sharing для bind-mount; compose переписан без монтирования, повторно не прогонялся |
| Регрессия этапа 01 (4 файла, 34 теста) | `npm run test:integration` | tg_info_test | 0 | PASS | evidence/02/USER_RUN.md |

Live-source: NOT_RUN (не требуется). Реальная модель: NOT_APPLICABLE.

## Данные, безопасность и откат

- Рабочая БД не подключалась; миграция 011 и backfill к ней не применялись.
- Docker и базы в среде агента не запускались.
- Флаги по умолчанию: `REVISION_WRITE_ENABLED=true` (новая запись), сбор/разбор/бот/метрики — выключены, как в 01.
- Откат: `REVISION_WRITE_ENABLED=false` — запись возвращается к legacy-поведению, чтение не страдает;
  таблицы 011 и накопленные редакции не удалять. Старый apply остаётся выключенным.

## Непроверенное, дефекты, решения

- Визуальная проверка UI не выполнена ни у агента, ни у пользователя; новый compose без bind-mount
  повторно не прогонялся (запасной `docker run` описан в TESTING_LOCAL A4).
- Извлечение по-прежнему идёт по legacy-документу (первой редакции); разбор последующих редакций — этап 03B.
- Telegram web не даёт надёжной даты правки — хронология редакций постов `observed_order`.
- Наблюдённое удаление реализовано функцией (`recordDeletionObserved`), адаптеры его пока не сообщают — этап 05B.
- Полнота `content:encoded` — `unknown`: без проверки страницы статьи нельзя утверждать полноту.
- Legacy `edited_skipped` до миграции: такой пост при первом наблюдении после 011 получает
  `history_before_import='unknown'`, а legacy-текст в историю не подмешивается (отражается в отчёте backfill).

## Завершение

Изменённые/новые файлы — таблица «Изменения». Коммит этапа — см. `git log` ветки `dossier-stages`.
Независимое review: не выполнялось. Следующий промт после подтверждения прогона:
**`prompts/Customer_Dossier_Prompts/stages/STAGE_03A_ASSERTIONS_EVIDENCE.md`**.
