# Проверка этапа 01 у себя — пошагово

Все команды — из корня `TG_Info`. Для PowerShell и bash даны оба варианта там, где они различаются.
Рабочая база, `.env` и живые источники в этих шагах не используются.

## 0. Что нужно

- Node.js 20+ и npm, Docker Desktop.
- Свободный порт `127.0.0.1:55433`.
- Если контейнер `tg-info-test-db` остался от прошлого прогона — удалить: `docker rm -f tg-info-test-db`.

## 1. Зависимости

```bash
cd backend && npm ci && cd ..
cd frontend && npm ci && cd ..
```

Ожидается: оба `npm ci` без ошибок. (В `backend/package-lock.json` на этапе 01 исправлена одна
битая запись `@rolldown/binding-openharmony-arm64` — без этого `npm ci` падал `Invalid Version`.)

## 2. Проверки без базы

```bash
cd backend
npm run typecheck
npm test
cd ../frontend
npx tsc -p tsconfig.json --noEmit
npm run build
cd ..
```

Ожидается: typecheck без ошибок; unit — **18 файлов / 267 тестов passed**; сборка frontend успешна.

Проверка, что unit-тесты не берут рабочий `DATABASE_URL` (TC-002):

```powershell
# PowerShell
cd backend
$env:DATABASE_URL = 'postgresql://prod:pw@203.0.113.5:5432/tg_info'; npm test; Remove-Item Env:DATABASE_URL
cd ..
```
```bash
# bash
cd backend && DATABASE_URL='postgresql://prod:pw@203.0.113.5:5432/tg_info' npm test && cd ..
```

Ожидается: те же 267 passed (адрес нерабочий и в тестах не используется).

Service worker без кэша API (TC-009):

```powershell
Select-String -Path frontend/dist/sw.js -Pattern 'NetworkFirst','googleapis','gstatic'   # пусто
Select-String -Path frontend/dist/sw.js -Pattern 'denylist'                              # есть /api
```

## 3. Тестовая база

```bash
docker compose -f backend/test-db/docker-compose.yml up -d --wait
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='tg_info_test'"
```

Ожидается: контейнер `healthy`, запрос возвращает `tg_info:test-target`.

## 4. Интеграционные тесты

```powershell
# PowerShell
cd backend
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run test:integration
```
```bash
# bash
cd backend
export TEST_DATABASE_URL=postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test
npm run test:integration
```

Ожидается: строка `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, затем **4 файла / 34 теста passed**
(миграции и dry-run, допуск источников на всех входах, резолверы R01/R02, API).

Профиль пересоздаёт схему `public` тестовой базы — направлять его можно только на неё.

## 5. Guard тестовой цели отказывает (должен падать)

В той же сессии, где задан `TEST_DATABASE_URL`:

| Действие | Ожидаемая ошибка |
|---|---|
| убрать переменную (`Remove-Item Env:TEST_DATABASE_URL` / `unset TEST_DATABASE_URL`) и `npm run test:integration` | `TEST_DATABASE_URL не задан` |
| `TEST_DATABASE_URL=postgresql://u:p@db.example.com:5432/tg_info_test` | `хост не loopback` |
| `DATABASE_URL` равен `TEST_DATABASE_URL` (например, `localhost` вместо `127.0.0.1`) | `совпадает с DATABASE_URL` |

Каждый запуск завершается ошибкой `Тестовая цель отклонена`, тесты не выполняются.

## 6. CLI против тестовой базы

Переменные (PowerShell; для bash — `export` тех же значений):

```powershell
cd backend
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
$env:DATABASE_SSL = 'false'
$env:DOTENV_CONFIG_PATH = 'none.env'   # не подмешивать backend/.env
```

