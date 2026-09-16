# Закрытие приёмки этапа 09 — пользовательский прогон

**Это форма и команды, а не выполненный прогон.** Все шаги ниже — NOT_RUN, пока вы не пришлёте логи.
Исторический прогон 09 (`USER_RUN.md`, старый `local-inventory@1`) остаётся результатом своего кода; этот прогон
проверяет более сильные условия на текущем коде. Критерии — `09_USER_ACCEPTANCE.md` (корень репозитория),
матрица — [CLOSURE_MATRIX.md](CLOSURE_MATRIX.md), контракт manifest — [../../CONTENT_MANIFEST.md](../../CONTENT_MANIFEST.md).

Команды — PowerShell 5.1 из корня `TG_Info` (у вас Windows). Рабочая база, живые источники, реальная модель и
`.env` не участвуют. Docker, PostgreSQL, браузер, дамп и замеры запускаете только вы.

Общие правила прогона:

- Один код на весь прогон: снимите отпечаток в начале и в конце — они должны совпасть. Правка кода → повтор затронутых шагов.
- Логи — в отдельную папку вне репозитория, без паролей, cookies, токенов и содержимого дампа. Лог без строки
  `exit=…` не считается успешным.
- Перед каждой изменяющей командой ниже указаны: цель, побочный эффект, чем проверена цель, что ожидается.
- Контейнер `tg-info-test-db` — только тестовый (`backend/test-db/docker-compose.yml`, метки `project=tg-info`,
  `purpose=test-only`, без томов). Не останавливайте и не чистите контейнеры, где есть другие ваши базы.

```powershell
$L = "$env:USERPROFILE\tg-info-09-closure"; New-Item -ItemType Directory -Force $L | Out-Null
# Фоновые задания в этом окне явно выключены (dotenv не перекрывает переменные окружения процесса)
$env:INGEST_ENABLED='false'; $env:PIPELINE_ENABLED='false'; $env:METRICS_AUTO_REFRESH='false'; $env:BOT_ENABLED='false'
$env:REPROCESS_AUTO_PUBLISH='false'; $env:MERGE_APPLY_ENABLED='false'
```

---

## G01. Состояние кода и среда (не изменяет данные)

```powershell
git rev-parse HEAD; git status --short
cd backend
npm run release:fingerprint -- --out "$L\tree-start.json"
node -v; npm -v
docker inspect -f '{{.Config.Image}} {{index .Config.Labels "purpose"}}' tg-info-test-db
cd ..
```

Ожидается: HEAD `7c76c35` + незакоммиченные правки закрытия (или коммит, если вы их зафиксируете), `postgres:17-alpine test-only`.
Отпечаток итогового кода агента — `closure/tree-final.json`: `treeSha256 = 22dbe00f4c0e231e2536c45120affe26a11233ef4e5aad3d4ffb91bb164fda0a`. Если ваш другой (без
коммита, с теми же файлами он должен совпасть; после `git commit` — тоже, отпечаток не зависит от HEAD-сообщения, но HEAD
будет другим) — код отличается, сообщите.

С 2026-09-16 (после прогона) отпечаток — `tree-fingerprint@2`: хешируются git blob с нормализацией окончаний строк,
поэтому CRLF в рабочем дереве больше не меняет `treeSha256`; значения `@1` выше с ним не сравниваются.

Если `backend/.env` содержит `DATABASE_URL`, указывающий на `127.0.0.1:55433/tg_info_test`, guard записи **откажет**
(«совпадает с DATABASE_URL»): рабочий адрес и тестовая цель не должны совпадать. Для работы API на тестовой базе
задавайте `$env:DATABASE_URL` в окне, а не в `.env`.

## A. Статические проверки и unit (не изменяет данные)

