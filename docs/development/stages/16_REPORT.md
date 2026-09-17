# Отчёт этапа 16 — Подключение и наблюдаемость конкретных источников

Дата: 2026-09-17. Ветка `main`, основа `c356f45`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_16_SOURCE_ONBOARDING.md`.

## Статусы
IMPLEMENTED: да (контракт профиля, состояния, реестр возможностей, защита пагинации, UI, шаблоны, runbook)
CODE_CHECKED: backend typecheck PASS; unit `src/ingest src/release` + `api/auth.test` — 161 PASS (13 файлов); frontend `npm run build` PASS
REVIEWED: NOT_RUN
USER_VALIDATED: DB-интеграция и браузер — NOT_RUN; живые источники — NOT_RUN (списка адресов и оснований нет)
Итог: **READY_FOR_OPERATOR_CONFIG**. LIVE_SOURCE_VALIDATED — пусто (`docs/development/sources/VALIDATED_SOURCES.md`).

## Что было на ветке (F17)
Подтверждено, что уже реализовано (не переписывалось): строгий профиль сайта `site@1` (RSS и HTML-список), полнота по
происхождению, `parser_degraded`/429/403/oversize/`config_invalid`, курсоры сайта и Telegram одной транзакцией с записями,
разрыв Telegram, журнал бота, возможности Telegram-транспортов, `safeFetch` с проверкой редиректов, проба без записи.
Не хватало: контракта подключения (владелец, основание, пути, бюджет), единого состояния «никогда не запускался / деградация /
временная ошибка / неполная история», реестра возможностей сайтов, защиты от цикла пагинации A→B→A (обход крутился до
`maxPages`), профиля Telegram через CLI, шаблонов и таблицы проверенных источников.

## Изменения
| Файл | Что |
|---|---|
| `backend/src/ingest/profileMeta.ts` (новый) | `source-profile@1`: схема meta (unknown по умолчанию, основания — ссылки, `reviewStatus`), `pathAllowed` |
| `backend/src/ingest/sourceHealth.ts` (новый) | `source-health@1`: `classifySourceHealth` (6 состояний, разрывы, `totalKnown=false`, ИИ отдельно), `listPageDegraded` |
| `backend/src/ingest/capabilities.ts` (новый) | реестр возможностей 4 адаптеров |
| `backend/src/ingest/sites/profile.ts`, `telegram/webCrawler.ts` | `meta` в профилях; `telegramProfileSchema` экспортирована |
| `backend/src/ingest/sites/crawler.ts` | записи вне `allowedPathPrefixes` не открываются; цикл пагинации → `pagination_loop`, `parser_degraded`; проверка деградации — общей функцией |
| `backend/src/ingest/cli.ts` | `--telegram-profile <канал> --file` (схема до записи, допуск не меняется) |
| `backend/src/api/admin.routes.ts` | `GET /admin/sources`: `healthState` у каждого источника, `capabilities` |
| `frontend/src/components/SourceHealth.tsx`, `api/types.ts`, `lib/labels.ts` | состояние словами, причина, разрывы, «полнота истории: неизвестна», ИИ отдельно |
| `backend/src/ingest/sourceContract.test.ts` (новый, 15) | профиль, фикстуры страниц, состояния, реестр, шаблоны |
| `backend/src/ingest/sites/sites.int.test.ts` | «этап 16»: цикл пагинации, префиксы пути (2) |
| `docs/development/sources/*` (новые) | `SOURCE_PROFILE_CONTRACT.md` (контракт, возможности, состояния, runbook), шаблоны сайта и канала, `VALIDATED_SOURCES.md` (пусто) |

## Фикстуры контрактных тестов
Написаны по известной разметке, не скачаны. Покрыто офлайн: полная статья / анонс под paywall / anti-bot заглушка (failed, текст пуст),
законно пустая лента / слом вёрстки (большая страница или прежние записи), неизвестная дата (null, не «сегодня»), вложение без текста
(unsupported, без OCR), ссылка «дальше» на ту же страницу. Уже покрыто прежними тестами и не дублировалось: правка поста и новая
редакция (`telegram.int`), закрытый канал (`telegramWeb.test` `isPrivateChannelStub`), недоступная статья — честный анонс и редирект
вне allowlist (`sites.int`), подпись без вложения (`telegram.test`), курсор при сбое поздней страницы и инъекция отказа записи (`sites.int`, `telegram.int`).

## Проверки
| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T16-01 | `sourceContract` «законно пустая лента и сломанный селектор», «шесть различимых состояний»; `sites.int` TC-045 | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T16-02 | `sourceContract` «основание в профиле не выдаёт допуск», «префиксы пути»; `sites.int` «адрес вне allowedPathPrefixes» | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T16-03 | `sourceContract` «полная статья, анонс под paywall и anti-bot»; `website.test` TC-016 | AGENT | PASS |
| T16-04 | `sourceContract` «неизвестная дата — null» | AGENT | PASS |
| T16-05 | `sites.int` «сбой второй страницы…», «цикл A→B→A»; `telegram.int` TC-077 | USER (DB) | NOT_RUN |
| T16-06 | `sourceContract` «реестр возможностей», «полнота истории всегда неизвестна; разрыв Telegram границами»; `telegram.int` TC-047 | AGENT / USER (DB) | unit PASS; DB NOT_RUN |
| T16-07 | `sites.test` «редирект … наружу — запрет политики»; `safeFetch.test` «редирект на metadata-адрес блокируется», «по умолчанию loopback-сервер недоступен» | AGENT | PASS (прежние тесты) |
| T16-08 | `sourceContract` «шаблоны проходят схему, остаются draft» | AGENT | PASS |
| Живой сайт / канал | `evidence/16/USER_RUN.md` шаги 4–7 | USER | NOT_RUN — нет утверждённого списка |

## Миграция, совместимость, откат
Миграций нет. `meta` необязательна: прежние профили читаются как раньше. Ответ `GET /admin/sources` получил поля
`healthState`, `capabilities` (добавление). Новый исход покрытия `pagination_loop` пишется в `source_runs.coverage`.
Откат — `git revert`; история запусков, курсоры и публикации не затрагиваются. Остановить подключение: `paused` или отзыв допуска.

## Открытые риски
- `allowedPathPrefixes` применяется к записям списка/ленты; стартовые страницы и пагинация им не фильтруются (они заданы оператором).
- Anti-bot страница с похожей разметкой может совпасть с `bodySelector` — полнота тогда `full`; видно только пробой на живом источнике.
- UI пробы Telegram нет (CLI `--probe`); проба сайта в админке — прежняя.

## Следующий шаг пользователя
Шаги 1–3 `evidence/16/USER_RUN.md`; для живых шагов — сначала список адресов/каналов с основаниями.
