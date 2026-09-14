# Проверка у себя — пошагово

Все команды — из корня `TG_Info`, ветка `dossier-stages`. Для PowerShell и bash даны оба варианта там,
где они различаются. Рабочая база, `.env` и живые источники не используются.

**Сейчас проверяется этап 02** (публикации и версии): шаги A1–A5, затем B, затем C. Раздел D — проверки
этапа 01, если вы их ещё не прогоняли.

---

## A. Общая подготовка

### A1. Что нужно

- Node.js 20+ и npm, Docker Desktop, свободный порт `127.0.0.1:55433`.
- Если остался контейнер от прошлого прогона: `docker rm -f tg-info-test-db`.

### A2. Код и зависимости

```bash
git fetch origin && git switch dossier-stages && git pull
cd backend && npm ci && cd ..
cd frontend && npm ci && cd ..
```

### A3. Проверки без базы

```bash
cd backend
npm run typecheck
npm test
cd ../frontend
npx tsc -p tsconfig.json --noEmit
npm run build
cd ..
```

Ожидается: typecheck без ошибок; unit — **20 файлов / 297 тестов passed**; сборка frontend успешна.

### A4. Тестовая база

```bash
docker compose -f backend/test-db/docker-compose.yml up -d --wait
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='tg_info_test'"
```

Ожидается: контейнер `healthy`, запрос возвращает `tg_info:test-target`.

### A5. Интеграционные тесты

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

Ожидается: `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, затем **7 файлов / 61 тест passed**:

| Файл | Что проверяет |
|---|---|
| `db/migrate.int.test.ts` | dry-run без DDL, отказ destructive без флага, миграции 001–011 |
| `ingest/policy.int.test.ts` | допуск источников на всех входах |
| `resolve/resolve.int.test.ts` | R01/R02 |
| `api/api.int.test.ts` | поиск, заблокированные операции, R06 |
| `revisions/revisions.int.test.ts` | **этап 02**: TC-011…TC-017, гонка, stale, удаление, неизменяемость, FK |
| `revisions/revisions.api.int.test.ts` | **этап 02**: API публикаций, редакций, diff, здоровье источника |
| `revisions/backfill.int.test.ts` | **этап 02**: TC-018 — dry-run, повторы, неоднозначности |

Профиль пересоздаёт схему `public` тестовой базы — направлять его можно только на неё.

---

## B. Этап 02 — backfill из командной строки

В той же сессии (переменные PowerShell; для bash — `export` тех же значений):

```powershell
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
$env:DATABASE_SSL = 'false'
$env:DOTENV_CONFIG_PATH = 'none.env'
```

Пустая схема, миграции и три «старых» документа (как до этапа 02):

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "INSERT INTO sources (kind,key,title,status) VALUES ('telegram','legacy_demo','legacy','paused'); INSERT INTO raw_documents (source_id, external_id, body, content_hash, lead_hash, body_len, status) SELECT id, 'legacy_demo/' || g, 'Старый синтетический документ номер ' || g, decode(md5('legacy' || g), 'hex'), decode(md5('lead' || g), 'hex'), 40, 'extracted' FROM sources, generate_series(1,3) g WHERE key='legacy_demo'; INSERT INTO document_sightings (document_id, source_id, external_id) SELECT d.id, d.source_id, d.external_id FROM raw_documents d;"
```

| Команда | Ожидается |
|---|---|
| `npm run backfill:revisions` | `dry-run (ничего не записано)`, `rowsScanned: 3`, `revisionsCreated: 3` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM document_revisions"` | `0` |
| `npm run backfill:revisions -- --apply --batch 2` | `ЗАПИСЬ`, `itemsCreated: 3`, `revisionsCreated: 3`, `observationsCreated: 3`, `ambiguousCount: 0` |
| `npm run backfill:revisions -- --apply` | `rowsScanned: 0` |
| `npm run backfill:revisions -- --apply --from-start` | `rowsScanned: 3`, `itemsCreated: 0`, `revisionsCreated: 0`, `observationsExisting: 3` |
| тот же `count(*)` | `3` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE document_revisions SET body='x'"` | ошибка `document_revisions неизменяемы: UPDATE запрещён` |

---

## C. Этап 02 — панель версий в браузере

