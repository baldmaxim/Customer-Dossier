# Приёмка 10–19 — исходная точка

Подготовлено агентом 2026-09-17 по промту `prompts/TG_Info_Acceptance_10-19_2026-09-17/01_CLAUDE_PREPARE_ACCEPTANCE.md`.
Только чтение Git и файлов; сервисы, БД, сеть, модель и браузер не запускались. Код, зависимости, `.env` и статусы не менялись.

## Редакция
| Поле | Значение (прочитано) |
|---|---|
| Ветка | `main` |
| HEAD | код приёмки — `d33521b97ec4f702ffcef9cffb010239e7053d53` (заявленный). Поверх него — один документальный коммит «Приёмка 10–19: документы…» (только `docs/development/**` и `prompts/**`, код не меняется, в отпечаток не входит). Проверка: `git diff --stat d33521b HEAD` показывает только эти пути |
| Изменение кода после `d33521b` | **ACC-04** (2026-09-18): `backend/src/app.ts` и новый `backend/src/api/queryParser.test.ts`; зависимости не менялись. Логи A0/A1 от 2026-09-17 относятся к коду `d33521b` — для нового HEAD повторить A0 и A1 |
| Незакоммиченные изменения кода | нет. Неотслеживаемые: `Customer_Dossier_Claude_Opus5_1M_Prompts_2026-09-11.zip`, `TG_Info_Claude_Next_Stages_10-19_2026-09-16.zip`, `TG_Info_Acceptance_10-19_2026-09-17.zip`, папка `prompts/TG_Info_Acceptance_10-19_2026-09-17/` (распакована по README пакета; в отпечаток не входит) |
| Отпечаток дерева | **не снят** агентом — первый шаг пользователя (`release:fingerprint`, A0 в `USER_RUN_CONSOLIDATED.md`) |
| Node / npm (машина агента) | v24.14.1 / 11.11.0. У пользователя в 09 — Node v24.13.0: версии фиксируются в логах пользователя |
| Клиенты | `psql` и `docker` найдены в PATH машины агента (версии не запрашивались); машина пользователя — своя |

### Коммиты этапов (локальная история)
| Этап | Коммит | Миграция |
|---|---|---|
| 10 | `8b1a944` | — |
| 11 | `07f835e` | 021 |
| 12 | `312de2e` | — |
| 13 | `03838eb` | 022 |
| 14A | `ceb57bd` | — |
| 14B | `1b0cf46` | — |
| 15A | `9ad8023` (строка Co-Authored-By; история не переписывается) | 023 |
| 15B | `c356f45` | — |
| 16 | `0f1654f` | — |
| 17 | `12c0fbd` | — |
| 18 | `f355f8d` | — |
| 19 | `d33521b` (включает исправление `resolve/ambiguities.ts` под `sql-sanity`) | — |

Последняя миграция до пакета — `020_dossier_snapshots.sql`; реальная предыдущая редакция для апгрейда — `8b1a944` (этап 10, схема 001–020).

## Зависимости
| Файл | git blob | Изменение с `8b1a944` |
|---|---|---|
| `backend/package-lock.json` | `8b6887394b96711da1872c238faef87cadd4bebc` | не менялся (`backend/package.json` — только новые scripts) |
| `frontend/package-lock.json` | `a3830b9337f7c4789bb329c4163e675a2779f798` | +vitest 4.1.11, jsdom 26, @testing-library/react 16, @testing-library/dom 10, @playwright/test 1.63 (этап 18) |

Lifecycle-скрипты проекта: в `backend/package.json` и `frontend/package.json` **нет** `pre*/post*` хуков. В зависимостях есть install-скрипт
`sharp` (`node install/check.js || npm run build`) — см. `SECURITY_TRIAGE.md`.

## Scripts, относящиеся к приёмке (прочитаны, не запускались)
Backend: `build` = `tsc` (пишет `dist/`, отдельного лога сборки backend нет — выполнялся только `typecheck`), `test` = `vitest run`
(профиль `vitest.config.ts`: `src/**/*.test.ts` без `*.int.test.ts`), `test:integration` = `vitest run -c vitest.integration.config.ts`
(19 файлов `*.int.test.ts`, последовательно, `globalSetup` с guard; **каждый файл делает `DROP SCHEMA public CASCADE` и применяет
миграции** — содержимое тестовой базы уничтожается), `migrate` (`DATABASE_URL`; `--upto` — только через preflight), сиды
`seed:test-*` (preflight), `release:check|manifest` (чтение `DATABASE_URL`), `release:bench` (preflight, пишет снимки),
`release:probe` (GET работающего API), `release:fingerprint`, `pilot:check` (чтение `DATABASE_URL`, без preflight).
Frontend: `test` = `vitest run` (jsdom, `src/**/*.test.{ts,tsx}`), `build` = `tsc -b && vite build`, `check:build`, `e2e` = `playwright test`
(отказ без `E2E_TEST_TARGET_CONFIRMED=tg_info_test`), `icons:generate` (sharp).
Флаги: `--maxWorkers`/`--no-file-parallelism` — опции vitest 4 (оба пакета на 4.1.11); Playwright их не принимает.

## `release:fingerprint` (tree-fingerprint@2)
Хеширует git blob (нормализованные окончания строк) всех отслеживаемых и неигнорируемых неотслеживаемых файлов, кроме: `.env*`
(кроме `.env.example`), `backend/.local`, `*.zip`, `node_modules`, `dist`, **`docs/development/`**, **`prompts/`**, `*.md` в корне.
Покрыты: весь `backend/src` (включая тесты, сиды, helpers), `frontend/src`, `frontend/e2e`, конфиги vitest/playwright, lock-файлы,
`docs/migrations`. Отчёты приёмки отпечаток не меняют.

**Замечание (для промта 04, не исправлялось):** unit-тесты читают входные файлы из исключённой области —
`ingest/sourceContract.test.ts` → `docs/development/sources/*.template.json`, `release/pilotManifest.test.ts` →
`docs/development/pilot/pilot-manifest.template.json`. Правка этих шаблонов не меняет отпечаток, хотя меняет исход тестов.
Обход до решения: в логе A фиксировать также `git hash-object` этих трёх файлов.

## Заявленные и прочитанные доказательства
| Утверждение | Источник | Класс |
|---|---|---|
| backend typecheck PASS; unit 46 файлов / 613 PASS | сообщение агента (этап 19), выполнено на рабочем дереве, равном `d33521b` по коду | **заявлено**, журнал в файл не сохранён, отпечаток не снят → повторить в A |
| frontend `npm test` 14 PASS, `build`, `check:build` PASS | сообщение агента (этапы 17–18) на `f355f8d`; этап 19 frontend не менял | **заявлено**, журнала нет → повторить в A |
| Интеграция, миграции 021–023 в PostgreSQL, restore, браузер, замеры, модель, источники, пилот | `evidence/10…19/USER_RUN.md` — все NOT_RUN | NOT_RUN |
| PASS 09 closure (manifest MATCH, bench, restart, DB down) | `evidence/09/USER_RUN_CLOSURE.md`, код `10d83d9` + `c289cb1` | выполнено пользователем на **старой** редакции; на `d33521b` не переносится |

Все `USER_RUN.md` этапов 10, 11, 12, 13, 14A, 14B, 15A, 15B, 16, 17, 18, 19 — **присутствуют** (MISSING нет).