**Миграции (TC-003).** Сначала пустая схема:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --dry                 # список 001–010, у 009 пометка ВНИМАНИЕ; exit 0
npx tsx src/db/migrate.ts                       # отказ: «…--allow-destructive»; exit 1
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'"   # 0
npx tsx src/db/migrate.ts --allow-destructive   # применено 10 миграций
npx tsx src/db/migrate.ts --dry                 # «нечего применять»
```

**Gate сбора и блокировки канона (TC-008).**

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "INSERT INTO sources (kind,key,title,base_url,status) VALUES ('telegram','cli_unknown_synthetic','cli','https://t.me/s/cli_unknown_synthetic','active') ON CONFLICT DO NOTHING"
npx tsx src/ingest/cli.ts --source cli_unknown_synthetic   # «нет разрешения на сбор — основание не подтверждено», exit 1
npx tsx src/ingest/cli.ts --probe cli_unknown_synthetic    # то же, без запроса к t.me
npx tsx src/pipeline/cli.ts --reextract                     # «команда заблокирована … этап 03B», exit 1
npx tsx src/pipeline/cli.ts --merge 1                       # «слияние заблокировано до этапа 04», exit 1
npx tsx src/pipeline/cli.ts --renormalize --dry             # работает, exit 0
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM source_runs"   # 0
```

## 7. Запуск портала без фоновых заданий (TC-001)

В той же сессии PowerShell (переменные из шага 6):

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE sources SET access_status='approved', ai_processing_status='approved', policy_basis='проверка', policy_owner='я', policy_decided_at=now(), next_run_at=now()-interval '1 hour' WHERE key='cli_unknown_synthetic'"
npm run dev
```

Ожидается в логе:

```
[jobs] сбор источников выключен (INGEST_ENABLED=false)
[jobs] разбор моделью выключен (PIPELINE_ENABLED=false)
[jobs] автопересчёт метрик выключен (METRICS_AUTO_REFRESH=false)
[jobs] приём форвардов выключен (BOT_ENABLED=false)
[api] слушает http://127.0.0.1:4100
[auth] токен оператора: … backend\.local\operator-token
```

Через минуту в другом окне: `SELECT count(*) FROM source_runs` — по-прежнему **0**, хотя источник активен и одобрен.

Защита API (другое окно PowerShell):

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:4100/api/companies?q=ab                          # 401
curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Origin: http://127.0.0.1:5173" http://127.0.0.1:4100/api/admin/merges/1/merge   # 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example" http://127.0.0.1:4100/api/health           # 403
```

## 8. Интерфейс в браузере (не проверялось на стороне агента)

API из шага 7 оставить запущенным. Второе окно:

```bash
cd frontend && npm run dev     # http://127.0.0.1:5173
```

1. Открывается экран входа. Неверный токен — «Неверный токен оператора».
2. Токен — содержимое `backend/.local/operator-token`. После входа — поиск.
3. «Админка» → «Источники»: у каждого источника «сбор: …, ИИ: …» и причина блокировки.
4. «Допуск» у «Ручная вставка текста»: выбрать «разрешён» без основания — кнопка неактивна, подсказка;
   заполнить основание и ответственного — «Решение … сохранено».
5. «Вставить текст вручную» — текст принимается; отозвать допуск («отозван») — вставка отклоняется с причиной.
6. «Очередь слияний»: кнопка «Слить (выключено)».
7. Карточка любой компании (если есть данные): бейдж с меткой `LEGACY`, пояснение «не оценка надёжности».
8. Кнопка выхода в шапке → снова экран входа. DevTools → Application → Cache Storage: кэшей `api`,
   `google-fonts-*` нет. Network: запросов к `fonts.googleapis.com` нет.
9. Ширина 390 px (DevTools, iPhone 12): экран входа и таблица источников без горизонтального скролла страницы.

## 9. Уборка

```bash
# Ctrl+C в окнах npm run dev
docker compose -f backend/test-db/docker-compose.yml down      # контейнер и данные тестовой базы удаляются
```

`backend/.local/operator-token` — ваш токен оператора, удалять не нужно (при удалении создастся новый).

## Что прислать, если что-то не так

Номер шага, команду и вывод (без содержимого `.env` и токена). Для тестов — хвост вывода с именами упавших тестов.
