# Приёмка 10–19 — единый маршрут пользователя

**Это форма, а не выполненный прогон.** Все результаты — NOT_RUN. Исполнитель — пользователь; агент разбирает присланные логи
(промт 05) и не запускает ни одного шага. Порядок: A → B → C → D1/D2 → E; D1 и D2 не зависят от B/C и могут идти параллельно.
Каждый шаг ссылается на действующие формы (`evidence/09/USER_RUN_CLOSURE.md` — проверенные команды инфраструктуры, `evidence/10…19`) и
перечисляет только отличия. Повторный destructive setup не делается: один полный интеграционный прогон, один набор сидов, один restore.

## Общие условия
- Терминал: Windows PowerShell 5.1 (как в closure 09), корень репозитория `TG_Info`. Проверка exit — `"exit=$LASTEXITCODE"` сразу после команды.
- Журналы: `$L = "$env:USERPROFILE\tg-info-acceptance-1019"; New-Item -ItemType Directory -Force $L | Out-Null` — вне репозитория.
- Тестовый контейнер и цель — как в closure 09: `backend/test-db/docker-compose.yml`, контейнер `tg-info-test-db`, `postgres:17-alpine`,
  роль `tg_test`, база `tg_info_test`, порт 55433, маркер `COMMENT ON DATABASE … IS 'tg_info:test-target'`. Если на вашей машине иначе — остановиться и сообщить, не подбирать.
- **`DATABASE_URL`: окружение и `backend/.env`.** Код грузит `dotenv/config` без override: переменная окна **перекрывает** значение из
  `.env` только в этом процессе, файл не меняется. Guard записи (`db/testTargetBootstrap.ts`) отказывает, если `TEST_DATABASE_URL`
  совпадает с `DATABASE_URL` окна **или** `backend/.env` — поэтому перед сидами/интеграцией/bench `Remove-Item Env:DATABASE_URL`, а
  если `.env` сам указывает на тестовую базу — остановиться (closure 09, строки 48–50): `.env` не редактировать, guard не обходить.
- Команды, читающие `DATABASE_URL` без preflight (`migrate` без `--upto`, `release:check`, `release:manifest`, `pilot:check`, `npm run dev`),
  запускать только с `$env:DATABASE_URL` окна, явно указывающим на **выделенную** цель шага, и снимать переменную после шага.
- Роли целей: `tg_info_test` — интеграция, сиды, браузер, замеры (последовательно); `tg_info_test_upgrade` — апгрейд (B2);
  `tg_info_test_restore_1019` — restore (B3). Имя `tg_info_test_restore` из closure 09 уже занято — не переиспользовать без вашей проверки.
- Фон выключен: `INGEST_ENABLED`, `PIPELINE_ENABLED`, `BOT_ENABLED`, `METRICS_AUTO_REFRESH`, `REPROCESS_AUTO_PUBLISH`, `MERGE_APPLY_ENABLED` = false (так по умолчанию).

## A. Исходная точка и офлайн (не изменяет данные)
**Перед A0 (только если локальная копия отстаёт).** Локальные правки трёх документов 09 сохранены в `%USERPROFILE%\tg-info-09-closure-docs-backup`;
их содержание учтено в `origin/main` (результаты, пояснения, расположение логов `evidence/09/user-closure/`). Затем:
`git restore docs/development/evidence/09/CLOSURE_MATRIX.md docs/development/evidence/09/USER_RUN_CLOSURE.md docs/development/stages/09_REPORT.md; git pull --ff-only origin main`.
Папку `evidence/09/user-closure/` не трогать и в Git не добавлять. Отказ `--ff-only` — стоп, прислать вывод.

