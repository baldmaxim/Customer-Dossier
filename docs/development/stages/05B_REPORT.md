# Отчёт этапа 05B — Разрешённый Telegram-сбор, курсоры и правки

Дата/время: 2026-09-15 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **PASS** (2026-09-15, прогон пользователя @ `5a62b94` — [evidence/05B/USER_RUN.md](../evidence/05B/USER_RUN.md)): unit 25 / 356, интеграция 13 файлов / 148, раздел I ок. Экран 390 px — NOT_RUN.
`LIVE_SOURCE=NOT_RUN`: согласованных каналов нет, токен бота не запрашивался.

## Исходная база

- Ветка `dossier-stages`, 05A закрыт коммитом `0cbbf8d` (PASS по прогону пользователя).
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_05B_TELEGRAM.md`; зависимость — `05A_REPORT.md`.
- Соответствие путей: `ingest/telegramWeb.ts`, `telegramBot.ts`, `scheduler.ts`, `store.ts`, `cli.ts`, `__fixtures__` — на месте.
  Новое — `ingest/telegram/` (возможности, обход канала, тесты); разборщик и бот расширены на месте, дубликатов нет.

## Инвентаризация доступа

| Способ | Что даёт | Состояние |
|---|---|---|
| web-preview `t.me/s/<канал>` | публичные посты, пагинация `?before=`, метка «edited» без даты, пересылка с именем/ссылкой | адаптер на фикстурах; живой — NOT_RUN |
| long-polling бот | только сообщения, пересланные пользователем из allowlist; `edited_message`; `forward_origin` | адаптер на внедрённом API; живой — NOT_RUN |
| MTProto, чужие сессии, закрытые каналы | — | не вводится |

Реестр источников (по миграциям, рабочая база не читалась): каналы-сиды — `paused`, допуск `unknown`;
источник `manual/bot` — допуск `unknown`. Ни один не включался, допуск не менялся.

Локальные переменные для живого бота (значения задаёт пользователь в `.env`, в чат не присылать):
`TG_BOT_TOKEN`, `TG_BOT_ALLOWED_USER_IDS`, `BOT_ENABLED`.

## Возможности транспортов (`ingest/telegram/capabilities.ts`, сверено 2026-09-11)

| Возможность | web-preview | бот |
|---|---|---|
| история | limited: ограниченная пагинация | not_supported: только новые обновления, хранятся ограниченно |
| правки | limited: только в окне перепроверки первой страницы | supported: `edited_message` |
| дата правки | not_supported | supported: `edit_date` |
| удаления | not_observable | not_observable |
| медиа | limited: подпись, размер альбома; файлы не читаются | limited: подпись, тип вложения |
| происхождение пересылки | limited: имя и ссылка, если показаны | limited: `forward_origin`; скрытый автор — только имя |

## Что изменилось для пользователя

- Канал больше не теряет посты между проходами: разрыв записывается и догружается ограниченно, граница истории видна.
- Сбой на странице, отзыв допуска или чужой канал на странице — разные исходы, курсор не уходит вперёд.
- Правка поста и короткое опровержение сохраняются новой редакцией.
- Бот не дублирует сообщение после перезапуска и не теряет несохранённое; правки пересланных сообщений сохраняются;
  скрытый автор пересылки не превращается в выдуманный канал.
- В админке у Telegram-источника — здоровье, итог, покрытие и причина остановки словами.

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/016_telegram_cursors.sql` (новый) | `bot_processed_updates` (append-only), `source_observations.transport_meta`, исходы `policy_blocked/identity_changed/not_found/private`, здоровье `identity_uncertain` | только расширение |
| `backend/src/ingest/telegram/capabilities.ts` (новый) | флаги возможностей транспортов | — |
| `backend/src/ingest/telegram/webCrawler.ts` (новый) | курсор `cursor.tg`, разрыв, граница истории, перепроверка, идентичность канала, допуск в транзакции | прежний `last_post_id` читается как `lastPostId` |
| `backend/src/ingest/telegramWeb.ts` | канал из `data-post`, `edited`, пересылка `{name, username, messageId}`, размер альбома, тестовый транспорт | поля добавлены |
| `backend/src/ingest/telegramBot.ts` | журнал обновлений, транзакция на обновление, `edited_message`, `describeForwardOrigin`, `possibleGap`, тестовый API | offset из журнала; `channel_post` не обрабатывается |
| `backend/src/ingest/scheduler.ts`, `sources.ts`, `sites/crawler.ts` | Telegram через `crawlTelegramChannel` + `finishSiteRun`; новые исходы | `policy_blocked` не увеличивает fail_streak |
| `backend/src/ingest/store.ts`, `revisions/store.ts` | `transportMeta` в наблюдении; `too_short` только для новой публикации | — |
| `frontend/src/lib/labels.ts`, `api/types.ts`, `components/SourceHealth.tsx` | подписи новых исходов и причин остановки | — |
| тесты: `ingest/telegram/telegram.test.ts` (unit), `telegram.int.test.ts` (интеграция), `__tests__/integration/seedTelegramDemo.ts`, script `seed:test-telegram` | см. «Тесты» | интеграция — у пользователя |
| `ADR-007-telegram-cursors.md` (новый), `CLAUDE.md`, `README.md`, `TESTING_LOCAL.md` (A, I), `PATCH_COVERAGE.md` (R12, R13) | решения и инструкция | — |

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Typecheck/build backend и frontend | `tsc --noEmit`, `npm run build` | — | 0/0 | PASS | среда агента |
| Unit | `npm test` | мёртвый URL | 0 | PASS: 25 / 356 (было 24 / 352) | среда агента |
| Разбор: правка, скрытая пересылка, альбом, пересылка со ссылкой; подпись без вложения — не full; возможности | `telegram.test.ts` | unit | 0 | PASS | — |
| TC-047 первая страница не покрывает backlog: граница истории, разрыв и ограниченная догрузка без дублей | `telegram.int.test.ts` | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Сбой страницы разрыва после сохранения первой | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Отзыв допуска во время прохода (web и бот) | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Чужой канал в `data-post` — identity_changed | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| TC-049 правка существующего поста и короткое опровержение | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Одинаковый текст в двух каналах — две публикации | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Пересылка без происхождения (web и бот `hidden_user`); подпись без вложения | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| TC-048 повтор обновления и перезапуск long polling; сбой посреди пачки | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| TC-050 правка сообщения ботом; пустой allowlist; пропуск update_id | то же | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Регрессия 01–05A (12 файлов / 135) | `npm run test:integration` | tg_info_test | 0 | PASS | 13 файлов / 148 |
| Seed, база, админка | TESTING_LOCAL I | tg_info_test | 0 | PASS | evidence/05B/USER_RUN.md |
| Живой канал / живой бот | — | — | — | NOT_RUN | допуска и токена нет |
| Экран 390 px | браузер | — | — | NOT_RUN | — |

## Данные, безопасность и откат

- Рабочая БД не подключалась; миграция 016 к ней не применялась; источники не включались, допуски не менялись;
  запросов к Telegram не было. Docker в среде агента не запускался. `.env` не менялся, ключи не запрашивались.
- Флаги: новых нет; `INGEST_ENABLED=false`, `BOT_ENABLED=false`.
- Откат: пауза источника или `BOT_ENABLED=false`. Курсор, разрыв, журнал обновлений и редакции не обнулять.

## Непроверенное, остаточные риски

- Селекторы web-preview написаны по известной разметке, не сверены с живой страницей (нужна проба после допуска).
- Правки старых постов вне первой страницы web-preview не видны; удаления не наблюдаются.
- Бот не видит сообщений, пришедших, пока он был выключен дольше срока хранения обновлений Bot API: `possibleGap`
  показывает только скачок номеров внутри полученного.
- Один канал под новым username — новая неопределённость, склейку делает оператор (стабильный id канала web-preview не отдаёт).
- Альбом в web-preview может прийти несколькими постами; объединение по media group не делается.

## Завершение

Следующий промт после подтверждения прогона: **`prompts/Customer_Dossier_Prompts/stages/STAGE_06_RELATIONS_EVENTS.md`**.
