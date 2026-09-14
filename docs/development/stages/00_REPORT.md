# Отчёт этапа 00 — Инвентаризация и безопасная стартовая точка

Дата/время: 2026-09-11, 15:50–16:40 (+02:00). Исполнитель: Claude Code (Opus 5, 1M) — единственный writer;
один read-only помощник для первичного обхода кода, все выводы перепроверены чтением файлов.
Статус: **PASS** (обязательные условия этапа 00 выполнены; test/build/DB/model/UI — NOT_RUN, этапом не требуются).

## Исходная база

- Корень: `Odintsov/TG_Info` (Windows 10 Pro 19045, PowerShell 5.1 + Git Bash; не WSL). Node v24.14.1, npm 11.11.0, git 2.53.0.
- Git: ветка `main`, HEAD `6431a5ba9b518520cc755df81fe86a316747d900` (2026-09-11 14:47 +0200), 22 коммита, `main...origin/main` без расхождения по локальным ref.
- Незакоммиченные изменения до начала: нет. Untracked: `Customer_Dossier_Claude_Opus5_1M_Prompts_2026-09-11.zip` (SHA-256 `039996DA…D290`).
- Происхождение: **исходный main + собственная история; reviewed-патч не установлен** (обоснование — [PATCH_COVERAGE.md](../PATCH_COVERAGE.md)). Совпадение с `Customer-Dossier-main.zip` по хешу не проверено — архива нет.
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_00_BASELINE.md`; зависимостей нет. Прежних `STATE/HANDOFF/отчётов` в `docs/development/` не было.
- Инструкции: `TG_Info/CLAUDE.md`, родительский `Odintsov/CLAUDE.md` (существует), глобальный пользовательский `~/.claude/CLAUDE.md`. `AGENTS.md`, `.cursor/`, `.cursorrules` — нет.

## Что изменилось для пользователя

Поведение портала не менялось. Появилась проверенная карта: что реально стоит в рабочей папке, что опасно запускать
и почему, какие исправления прежнего review отсутствуют и что конкретно делать на этапе 01.
Пакет заданий распакован в `prompts/Customer_Dossier_Prompts/` (39/39 хешей совпали).

## Изменения

| Файл | Суть | Совместимость/риск |
|---|---|---|
| `prompts/Customer_Dossier_Prompts/**` | распакованный пакет заданий (untracked) | код не затрагивает; в `.gitignore` не входит — решить пользователю, коммитить ли |
| `docs/development/stages/00_REPORT.md` | этот отчёт | новый |
| `docs/development/PATCH_COVERAGE.md` | R01–R20 и точечные исправления reviewed | новый |
| `docs/development/BACKLOG.md` | дефекты B-01…B-23, противоречия инструкций I-01…I-10 | новый |
| `docs/development/STATE.md`, `HANDOFF.md` | состояние и вход для новой сессии | новые |
| `docs/development/evidence/00/COMMANDS.md` | журнал выполненных команд | новый |

Код, миграции, `CLAUDE.md`, `.env`, lock-файлы, `node_modules`, рабочая БД — **не изменялись**.

## Тесты и гейты этапа

| Gate | Команда / действие | Target | Exit | Статус | Лог |
|---|---|---|---|---|---|
| G00-1 Repository baseline | git status/log/rev-parse, ls-files | рабочее дерево | 0 | PASS | evidence/00/COMMANDS.md E00-10/11 |
| G00-2 Побочные действия startup/tests/migrate перечислены | чтение `index.ts`, `migrate.ts`, `setup.ts`, `vitest.config.ts`, `package.json` | исходники | — | PASS | раздел «Побочные действия» ниже |
| G00-3 Рабочая БД не изменена | подключений к БД не выполнялось | — | — | PASS | E00-05, «Не выполнялось» |
| G00-4 План тестовой изоляции | проект ниже | — | — | PASS | раздел «Изоляция» |
| G00-5 Старые и новые дефекты видимы | PATCH_COVERAGE + BACKLOG со ссылками на строки | исходники | — | PASS | ../PATCH_COVERAGE.md, ../BACKLOG.md |
| Целостность пакета | SHA256SUMS | prompts/ | 0 | PASS | E00-03 |
| Зависимости установлены | `npm ls --depth=0` ×2 | backend, frontend | 0/0 | PASS | E00-12 |
| backend `npm test` | — | — | NOT_RUN | NOT_RUN | запрещено этапом 00 (B-04) |
| backend/frontend `npm run build` | — | — | NOT_RUN | NOT_RUN | запрещено этапом 00 (пишет dist/tsbuildinfo) |
| `migrate --dry` | — | — | NOT_RUN | NOT_RUN | не read-only (B-03) |
| PostgreSQL integration | — | неизвестен | NOT_RUN | BLOCKED | target не определён (B-06, B-07) |

Core gates этапа 00: PASS. Live-source: NOT_RUN (не требуется). Реальная модель: NOT_RUN (LM Studio не запущен, :1234 не слушает). UI visual: NOT_RUN.

## Фактическая среда

| Компонент | Факт | Как установлено |
|---|---|---|
| PostgreSQL | порт 5432 слушают `wslrelay` (::1) и `com.docker.backend` (::) — экземпляр(ы) в WSL/Docker; `psql` 18.3 из scoop; Windows-службы нет | E00-04/05/06 |
| Рабочая БД | **unknown**: `DATABASE_URL` не задан ни в `backend/.env` (файла нет), ни в корневом `.env`, ни в переменных окружения | E00-07/08/09 |
| LM Studio | не запущен | E00-05/06 |
| `.env` | корневой `.env` содержит только `TG_BOT_TOKEN` и кодом не читается (`dotenv/config` берёт `.env` из cwd = `backend/`) | E00-08; `config/env.ts:3`; `config/env-check.ts:13-29` |
| Backend deps | express 4.22.2, pg 8.23.0, zod 3.25.76, cheerio 1.2.0, helmet 8.3.0, tsx 4.23.13, typescript 5.9.3, vitest 4.1.11 | E00-12 |
| Frontend deps | react 19.2.8, vite 6.4.3, vite-plugin-pwa 1.3.0, @tanstack/react-query 5.102.8, react-router-dom 7.18.3, sharp 0.34.5 | E00-12 |
| Сборки | `frontend/dist/` есть (сборка 09.09, с `sw.js`); `backend/dist/` нет | E00-12/15 |

## Побочные действия команд (текущий код)

| Команда | Что происходит на самом деле | Место |
|---|---|---|
| `npm run dev` (backend) | `checkDbConnection`; API на **всех интерфейсах** :4100; немедленно и затем по таймерам: сбор активных источников (сеть t.me / сайты, запись `raw_documents`, `source_runs`, курсоры), LLM-воркер (claim → `extracting`, запись `extractions`, **удаление и перезапись канона**), `REFRESH MATERIALIZED VIEW`; при непустом `TG_BOT_TOKEN` — long polling Telegram Bot API. Флагов отключения нет | `index.ts:73-91`; `metrics/refresh.ts:41-56`; `pipeline/apply.ts:92` |
| `npm run dev` (frontend) | Vite :5173, proxy `/api` → `localhost:4100`; SW в dev выключен | `vite.config.ts:58-66` |
| `npm run migrate -- --dry` | **DDL** `CREATE TABLE IF NOT EXISTS schema_migrations`, затем печать списка | `db/migrate.ts:38,53-57` |
| `npm run migrate` | каждая pending миграция в своей транзакции; 009 обнуляет `events.amount_rub`, ставит KZ-сайты на паузу, добавляет RU-сайты | `migrate.ts:59-84`; `009_switch_to_russia.sql:34,39-47` |
| `npm test` | vitest с `setup.ts`: `DATABASE_URL ??=` мёртвый адрес — **внешний DATABASE_URL выигрывает**; `TZ ??= Asia/Almaty`. Ни один из 9 тестов не подключается к БД (статически), но импорт `env.ts` тянет `dotenv/config` из cwd | `__tests__/setup.ts:8-14`; `vitest.config.ts:4-9` |
| `npm run build` (backend/frontend) | пишет `backend/dist`, `frontend/dist`, `tsconfig.tsbuildinfo`; frontend генерирует новый `sw.js` | package.json |
| `ingest:once` без флагов | полный проход сбора по активным источникам | `ingest/cli.ts`, `scheduler.ts:189-206` |
| `ingest:once --probe` / `--probe-site` | живой запрос к t.me / сайту (без БД) | `ingest/cli.ts:41-60` |
| `ingest:once --add` / `--add-site` | источник создаётся сразу `active` | `ingest/sources.ts:136-141,208-220` |
| `pipeline:once` без флагов / `--loop` | LLM + перезапись канона | `pipeline/cli.ts:121-131` |
| `pipeline:once --reextract [--source]` | ставит в очередь всё не разобранное текущей моделью/промптом → при следующем проходе стирание вклада документов | `pipeline/quality.ts:31-47` |
| `pipeline:once --renormalize` (без `--dry`) | UPDATE ключей компаний/объектов/алиасов, DELETE дублей алиасов, INSERT в `merge_queue` | `pipeline/quality.ts:107-240` |
| `pipeline:once --recheck` (без `--dry`) | UPDATE `projects` — снимает города/адреса | `pipeline/recheck.ts:84` |
| `pipeline:once --merge <id>` | необратимое слияние | `resolve/merge.ts:37-155` |
| `pipeline:once --shadow N` | LLM-запросы и запись `extractions` (канон не трогает) | `pipeline/compare.ts:28-51` |
| `metrics:refresh` | **не работает**: файла `src/metrics/cli.ts` нет | `backend/package.json:15` |

## Карта системы

**API** (`backend/src/app.ts:35-43`; авторизации нет нигде):

| Метод и путь | Эффект | Файл |
|---|---|---|
| GET `/api/health` | чтение | `app.ts:35` |
| POST `/api/manual` | запись `raw_documents` (дата по умолчанию — сейчас) | `api/manual.routes.ts:23-60` |
| GET `/api/companies?q`, `/:id`, `/:id/projects`, `/:id/mentions` (отдаёт полный `body` документа), `/:id/events`, `/:id/similar` | чтение канона и `company_risk` | `api/companies.routes.ts` |
| GET `/api/contractors`, `/summary` | чтение `company_risk` | `api/contractors.routes.ts` |
| GET `/api/admin/sources`, `/merges`, `/pipeline` | чтение | `api/admin.routes.ts:18,137,179` |
| PATCH `/api/admin/sources/:id` | включение/пауза источника | `admin.routes.ts:41` |
| POST `/api/admin/sources/telegram`, `/website` | новый источник `active`; `website` делает исходящие запросы | `admin.routes.ts:71,88` |
| DELETE `/api/admin/sources/:id[?withDocuments=true]` | удаление источника / каскад документов | `admin.routes.ts:119` |
| POST `/api/admin/merges/:id/merge`, `/reject` | необратимое слияние / отказ | `admin.routes.ts:143,158` |
| POST `/api/admin/metrics/refresh` | REFRESH MV | `admin.routes.ts:173` |

**Таблицы** (001–009): расширения `pg_trgm`, `unaccent`, `btree_gin`; `sources`, `source_runs`; `raw_documents`, `document_sightings`;
`extractions`; `companies` (`tax_id` после 009), `projects`, `project_participants`, `mentions` (полиморфный `entity_id` без FK), `events`;
`entity_aliases`, `merge_queue`; MV `company_metrics`, VIEW `company_risk`; служебная `schema_migrations`.

**UI** (`frontend/src/pages/`): `SearchPage` (поиск + распределение светофора), `CompanyPage` (вердикт, объекты, лента упоминаний, события),
`ContractorsPage` (таблица по `company_risk`), `AdminPage` (источники, очередь слияний, пайплайн); `UpdatePrompt` (PWA prompt), `useTheme`.

**Вызовы модели**: только `backend/src/llm/client.ts` — `POST ${LMSTUDIO_BASE_URL}/chat/completions` (`:57`) и `GET /models` (`:174`).
Потребители: `pipeline/worker.ts:180` (канон), `pipeline/compare.ts:51` (теневой прогон), `pipeline/cli.ts:63` (`--check`).
Адрес модели фиксирован env и не приходит из публикаций — это удобная точка для раздельной сетевой политики 01.

## Точки внедрения версий и утверждений без остановки legacy-чтения

| Этап | Новая запись | Единственная точка входа сейчас | Legacy-чтение остаётся |
|---|---|---|---|
| 02 SourceItem/Revision | вставка наблюдения/ревизии | `ingest/store.ts:51-102` `storeDocument` — её зовут `scheduler.ts:89,169`, `telegramBot.ts:259`, `manual.routes.ts:40` | `raw_documents` + `document_sightings` (связь через legacy id) |
| 03A Assertions/Evidence | утверждения и спаны из проверенного извлечения | выход `pipeline/verify.ts:257-410` | `mentions`, `events`, `project_participants` читаются `companies.routes.ts` и MV 007 |
| 03B Runs/Chunks, promotion | append-only run/chunk, атомарная публикация | `pipeline/worker.ts:141-258` (`recordExtraction`, `processDocument`), `pipeline/apply.ts:83-259` | старый apply выключается, не работает параллельно |
| 04 Identity | типизированные идентификаторы, безопасный merge | `resolve/company.ts:245-327`, `resolve/project.ts:218-282`, `resolve/merge.ts` | `companies.tax_id`, `merged_into_id` |
| 07 Read-model | объяснимые сигналы | MV `007_metrics.sql` | `company_risk` помечается legacy |
| 08A UI | досье компании/объекта/обращения | `frontend/src/pages/CompanyPage.tsx`, `api/client.ts` | текущие страницы |

## Изоляция тестов (проект для этапа 01)

1. **Отдельная цель.** Переменная `TEST_DATABASE_URL` (никогда не `DATABASE_URL`). База `tg_info_test` на **подтверждённо локальном** экземпляре (loopback). Какой из экземпляров на :5432 (WSL или Docker) использовать — решает пользователь; создавать БД только там.
2. **Guard до любого DML** (vitest `globalSetup` интеграционного профиля): хост ∈ {`127.0.0.1`, `::1`, `localhost`}; имя базы по шаблону `^tg_info_test(_[a-z0-9]+)?$`; после подключения `SELECT current_database(), inet_server_port()` совпадает с разобранным; в базе есть маркер (например, `COMMENT ON DATABASE … IS 'tg_info:test-target'`, ставится только при создании тестовой базы); если задан `DATABASE_URL` — host/port/db не совпадают. Любое несовпадение → аварийный выход без запросов.
3. **Setup.** В `setup.ts` присваивание `=` вместо `??=`: `DATABASE_URL` = мёртвый адрес для unit, `TZ=UTC`; `dotenv` не должен подтягивать `backend/.env` в тестах.
4. **Разделение профилей.** `npm test` — только unit (без сети и БД); `npm run test:integration` — отдельный config с guard. Frontend — добавить минимальный test script только если появятся тесты.
5. **Порядок проверки миграций.** (а) переписать dry-run на чтение каталога (`to_regclass('public.schema_migrations')`) без DDL; тест: снимок `pg_catalog` до/после dry на пустой тестовой базе совпадает; (б) fresh-применение 001–009 на `tg_info_test`; (в) повторный запуск — no-op; (г) предупреждение о destructive pending 009 и требование явного флага для не-тестовой цели; (д) рабочая база — только через backup → restore в копию → миграция копии, отдельным согласованием.

## Непроверенное, дефекты, решения

- Все R01–R20 — **исправлений нет** (кроме уже частично существующих защит: `grey`-состояние, пустой allowlist бота = никого, `paused` в сидах). Детали — PATCH_COVERAGE.
- Новые находки вне R-списка: B-01…B-23 (важнейшие — B-01 фоновые задания без флагов, B-02 CSRF на merge, B-10 SSRF, B-15 `--retry` не может записать успешный ответ, B-16 неизвестная дата = сейчас, B-20 «Без замечаний» при отсутствии данных).
- Противоречия инструкций I-01…I-10 — список точечных правок CLAUDE.md/README/USAGE для 01; в этапе 00 не редактировались.
- Не проверено: соответствие дерева `main.zip` по хешу; фактическое содержимое рабочей БД; работа LM Studio; живые источники; поведение SW в браузере (B-21 — статический вывод).
- Ни один дефект не воспроизведён запуском.

## План этапа 01 (кратко)

Входные условия: отчёт 00 есть; код не менялся; от пользователя нужно (1) указать локальный экземпляр PostgreSQL для тестовой базы и разрешить её создание, (2) самостоятельно вписать в `backend/.env` новые ключи (токен оператора, флаги), т.к. `.env` агенту менять запрещено.

1. **Окружение**: `npm ci` в backend и frontend (lock-файлы не менять; учесть install-скрипты `sharp`); профили `test` (unit) и `test:integration` с guard из раздела «Изоляция»; `setup.ts` без `??=`, `TZ=UTC`.
2. **Startup**: флаги `INGEST_ENABLED`, `PIPELINE_ENABLED`, `METRICS_AUTO_REFRESH`, `BOT_ENABLED` (по умолчанию false) со строгим парсером (`true/false/1/0`, иначе ошибка); `app.listen(PORT, '127.0.0.1')`; Vite `server.host`/`preview.host` = `127.0.0.1`; исправить `boolOf` (B-05). Файлы: `index.ts`, `config/env.ts`, `vite.config.ts`, `.env.example`.
3. **Оператор**: bootstrap-токен из env → `POST /api/auth/session` → HttpOnly SameSite=Strict cookie с коротким сроком; middleware на все изменяющие маршруты (`admin.routes.ts`, `manual.routes.ts`) и на выдачу документов (`/:id/mentions` отдаёт `body`); проверка `Origin`/`Host` + CSRF-токен; logout/expiry. Токена в env нет → изменяющие операции выключены (безопасный fallback).
4. **Сетевая политика**: новый модуль клиента источников (схемы http/https, порты 80/443, allowlist хостов из допущенных источников, DNS-резолв и запрет private/loopback/link-local/metadata, ручные редиректы с повторной проверкой, лимиты времени и размера); `website.ts` и `admin.routes.ts` переходят на него; `llm/client.ts` остаётся на отдельном фиксированном endpoint.
5. **Допуск источников**: новая миграция (номер — следующий свободный по реестру, ожидаемо 010) с `access_status`, `ai_processing_status`, scope, основанием, ответственным, сроком, журналом; существующие `active` → `unknown`; единый gate в `scheduler.ts`, `ingest/cli.ts`, `telegramBot.ts`, `manual.routes.ts`, `pipeline/worker.ts`, `quality.ts` (reextract); причины блокировки в `AdminPage.tsx`.
6. **Опасные пути**: заблокировать изменяющий pipeline (`--loop`, `--reextract`, `--renormalize`, `--recheck`, одиночное переизвлечение, `merge` из API и CLI) до нового apply; пометить `company_risk`/светофор как legacy в UI (`RiskBadge.tsx`, `CompanyPage.tsx`, `ContractorsPage.tsx`, `SearchPage.tsx`), убрать формулировку «Без замечаний».
7. **Runner и инструкции**: dry-run без DDL; предупреждение о 009; точечные правки I-01…I-07 в `CLAUDE.md`, `README.md`, `docs/USAGE.md`, `cli-quality.ts`, `ingest/cli.ts`; комментарий backfill в `scheduler.ts:38-41` (R12); текст ошибки `website.ts:223-226` (R14).
8. **PWA и адресные исправления**: убрать `/api/` из runtimeCaching и чистить старый кэш `api` при активации; шрифт — системный стек или локальный файл; адресно R01, R02, R04 (ИНН/сумма в цитате), R05, R06/B-15, R18, R19, R20 с регрессионными тестами.

Приёмка 01 — TC-001…TC-010 из `acceptance/TEST_MATRIX.md` в изолированной тестовой базе.

## Данные, безопасность и откат

Рабочая БД: не подключались, не изменялась. Миграции: не применялись. Backfill: нет. Backup/restore: не выполнялись.
Feature flags: в коде отсутствуют (B-01); фактические значения `.env` приложения неизвестны (файла `backend/.env` нет).
Секреты: не выводились; по `.env` зафиксированы только имена ключей.
Откат этапа: удалить `docs/development/` и `prompts/`; zip, код и Git не затронуты.

## Завершение

Фактически созданные файлы: `prompts/Customer_Dossier_Prompts/**` (распаковка), `docs/development/{STATE.md, HANDOFF.md, PATCH_COVERAGE.md, BACKLOG.md}`, `docs/development/stages/00_REPORT.md`, `docs/development/evidence/00/COMMANDS.md`.
Независимое review: не выполнялось (можно по `service/REVIEW_STAGE.md`).
Следующий разрешаемый промт: **`prompts/Customer_Dossier_Prompts/stages/STAGE_01_LOCAL_SAFETY.md`** — сам не запускался.
Обновлены: `docs/development/STATE.md`, `docs/development/HANDOFF.md`.