| Шаг | Цель | Команда (cwd) | Меняет | Журнал | Ожидается | Стоп |
|---|---|---|---|---|---|---|
| A0 | редакция и отпечаток (AC-01) | `git rev-parse HEAD; git diff --stat d33521b HEAD; git status --short; node -v; npm -v; git hash-object backend/package-lock.json frontend/package-lock.json docs/development/sources/site-profile.template.json docs/development/sources/telegram-profile.template.json docs/development/pilot/pilot-manifest.template.json` (корень), затем `cd backend; npm run release:fingerprint -- --out "$L\A0-tree.json"` | файл отпечатка | `$L\A0-*.txt/json` | HEAD = `origin/main`; `git diff --stat d33521b HEAD` — только `docs/development/**` и `prompts/**`; в отпечатке изменённых путей 0 (zip, `prompts/`, `docs/development/` вне отпечатка); lock blobs как в `BASELINE.md` | в diff от `d33521b` есть пути кода или изменённые отслеживаемые файлы кода — сообщить, не продолжать |
| A1 | backend офлайн (AC-03, unit-часть многих AC) | `cd backend; npm run typecheck 2>&1 \| Out-File -Encoding utf8 "$L\A1-typecheck.log"; "exit=$LASTEXITCODE" \| Add-Content "$L\A1-typecheck.log"`; то же для `npm run build` (пишет `backend/dist`) и `npx vitest run --maxWorkers=2 --reporter=verbose` → `$L\A1-unit.log` | `dist/` | `$L\A1-*.log` | exit 0; unit — число файлов/тестов, **0 skipped** (ориентир 46/613; важен полный состав) | любой FAIL — промт 04 |
| A2 | frontend офлайн (AC-03/35) | `cd frontend; npm test` → `$L\A2-test.log`; `$env:TG_INFO_SECRET_MARKERS='canary-acc-1019'; npm run build; npm run check:build` → `$L\A2-build.log` | `dist/` | `$L\A2-*.log` | 3 файла / 14 passed; `check:build ok` | FAIL — промт 04 |
| A3 | зависимости (AC-43) | `SECURITY_TRIAGE.md`, раздел «Команды» (передаёт перечень зависимостей в registry) | файлы JSON | `$L\A3-*` | цепочка sharp, advisory | — (результат для решения владельца) |
Если `node_modules` отсутствуют: `npm ci` в пакете — отдельное решение (сеть, install-скрипт sharp во frontend, см. SECURITY_TRIAGE).

## B. Данные на синтетике
### B0. Цель и guard (AC-04)
closure 09 **B1** (отрицательные контроли без соединения) и первые три команды **B2** (compose up, проверка роли/маркера, список баз).
Отличие: в списке баз допускаются `tg_info_test_restore` (из closure) и базы этого маршрута; незнакомую базу — остановиться.
Журнал `$L\B0-*.log`.

### B1. Свежая установка и полный интеграционный набор (AC-05, 08, 11–19, 24–28, 30, 44)
closure 09 **B2**, команда `npm run test:integration` → `$L\B1-integration.log`. Меняет: **каждый файл пересоздаёт схему `tg_info_test`**
(все прежние данные этой базы теряются). Ожидается: `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, 19 файлов passed,
0 skipped, exit 0; миграции до `023_ambiguity_decisions.sql`; в логе describe «этап 11», «этап 13», «этап 15A», «этап 15B», «этап 16».
Стоп: отказ guard (не обходить) или любой FAIL.

### B2. Апгрейд 020 → 023 с данными (AC-06, AC-07, AC-19)
Автотеста нет (`release.int` апгрейдит с 009). Предыдущая реальная редакция — `8b1a944` (схема 001–020, lock backend тот же).
1. **Цель** (меняет контейнер: новая база). `docker exec tg-info-test-db psql -U tg_test -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE tg_info_test_upgrade;"`
   и `… -c "COMMENT ON DATABASE tg_info_test_upgrade IS 'tg_info:test-target';"`; `"exit=$LASTEXITCODE"` после каждой. «already exists» — стоп, решение ваше.
2. **Старая редакция рядом** (меняет только `.git/worktrees` и новую папку вне репозитория): `git worktree add ..\tg-info-020 8b1a944`;
   `New-Item -ItemType Junction -Path ..\tg-info-020\backend\node_modules -Target (Resolve-Path backend\node_modules)` (lock backend не менялся;
   иначе `npm ci` в `..\tg-info-020\backend` — сеть).