```powershell
cd backend
npm ci
npm run typecheck 2>&1 | Out-File -Encoding utf8 "$L\typecheck.log"; "exit=$LASTEXITCODE" | Add-Content "$L\typecheck.log"
npx vitest run --maxWorkers=2 --reporter=verbose 2>&1 | Out-File -Encoding utf8 "$L\unit.log"; "exit=$LASTEXITCODE" | Add-Content "$L\unit.log"
cd ..\frontend
npm ci
npm run build 2>&1 | Out-File -Encoding utf8 "$L\frontend-build.log"; "exit=$LASTEXITCODE" | Add-Content "$L\frontend-build.log"
npm run check:build 2>&1 | Out-File -Encoding utf8 "$L\check-build.log"; "exit=$LASTEXITCODE" | Add-Content "$L\check-build.log"
cd ..
```

Ожидается: typecheck exit 0; unit — все файлы passed, 0 skipped, exit 0 (у агента: **35 файлов / 497 тестов**; число
может отличаться только из-за правок после этого документа); сборка exit 0; `check:build` — «ok: /api не кэшируется
service worker, секретов в бандле не найдено».

Если unit падает по памяти (OOM): повторите `npx vitest run --maxWorkers=1 --no-file-parallelism --reporter=verbose`.
Не отключайте изоляцию и не завершайте все процессы Node. OOM — это BLOCKED_ENV конкретного прогона, не PASS.

## B. Тестовая цель и интеграция (изменяет данные только в `tg_info_test`)

### B1. Guard записи до подключения (не изменяет данные, соединение не открывается)

```powershell
cd backend
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/prod_test'
npm run release:bench; "exit=$LASTEXITCODE"
Remove-Item Env:TEST_DATABASE_URL
npm run release:bench; "exit=$LASTEXITCODE"
```

Ожидается: оба раза `Тестовая цель отклонена` (имя с `test`, но не `tg_info_test[_суффикс]`; затем — «TEST_DATABASE_URL
не задан»), exit 1, без попытки входа и записи.

### B2. База и интеграция

Цель: `127.0.0.1:55433/tg_info_test`. Побочный эффект: профиль пересоздаёт схему `public` этой базы.
Guard: адрес, имя, роль `tg_test`, маркер `tg_info:test-target` проверяются до первого запроса.

```powershell
docker compose -f backend/test-db/docker-compose.yml up -d --wait
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -tAc "SELECT current_user, shobj_description(oid,'pg_database') FROM pg_database WHERE datname='tg_info_test'"
docker exec tg-info-test-db psql -U tg_test -d postgres -tAc "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1"
cd backend
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run test:integration 2>&1 | Out-File -Encoding utf8 "$L\integration.log"; "exit=$LASTEXITCODE" | Add-Content "$L\integration.log"
cd ..
```

Ожидается: `tg_test|tg_info:test-target`; в контейнере только `postgres` и `tg_info_test` (если есть что-то ещё — остановитесь и
сообщите); затем `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, все файлы passed, 0 skipped, exit 0.
Ориентир: **19 файлов / около 210 тестов** (было 18 / 196; добавлены `release/manifest.int.test.ts` и тесты в
`release.int`, `reprocess.int`, `telegram.int`). Число — не цель: важны полный состав и отсутствие пропусков.

Новые интеграционные проверки (подробно — матрица): manifest замечает изменение редакции, цитаты, ИНН, решения,
payload снимка при прежнем hash, допуска и последовательности; слияние сущности с решением аналитика (решение у
исходного утверждения, видно в досье через линию слияния, повтор не удваивает, старый снимок цел); инструкция в тексте
источника на mock-ответе; сбой позднего чанка после релевантного; инъекция ошибки записи курсора Telegram.

## C. Синтетический пользовательский сценарий (изменяет данные только в `tg_info_test`)

### C1. Данные

Цель: `tg_info_test`. Побочный эффект: схема пересоздаётся, загружается синтетический корпус. Guard: имя базы в
команде `docker exec` и общий preflight сида (адрес, роль, маркер).

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
cd backend
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npx tsx src/db/migrate.ts --allow-destructive; "exit=$LASTEXITCODE"
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-release 2>&1 | Out-File -Encoding utf8 "$L\seed.log"; "exit=$LASTEXITCODE" | Add-Content "$L\seed.log"
cd ..
```