1. Данные для просмотра. Guard не пускает, если `DATABASE_URL` совпадает с тестовой целью, поэтому
   сначала убрать переменную из раздела B:
   ```powershell
   Remove-Item Env:DATABASE_URL
   $env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
   npm run seed:test-revisions
   ```
   Ожидается: `[seed] откройте http://127.0.0.1:5173/documents/<N>`.
2. Одобрять источники не нужно. Запустить API и UI (два окна; в окне API задать переменные `DATABASE_URL`,
   `DATABASE_SSL`, `DOTENV_CONFIG_PATH` из раздела B):
   ```powershell
   cd backend; npm run dev
   ```
   ```bash
   cd frontend && npm run dev
   ```
3. Войти токеном из `backend/.local/operator-token`, открыть адрес из шага 1.
4. Ожидается:
   - две публикации: `demo_revisions_channel/1` (редакций: 2, полный текст) и `demo_revisions_repost/40`
     (редакций: 1, «подпись к вложению»);
   - у первой в таблице редакции 1 и 2, у второй пометка «текущая», порядок «по порядку наблюдения»;
   - «Текст» у редакции 1 — срок «IV квартал»; «Сравнить с показанной» из редакции 2 — строка с «IV квартал»
     отмечена `−`, строки «перенесён…» и «Причина не указана» — `+`;
   - у перепечатки: «вложения не прочитаны: photo»;
   - ширина 390 px: страница без горизонтального скролла, таблица редакций скроллится внутри.
5. Карточка компании (если в базе есть упоминания): у упоминания ссылка «версии».

---

## D. Этап 01 — если ещё не проверяли

### D1. Unit-тесты не берут рабочий `DATABASE_URL` (TC-002)

```powershell
cd backend
$env:DATABASE_URL = 'postgresql://prod:pw@203.0.113.5:5432/tg_info'; npm test; Remove-Item Env:DATABASE_URL
```

Ожидается: те же 297 passed.

### D2. Guard тестовой цели отказывает

| Действие | Ожидаемая ошибка |
|---|---|
| без `TEST_DATABASE_URL`: `npm run test:integration` | `TEST_DATABASE_URL не задан` |
| `TEST_DATABASE_URL=postgresql://u:p@db.example.com:5432/tg_info_test` | `хост не loopback` |
| `DATABASE_URL` = `TEST_DATABASE_URL` | `совпадает с DATABASE_URL` |

### D3. CLI против тестовой базы (переменные из раздела B)

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --dry                 # 001–011, у 009 «ВНИМАНИЕ»; exit 0
npx tsx src/db/migrate.ts                       # отказ «…--allow-destructive»; exit 1
npx tsx src/db/migrate.ts --allow-destructive   # применено 11 миграций
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "INSERT INTO sources (kind,key,title,base_url,status) VALUES ('telegram','cli_unknown_synthetic','cli','https://t.me/s/cli_unknown_synthetic','active')"
npx tsx src/ingest/cli.ts --source cli_unknown_synthetic   # «нет разрешения на сбор», exit 1
npx tsx src/pipeline/cli.ts --reextract                     # «команда заблокирована … 03B», exit 1
npx tsx src/pipeline/cli.ts --merge 1                       # «слияние заблокировано до этапа 04», exit 1
```

### D4. Запуск без фоновых заданий и защита API

```powershell
npm run dev
```

В логе: четыре строки `[jobs] … выключен`, `[api] слушает http://127.0.0.1:4100`. В другом окне:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:4100/api/companies?q=ab                          # 401
curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: evil.example" http://127.0.0.1:4100/api/health           # 403
```

### D5. UI этапа 01

Экран входа; неверный токен — ошибка; «Админка» → «Источники»: «сбор: …, ИИ: …» и причина; «Допуск»:
разрешение без основания не сохраняется; «Слить (выключено)»; выход → экран входа; DevTools → Application →
Cache Storage без `api` и `google-fonts-*`; Network без `fonts.googleapis.com`.

---

## Уборка

```bash
# Ctrl+C в окнах npm run dev
docker compose -f backend/test-db/docker-compose.yml down
```

## Что прислать

Для каждого шага — «ок» или команду и вывод. Для тестов — хвост вывода с именами упавших тестов.
Содержимое `.env` и токен не присылать.