3. **Схема 020 и данные** (cwd `..\tg-info-020\backend`): `$env:DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test_upgrade'; npx tsx src/db/migrate.ts --allow-destructive; "exit=$LASTEXITCODE"; Remove-Item Env:DATABASE_URL`
   → `$L\B2-migrate-020.log` (ожидается последняя `020_dossier_snapshots.sql`). Затем `$env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test_upgrade'; npm run seed:test-release`
   → `$L\B2-seed-020.log`; `Remove-Item Env:TEST_DATABASE_URL`.
4. **Обращение и снимок старой версии** (по желанию, для AC-19; меняет upgrade-цель). Окно 1, cwd `..\tg-info-020\backend`:
   `$env:DATABASE_URL=<upgrade-адрес>; $env:OPERATOR_TOKEN=<токен тестового стенда из вашего хранилища, не печатать>; npm run dev`.
   Окно 2 (та же `$env:OPERATOR_TOKEN`; запросы с разрешённым Origin dev-фронтенда; токен и CSRF не выводятся; ответ создания обращения у этой версии — `{ case, replayed }`):
   ```powershell
   $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession; $o = @{ Origin = 'http://127.0.0.1:5173' }
   $login = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4100/api/auth/login -WebSession $s -Headers $o -ContentType 'application/json' -Body (@{ token = $env:OPERATOR_TOKEN } | ConvertTo-Json)
   $h = @{ Origin = 'http://127.0.0.1:5173'; 'X-CSRF-Token' = $login.csrfToken }
   $case = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4100/api/cases -WebSession $s -Headers $h -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ title = 'Апгрейд 020'; companyId = <id «Альфа-Релиз» из B2-seed-020.log>; projectId = <id «Причал-Релиз»>; scopeBuilding = 'корпус 2'; claimedRole = 'contractor'; requestDate = '2026-09-17' } | ConvertTo-Json)))
   $snap = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4100/api/cases/$($case.case.id)/snapshots" -WebSession $s -Headers $h -ContentType 'application/json' -Body '{}'
   "case=$($case.case.id) snapshot=$($snap.id)"
   ```
   Если `case` или `snapshot` пустые (иная форма ответа) — остановиться на этом пункте, отметить NOT_RUN и продолжить с п.5.
   Затем (cwd `..\tg-info-020\backend`) `npm run release:probe -- --snapshot <snapshot> --case <case> --out "$L\B2-probe-020.json"`; остановить API (Ctrl+C).
5. **Baseline до апгрейда** (cwd `TG_Info\backend`, main): `$env:DATABASE_URL=<upgrade>; npm run release:check -- --out "$L\B2-check-020.json"; npm run release:manifest -- --out "$L\B2-manifest-020.json"`.
   Ожидается: manifest main на схеме 020 — `INCOMPLETE`/`MISSING_TABLE ambiguity_decisions` и pending 021–023 (это ожидаемо, файл всё равно пишется — если нет, отметить и продолжить без него).
6. **Апгрейд** (main): `npm run migrate -- --dry` → `$L\B2-dry.log` (pending ровно 021, 022, 023, destructive нет) → `npm run migrate` → `$L\B2-migrate-023.log`.
7. **Проверка**: `npm run release:check -- --compare "$L\B2-check-020.json"` (количества равны; новая таблица 0 строк), `npm run release:manifest -- --compare "$L\B2-manifest-020.json"` →
   ожидаемые расхождения **только** схема/миграции и таблицы с новыми колонками `extraction_runs` (021), `dossier_snapshots` (022),
   `resolution_ambiguities` (023) и новая `ambiguity_decisions`; нет `SNAPSHOT_HASH_MISMATCH`, нет нарушений связности. Любое другое расхождение — стоп.
   `npm run release:manifest -- --out "$L\B2-manifest-023.json"` → MATCH на повторном compare с самим собой. `Remove-Item Env:DATABASE_URL`.
8. С п.4: API main на upgrade-цели, `npm run release:probe -- --snapshot <id> --compare "$L\B2-probe-020.json"`. Ожидается: ключ снимка
   (payload hash, `integrity.verified=true`) **совпадает**; выгрузки и досье обращения **отличаются** — рендер и шаблон досье изменились (@1 → @3), это не порча снимка.