Ожидается: 20 миграций; seed — два «Альфа-Релиз» с разными ИНН, `публикаций 13, редакций 14 (правка новости: new_revision)`, `сигналы: succeeded`.

### C2. Приложение и браузер

Окно 1 (API на тестовой базе, фон выключен — переменные из начала документа):

```powershell
cd backend
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run dev
```

Окно 2: `cd frontend; npm run dev`, браузер `http://127.0.0.1:5173`, вход токеном оператора.

1. Поиск «Альфа-Релиз» — две строки с разными ИНН; открыть юрлицо с участием на корпусе 2.
2. Обращение: компания, объект «Причал-Релиз», корпус 2, «монтаж систем ВК», роль «подрядчик». В досье роль корпуса 2,
   переход к цитате; отрицание из другой публикации видно рядом.
3. «Проверка»: решение по участию с причиной. В досье: статус роли — «источники противоречат — противоречие сохраняется
   и после решения аналитика», у утверждения — «проверено аналитиком».
4. Создать снимок, скачать Markdown и JSON, «Версия для печати» → Ctrl+P → PDF.
5. Допуск: в админке снять у `demo_release_channel` сбор или ИИ-обработку, открыть тот же снимок — цитаты этого источника
   скрыты при выдаче, hash снимка прежний. Вернуть допуск (синтетический источник; реальные допуски не трогать).
6. Ширина 390 px (DevTools → iPhone 12): поиск, досье, снимок читаются без горизонтальной прокрутки.

Запишите UI_USER: что проверено, что нет, скриншоты не обязательны. Номер снимка и обращения понадобятся в D.

## D. Перезапуск отдельного процесса и отказы

### D1. Перезапуск (не изменяет данные: вход — сессия в памяти, дальше только GET)

Окно 3, API из C2 запущен:

```powershell
cd backend
npm run release:probe -- --snapshot <id снимка> --case <id обращения> --out "$L\probe-before.json"; "exit=$LASTEXITCODE"
```

В окне 1 `Ctrl+C`, затем снова `npm run dev`. В окне 3:

```powershell
npm run release:probe -- --snapshot <id снимка> --case <id обращения> --compare "$L\probe-before.json"; "exit=$LASTEXITCODE"
```

Ожидается: `snapshot`, `export_html|md|json` — HTTP 200, `integrity.verified=true`, после перезапуска «совпадает», exit 0.
`case_dossier` строится при открытии; если расходится только он — пришлите вывод (это не дефект снимка, но разберём).

### D2. База недоступна и восстановление

Цель: только `tg-info-test-db` (проверено в G01: `purpose=test-only`, в B2: других баз нет).

```powershell
docker stop tg-info-test-db
curl.exe -s -o NUL -w "health HTTP %{http_code}`n" http://127.0.0.1:4100/api/health
```

Ожидается `health HTTP 503`; в браузере досье/карточка — сообщение об ошибке сервиса, а не «сведений нет» или пустой
список; API-процесс не падает. Затем:

```powershell
docker start tg-info-test-db
docker inspect -f '{{.State.Health.Status}}' tg-info-test-db
```

Ожидается `healthy`; досье снова открывается без перезапуска API; `release:probe --compare` из D1 снова совпадает.
Модель, сеть и отзыв допуска на запуске покрыты автоматическими тестами (матрица); реальная модель — NOT_RUN.

## E. Резервная копия и восстановление (одна точка данных)

Порядок нельзя переставлять: остановить писателей → baseline → дамп → проверка, что источник не менялся →
новая restore-цель → restore с остановкой при ошибке → сравнение → приложение на копии → негативный контроль.
**Замеры (F) — только после E**: они создают снимки.

### E1. Остановить писателей (не изменяет данные)

Остановить окна 1 и 2 (`Ctrl+C`), не запускать `release:bench`, сиды, `pipeline:once`, `metrics:refresh`, бота.

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname='tg_info_test' AND pid <> pg_backend_pid()"
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -tAc "SELECT status, count(*) FROM extraction_runs WHERE status IN ('queued','running') GROUP BY status"
```

