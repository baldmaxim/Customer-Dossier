# Этап 01 — фактически выполненные команды

Дата: 2026-09-14, 12:45–13:40 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Тестовая цель: Docker-контейнер `tg-info-test-db` (postgres:17-alpine), `127.0.0.1:55433/tg_info_test`,
маркер `COMMENT ON DATABASE ... IS 'tg_info:test-target'`. Учётные данные контейнера — тестовые, не секрет.
Рабочая БД не подключалась. `.env` не открывался и не менялся.

| ID | Команда | Цель | Exit | Статус | Лог |
|---|---|---|---|---|---|
| E01-01 | `sha256sum */package-lock.json` | — | 0 | снимок | lock-before.txt, lock-after.txt |
| E01-02 | `npm ci` (backend), 1-я попытка | — | 1 | FAIL: `Invalid Version` — битая запись lock | npm-ci-backend.log (перезаписан), npm-lock-fix-backend.log |
| E01-03 | правка одной записи lock-файла (см. отчёт), `npm ci` (backend) | — | 0 | PASS: 175 пакетов | npm-ci-backend.log |
| E01-04 | `npm ci` (frontend) | — | 0 | PASS: 360 пакетов, lock не менялся | npm-ci-frontend.log |
| E01-05 | baseline до правок: `vitest run`, `tsc --noEmit` backend, `tsc --noEmit` frontend | unit | 0/0/0 | PASS: 9 файлов / 148 тестов | baseline-*.log |
| E01-06 | `docker run ... tg-info-test-db` + `COMMENT ON DATABASE` | test | 0 | создан | — |
| E01-07 | `npm run typecheck` (backend) | — | 0 | PASS | backend-typecheck.log |
| E01-08 | `npx vitest run --reporter=verbose` | unit | 0 | PASS: 18 файлов / 267 тестов | unit-tests.log |
| E01-09 | `DATABASE_URL=<синтетический удалённый> npx vitest run` | unit | 0 | PASS 267/267: внешний URL не использован (TC-002) | unit-tests-with-external-database-url.log |
| E01-10 | `TEST_DATABASE_URL=<test> vitest -c vitest.integration.config.ts` | test | 0 | PASS: 4 файла / 34 теста | integration-tests.log |
| E01-11 | интеграционный профиль без TEST_DATABASE_URL | — | 1 | PASS (отказ guard) | guard-no-target.log |
| E01-12 | TEST_DATABASE_URL = DATABASE_URL | — | 1 | PASS (отказ) | guard-same-as-working.log |
| E01-13 | TEST_DATABASE_URL на удалённый хост | — | 1 | PASS (отказ) | guard-remote.log |
| E01-14 | база `tg_info_test_nomarker` без маркера (создана и удалена в тестовом контейнере) | test | 1 | PASS (отказ) | guard-no-marker.log |
| E01-15 | smoke запуска API (`tsx src/index.ts`) с флагами по умолчанию | test | 0 | PASS: 0 запусков/документов/извлечений до и после, loopback, 401/403 | startup-smoke.log |
| E01-16 | то же с активным одобренным источником и документом `queued` | test | 0 | PASS: source_runs 0→0, документ `queued`, attempts 0 | startup-smoke-with-approved-source.log |
| E01-17 | `tsx src/db/migrate.ts --dry` / без флага / `--allow-destructive` / `--dry` на пустой схеме | test | 0/1/0/0 | PASS: dry без объектов, отказ без записи, 10/10, no-op | migrate-cli.log |
| E01-18 | `npm run build` (frontend) + проверка `dist/sw.js` | — | 0 | PASS: нет NetworkFirst/шрифтов, denylist `/api` | frontend-build.log, sw-check.txt |
| E01-19 | Vite dev + API: HTTP-сценарий через прокси | test | 0 | PASS: login, cookie флаги, CSRF 403/200, merge 423, logout → 401 | ui-proxy-smoke.log |
| E01-20 | `tsc --noEmit` (frontend) | — | 0 | PASS | frontend-typecheck.log |
| E01-21 | `npm run build` (backend) | — | 0 | PASS | backend-build.log |
| E01-22 | CLI: `ingest:once --source/--probe/--probe-site`, `pipeline:once --reextract/--loop/--retry/--merge/--renormalize/--recheck`, `--renormalize --dry` | test | 1×9, 0 | PASS: все отказы с причиной, source_runs 0→0; dry разрешён | cli-gates.log |

## Не выполнялось

| Проверка | Статус | Причина |
|---|---|---|
| Визуальная проверка UI в браузере (вход, админка, бейдж legacy, мобильная ширина) | NOT_RUN | браузера/Playwright в среде нет; зависимости ради этого не добавлялись |
| Очистка старых кэшей SW в реальном браузере (TC-009, часть) | NOT_RUN | то же; проверено только содержимое сборки и заголовки `no-store` |
| Реальная LM Studio (TC-007, часть) | NOT_RUN | сервер модели не запущен |
| Живые источники (t.me, сайты, Bot API) | NOT_RUN | допуска нет; этапом не требуется |
| Любые действия с рабочей БД, включая миграцию 010 | NOT_RUN | запрещено без отдельного согласования; рабочая база не идентифицирована |