9. Уборка — ваше решение: `git worktree remove ..\tg-info-020`; база `tg_info_test_upgrade` — оставить или удалить после проверки имени.

### B3. Сиды, копия и восстановление (AC-07, AC-09)
Данные: closure 09 **C1** (DROP SCHEMA + migrate + `seed:test-release`) на `tg_info_test`, затем `npm run seed:test-brief` (этап 17; ожидается три строки
`[seed] обращение #…`). Ожидаемых миграций — **23** (в closure было 20). Журналы `$L\B3-seed-*.log`.
Копия и восстановление: closure 09 **E1–E5, E7** без изменений порядка, с отличиями: имя restore-цели **`tg_info_test_restore_1019`**, имя дампа
`/tmp/tg-info-acceptance-1019.dump`, журналы `$L\B3-*`. Ожидается `release:manifest --compare` MATCH (включая `ambiguity_decisions`), негативный контроль — MISMATCH.
Замер (C2) и E2E (C1) пишут снимки: **не выполнять между baseline E2 и дампом E3**.

### B4. Приложение на копии (AC-10)
closure 09 **E6** на `tg_info_test_restore_1019` + D1-проба (`release:probe --out`/`--compare`) по снимку из сида/E2E; затем одна
контролируемая запись (создать обращение в UI) — проверяет последовательности; после неё compare больше не делать.

## C. Работа оператора и замеры
| Шаг | Основа | Отличия / задачи | Меняет | Ожидается |
|---|---|---|---|---|
| C1 | `evidence/18/USER_RUN.md` B1–B4; сценарии `evidence/12` (T12-12), `15A` шаг 4, `15B` шаг 4, `17` шаг 4 | на `tg_info_test` после B3; E2E создаёт снимки | снимки, решения | 6 тестов × 2 размера passed; ручные задачи — PASS/FAIL с затруднениями; PDF и 390 px — решение человека |
| C2 | `evidence/18/USER_RUN.md` C1–C4 | после B3; C1 (`bench-before`) и C3 (`bench-large`) не сравнивать между собой | снимки, ~3300 утверждений | отчёты действительны; топ SQL; планы EXPLAIN |
| C3 | closure 09 **D1–D2** (перезапуск процесса, остановка БД) | на `tg_info_test` | нет | досье/снимок прежние; отказ БД — контролируемая ошибка (AC-39) |

## D. Модель и источники (независимые наборы)
- **D1** — `evidence/14A/USER_RUN.md` 1–7, затем `evidence/14B/USER_RUN.md` (критерии в `quality/QUALITY_DECISION.md` заполнить **до** варианта). БД не нужна.
- **D2** — `evidence/16/USER_RUN.md`: шаги 1–3 без сети; 4–7 **только** с вашим перечнем источников и оснований. Сбор не разрешает ИИ-обработку.

## E. Пилот
- **E1** (после B и C): проверка `pilot:check` на тестовой цели как отрицательный контроль AC-40 — `cd backend; $env:DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npm run pilot:check -- --manifest ..\docs\development\pilot\pilot-manifest.template.json; "exit=$LASTEXITCODE"; Remove-Item Env:DATABASE_URL`
  → ожидается `BLOCKED` (не утверждён, источники не названы), exit 1, **никаких** запросов к источникам и записей.
- **E2** — решение владельца и манифест (`pilot/PILOT_DECISION.md`, `evidence/19/USER_RUN.md` A2–B3). Агент источники, лимиты и согласия не подставляет.
- **E3** — пилот `evidence/19/USER_RUN.md` C–E только после E2.

## Что прислать агенту
Папку `$L` без дампов, `.env`, токенов и cookies; для C1 — отчёт Playwright и ваши PASS/FAIL; для D1 — JSON отчётов на синтетике; фактические числа
только из логов. Форма итога — `prompts/TG_Info_Acceptance_10-19_2026-09-17/templates/RESULTS_TEMPLATE.md`.