Ожидается: `0` соединений и ни одного активного запуска. Иначе — не продолжать: сопоставимость не гарантирована.

### E2. Baseline (только чтение)

```powershell
cd backend
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run release:check -- --out "$L\before-inventory.json"; "exit=$LASTEXITCODE"
npm run release:manifest -- --out "$L\before-manifest.json"; "exit=$LASTEXITCODE"
```

Ожидается: `local-inventory@2`, «связность: нарушений нет», exit 0; `content-manifest@1`, «проблем нет», exit 0.

### E3. Дамп (читает базу, пишет файл внутри контейнера)

Файл остаётся в контейнере (`/tmp`), бинарные данные не проходят через конвейер PowerShell (`>`/`<` в PowerShell 5.1 портят дамп).

```powershell
docker exec tg-info-test-db pg_dump -U tg_test -Fc -d tg_info_test -f /tmp/tg-info-09-closure.dump; "exit=$LASTEXITCODE"
docker exec tg-info-test-db sh -c "ls -l /tmp/tg-info-09-closure.dump && sha256sum /tmp/tg-info-09-closure.dump && pg_restore --list /tmp/tg-info-09-closure.dump | wc -l"
docker exec tg-info-test-db pg_dump --version
npm run release:manifest -- --compare "$L\before-manifest.json"; "exit=$LASTEXITCODE"
```

Ожидается: exit 0; размер, sha256 и число элементов оглавления (пришлите эти метаданные, не файл); повторный manifest
источника — `MATCH` (источник не менялся между baseline и дампом).

### E4. Новая restore-цель и восстановление

Цель: новая база `tg_info_test_restore` в том же тестовом контейнере. Побочный эффект: создаётся база и заполняется из дампа.
Существующая база не удаляется: если `CREATE DATABASE` падает «already exists» — остановитесь, решите сами (DROP только
после проверки, что это ваша прошлая restore-цель). `--create` не используется: он восстанавливает в имя из архива, а не
в выбранную цель. `--clean` не нужен: цель новая и пустая.

```powershell
docker exec tg-info-test-db psql -U tg_test -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE tg_info_test_restore;"; "exit=$LASTEXITCODE"
docker exec tg-info-test-db psql -U tg_test -d postgres -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE tg_info_test_restore IS 'tg_info:test-target';"
docker exec tg-info-test-db pg_restore -U tg_test -d tg_info_test_restore --no-owner --exit-on-error --single-transaction /tmp/tg-info-09-closure.dump; "exit=$LASTEXITCODE"
```

Ожидается: все три exit 0. `--single-transaction` + `--exit-on-error`: при любой ошибке restore откатывается целиком,
частично пригодной копии не остаётся. Ненулевой код — FAIL шага, дальше не идти.

### E5. Сравнение (только чтение, до любых действий в приложении)

```powershell
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test_restore'
npm run release:check -- --compare "$L\before-inventory.json" 2>&1 | Out-File -Encoding utf8 "$L\restore-inventory-compare.log"; "exit=$LASTEXITCODE" | Add-Content "$L\restore-inventory-compare.log"
npm run release:manifest -- --out "$L\restore-manifest.json"
npm run release:manifest -- --compare "$L\before-manifest.json" 2>&1 | Out-File -Encoding utf8 "$L\restore-manifest-compare.log"; "exit=$LASTEXITCODE" | Add-Content "$L\restore-manifest-compare.log"
```

Ожидается: inventory — «совпадает», exit 0; manifest — `MATCH`, exit 0 (таблицы, схема, миграции, последовательности,
пересчитанные hash снимков, цепочки вымарываний, связность, параметры окна). Имя базы и время — не расхождение.

### E6. Приложение на копии (фон выключен)

Окно 1: `$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test_restore'`, `npm run dev`
(переменные фона из начала документа заданы в этом окне). Окно 3:

