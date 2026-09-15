# Отчёт этапа 05A — Парсинг указанных сайтов и контроль качества сбора

Дата/время: 2026-09-15 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **PASS** (2026-09-15, прогон пользователя @ `6b6d173` — [evidence/05A/USER_RUN.md](../evidence/05A/USER_RUN.md)): unit 24 / 352, интеграция 12 файлов / 135, раздел H ок. Экран 390 px — NOT_RUN.
`LIVE_SOURCE=NOT_RUN`: согласованных (approved) сайтов нет, живые запросы не выполнялись.

## Исходная база

- Ветка `dossier-stages`, этап 04 закрыт коммитом `8ab278e` (PASS по прогону пользователя).
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_05A_WEBSITES.md`; зависимость — `04_REPORT.md`.
- Соответствие путей: `ingest/website.ts`, `sources.ts`, `scheduler.ts`, `store.ts`, `dedup.ts`, фикстуры `__fixtures__`,
  `net/safeFetch.ts`, `revisions/store.ts`, `frontend/src/pages/AdminPage.tsx` — на месте. Новый адаптер — `ingest/sites/*`;
  `website.ts` сокращён до прежних разборщиков (дубликатов сетевого пути нет).

## Реестр сайтов (без чтения рабочей базы — по миграциям и коду)

| Группа | Источники | Состояние |
|---|---|---|
| approved и настроен | — | нет: ни одного сайта с `access_status=approved` и профилем |
| disabled / unknown | сид 008: kapital.kz, inbusiness.kz, zakon.kz, forbes.kz, kn.kz; сид 009: erzrf.ru, stroygaz.ru, realty.rbc.ru, interfax.ru | `paused`, допуск `unknown`, профиля нет (старый конфиг приводится к rss с автопоиском ленты) |
| отсутствует в актуальном списке | актуальный список пользователя в репозитории не зафиксирован | — |

Сид-строка и домен не означают согласования; ни один источник не включался, профили для них не придумывались.

## Что изменилось для пользователя

- Сайт читается по проверяемому профилю: RSS/Atom или HTML-список с пагинацией, статья по селектору, карточки объектов.
  Профиль с ошибкой или посторонними ключами не записывается и даёт состояние «профиль некорректен» без запросов.
- Полнота честная: анонс из ленты догружается статьёй; недоступная статья сохраняется как анонс с причиной; известная
  полная версия анонсом не затирается; таблицы, PDF, изображения помечены непрочитанными.
- Сбой на второй странице не теряет её: следующий запуск продолжит с неё. Лимит страниц виден в покрытии.
- 304, 429 (пауза до Retry-After), 403 (без обхода), слишком большой ответ, запрет политики и смена вёрстки — разные
  исходы, ни один не выглядит как «новостей нет».
- В админке у источника: здоровье с причиной, последняя попытка и успех, версия парсера, длительность, найдено/сохранено/
  изменено/пропущено/ошибок, покрытие; кнопка «Проба» — одна страница, до трёх записей, ничего не сохраняет.
- Даты без года или относительные («вчера») не достраиваются; точность и сырой текст даты сохраняются.

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/015_website_adapters.sql` (новый) | `sources.health/health_reason/last_attempt_at/parser_version`; `source_runs.outcome/items_*/pages_fetched/coverage/parser_version/retry_after_at/duration_ms`; `http_cache`; `document_revisions.published_at_precision/published_at_raw`; `source_observations.parser_version` | только расширение |
| `backend/src/ingest/sites/profile.ts` (новый) | строгая схема профиля, приведение старого конфига, сетевая политика из профиля | `listSelector` без профиля отвергается |
| `backend/src/ingest/sites/dates.ts` (новый) | правило разбора дат с точностью | — |
| `backend/src/ingest/sites/parsers.ts` (новый) | лента, HTML-список, статья, карточка объекта, канонические адреса профиля | — |
| `backend/src/ingest/sites/fetcher.ts` (новый) | условные запросы, классификация исходов, Retry-After, тестовый транспорт | — |
| `backend/src/ingest/sites/crawler.ts` (новый) | обход: курсор со страницей в одной транзакции, головная фаза и хвост, полнота, degraded, покрытие | — |
| `backend/src/ingest/sites/probe.ts` (новый) | проба без записи | живой запрос только по действию оператора |
| `backend/src/net/safeFetch.ts` | `ISafeFetchDeps.transport`: подмена запроса в тестах, проверки редиректа и размера сохраняются | production-путь не изменён |
| `backend/src/ingest/scheduler.ts`, `sources.ts` | сайт — через `crawlSite`; `finishSiteRun` (исход, счётчики, здоровье, пауза 429); `setSourceConfig` | прежний `finishRun` для Telegram не менялся |
| `backend/src/ingest/store.ts`, `revisions/store.ts` | точность/сырой текст даты в редакции, версия парсера в наблюдении | необязательные поля |
| `backend/src/ingest/website.ts` | сетевой путь удалён, разборщики оставлены | `fetchSite`/`discoverFeedUrl` удалены |
| `backend/src/ingest/cli.ts` | `--probe-site` через адаптер, `--site-profile <ключ> --file` | — |
| `backend/src/api/admin.routes.ts` | здоровье и итоги запусков в списке и `/health`; `POST /sources/:id/probe`; `PUT /sources/:id/profile` | после входа оператора и CSRF |
| `frontend/src/components/SourceHealth.*` (новые), `pages/AdminPage.tsx`, `api/types.ts`, `lib/labels.ts` | колонка здоровья, проба, подсказка о профиле | AdminPage 329 строк |
| тесты: `ingest/sites/sites.test.ts` (unit), `ingest/sites/sites.int.test.ts` (интеграция), `__tests__/integration/seedSitesDemo.ts`, script `seed:test-sites` | см. «Тесты» | интеграция — у пользователя |
| `docs/development/ADR-006-website-adapters.md` (новый), `CLAUDE.md`, `README.md`, `TESTING_LOCAL.md` (A, H), `PATCH_COVERAGE.md` (R14) | решения и инструкция | — |

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Typecheck/build backend и frontend | `tsc --noEmit`, `npm run build` | — | 0/0 | PASS | среда агента |
| Unit | `npm test` | мёртвый URL | 0 | PASS: 24 / 352 (было 23 / 340) | среда агента |
| Профиль: старый конфиг, запрет кода/ключей, неполный html_list, хосты и лимиты | `sites.test.ts` | unit | 0 | PASS | — |
| Даты: exact / local_tz / date_only, без года и относительные не достраиваются | `sites.test.ts` | unit | 0 | PASS | — |
| Разбор: список, пагинация, значимый query, статья full/excerpt/unknown, вложения, контракт ленты, карточка | `sites.test.ts` | unit | 0 | PASS | — |
| Транспорт: редирект внутри/вне allowlist, размер, внутренний адрес не доходит до транспорта | `sites.test.ts` | unit | 0 | PASS | — |
| TC-042 RSS-анонс → полная статья с отрицанием; недоступная статья → честный excerpt | `sites.int.test.ts` | tg_info_test | 0 | PASS | evidence/05A/USER_RUN.md |
| Повтор без дублей; 304 по ETag — без новой редакции; правка статьи при refetchKnown — новая редакция | то же | tg_info_test | 0 | PASS | прогон 1 |
| Редирект статьи вне allowlist — запрос не уходит, анонс с причиной `policy` | то же | tg_info_test | 0 | PASS | прогон 1 |
| TC-043 HTML-список с пагинацией, даты зоны профиля, query-sensitive canonical | то же | tg_info_test | 0 | PASS | прогон 1 |
| TC-044 сбой второй страницы: курсор не ушёл дальше, повтор дочитывает; лимит страниц и хвост | то же | tg_info_test | 0 | PASS | прогон 1 |
| TC-046 отсутствие селектора / смена вёрстки — parser_degraded, курсор не двигается | то же | tg_info_test | 0 | PASS | прогон 1 |
| TC-045 429 с Retry-After без роста fail_streak; 403 без обхода; oversize; неверный профиль без запросов | то же | tg_info_test | 0 | PASS | прогон 1 |
| Карточка объекта: повтор — `unchanged` с версией парсера, не новая публикация; проба без записи | то же | tg_info_test | 0 | PASS | прогон 1 |
| Регрессия 01–04 (11 файлов / 123) | `npm run test:integration` | tg_info_test | 0 | PASS | 12 файлов / 135 |
| Seed, база, CLI, админка | TESTING_LOCAL H | tg_info_test | 0 | PASS | прогон 1 |
| Живые сайты | — | — | — | NOT_RUN | `LIVE_SOURCE=NOT_RUN`: approved-сайтов нет |
| Экран 390 px | браузер | — | — | NOT_RUN | — |

## Данные, безопасность и откат

- Рабочая БД не подключалась; миграция 015 к ней не применялась; источники не включались и допуски не менялись;
  живых запросов к сайтам не было. Docker в среде агента не запускался. `.env` не менялся.
- Флаги: новых нет; `INGEST_ENABLED=false` — фоновый сбор выключен, проба — только по действию оператора.
- Откат: пауза конкретного источника; при `parser_degraded` данные и курсор не меняются. Строки 015 не удалять.

## Замечание прогона

Unit-тест защиты слияния зависел от `MERGE_APPLY_ENABLED` в оболочке пользователя. Исправлено: профили unit и
integration фиксируют флаги записи (`MERGE_APPLY_ENABLED=false`, `REPROCESS_AUTO_PUBLISH=false`, `REVISION_WRITE_ENABLED=true`).

## Непроверенное, остаточные риски

- Ни один реальный сайт не проверен: для каждого нужен свой профиль и протокол пробы после решения о допуске.
- Автопоиск ленты — только объявленный `<link>` на главной; типовые пути `/rss`, `/feed` больше не перебираются
  (меньше запросов, но сайт без объявления требует адреса в профиле).
- Правки статей в режиме rss без `refetchKnown` не отслеживаются (осознанно: меньше запросов).
- Дата с номером дня недели или нестандартная (например «12/09/26») — `unparsed`; сырой текст сохраняется.
- Условные заголовки хранятся для страниц списка и ленты, не для статей.
- Счётчик `saved` включает перепечатки (`duplicate`) — они новые публикации, но не новые тексты.

## Завершение

Следующий промт после подтверждения прогона: **`prompts/Customer_Dossier_Prompts/stages/STAGE_05B_TELEGRAM.md`**.