```powershell
npm run release:probe -- --snapshot <id снимка> --case <id обращения> --compare "$L\probe-before.json"; "exit=$LASTEXITCODE"
```

Ожидается: совпадает. В браузере: обращение из C2, решение аналитика, история редакций правленной новости, старый снимок,
выгрузки. В консоли API — фоновые задания выключены. Результат записать отдельно от E5 («функциональное чтение копии»).
Остановить API (`Ctrl+C`).

### E7. Негативный контроль (изменяет только `tg_info_test_restore`)

Цель: restore-копия. Побочный эффект: одна цитата меняется в обход триггера неизменяемости (только для проверки).

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test_restore -v ON_ERROR_STOP=1 -c "BEGIN; SET LOCAL session_replication_role = replica; UPDATE evidence SET quote = quote || ' ' WHERE id = (SELECT min(id) FROM evidence); COMMIT;"
npm run release:check -- --compare "$L\before-inventory.json"; "exit=$LASTEXITCODE"
npm run release:manifest -- --compare "$L\before-manifest.json"; "exit=$LASTEXITCODE"
Remove-Item Env:DATABASE_URL
```

Ожидается: inventory по-прежнему «совпадает» (количества те же — именно поэтому его недостаточно); manifest — `MISMATCH`,
`TABLE_CONTENT: evidence`, exit 1. Пришлите оба вывода.

## F. Замеры (только после E; изменяют `tg_info_test`: создают снимки и синтетические публикации)

### F0. Маркер обязателен (только чтение до отказа)

```powershell
docker exec tg-info-test-db psql -U tg_test -d postgres -v ON_ERROR_STOP=1 -c "COMMENT ON DATABASE tg_info_test_restore IS NULL;"
cd backend
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test_restore'
npm run release:bench; "exit=$LASTEXITCODE"
```

Ожидается: «в базе нет маркера», exit 1, без входа в приложение и без записи.

### F1. Замер

Цель: `tg_info_test` (данные C1 + прогонов). Guard: общий preflight (адрес, имя, роль, маркер) до входа и записи.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run release:bench -- --runs 5 --pipeline-synthetic --out "$L\bench.json" 2>&1 | Out-File -Encoding utf8 "$L\bench.log"; "exit=$LASTEXITCODE" | Add-Content "$L\bench.log"
```

Ожидается: `local-bench@2`, строка харнесса (in-process HTTP), объём до и после (снимков больше), по шагам `OK` с
«успешно 5/5» и прогревом ok — **поиск должен быть 200 с найденной компанией**; `pipeline_synthetic` помечен
`synthetic/mocked model`; «отчёт действителен», exit 0. Любой `FAILED`/`PARTIAL` — пришлите, ошибки не отбрасываются.
Это не SLA и не скорость реальной модели.

## G. Уборка (изменяет данные; решение за вами)

```powershell
docker exec tg-info-test-db psql -U tg_test -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE tg_info_test_restore;"
docker exec tg-info-test-db rm /tmp/tg-info-09-closure.dump
cd backend; npm run release:fingerprint -- --out "$L\tree-end.json"; cd ..
```

`tree-end.json` → `treeSha256` должен совпасть с `tree-start.json`.

## Что прислать

Папку `$L` без дампа: `tree-start/end.json`, логи A, B, C1, D1–D2 (вывод probe), E1–E7 (выводы и оба compare-лога,
метаданные дампа), `bench.json` и `bench.log`, протокол UI_USER (C2, D2: что проверено). `.env`, токен и cookies не
присылать. Незапущенный шаг — NOT_RUN с причиной.

## Результаты (заполняется по логам)

| Шаг | Статус | Лог |
|---|---|---|
| G01 | NOT_RUN | — |
| A | NOT_RUN | — |
| B1–B2 | NOT_RUN | — |
| C1–C2 | NOT_RUN | — |
| D1–D2 | NOT_RUN | — |
| E1–E7 | NOT_RUN | — |
| F0–F1 | NOT_RUN | — |
