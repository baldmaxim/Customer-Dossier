# Проверка у себя — пошагово

Все команды — из корня `TG_Info`, ветка `dossier-stages`. Для PowerShell и bash даны оба варианта там,
где они различаются. Рабочая база, `.env` и живые источники не используются.

**Сейчас проверяется этап 03B** (запуски, чанки, наборы кандидатов, публикация): шаги A1–A5, затем раздел F.
Повторный прогон после исправлений: A2 (`git pull`), A3 и A5; раздел F прошёл, повторять не обязательно
(если повторяете — схема с нуля, миграция 013 изменилась).
Разделы B–E — проверки этапов 02, 01 и 03A (пройдены 2026-09-14), повторять не обязательно.
LM Studio не нужен: модель в тестах и seed подменена детерминированными ответами.

---

## A. Общая подготовка

### A1. Что нужно

- Node.js 20+ и npm, Docker Desktop, свободный порт `127.0.0.1:55433`.
- Если остался контейнер от прошлого прогона: `docker rm -f tg-info-test-db`.

### A2. Код и зависимости

Перед `npm ci` остановите прежние `npm run dev` (иначе `EPERM` на `esbuild.exe`).

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

Ожидается: typecheck без ошибок; unit — **22 файла / 325 тестов passed**; сборка frontend успешна.

### A4. Тестовая база

```bash
docker compose -f backend/test-db/docker-compose.yml up -d --wait
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='tg_info_test'"
```

Ожидается: контейнер `healthy`, запрос возвращает `tg_info:test-target`. Compose не монтирует каталоги
(метку ставит healthcheck), поэтому настройка File Sharing в Docker Desktop не нужна.

Запасной путь без compose:

```bash
docker run -d --name tg-info-test-db -e POSTGRES_USER=tg_test -e POSTGRES_PASSWORD=tg_test -e POSTGRES_DB=tg_info_test -p 127.0.0.1:55433:5432 postgres:17-alpine
# подождать 3–5 секунд, затем:
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "COMMENT ON DATABASE tg_info_test IS 'tg_info:test-target'"
```

### A5. Интеграционные тесты

`DATABASE_URL` в этой сессии должен быть не задан (или указывать не на тестовую базу) — иначе guard откажет
«совпадает с DATABASE_URL». PowerShell: `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue`.

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

Ожидается: `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, затем **10 файлов / 103 теста passed**:

| Файл | Что проверяет |
|---|---|
| `reprocess/reprocess.int.test.ts` | **этап 03B**: полный путь и цепочка evidence → chunk → run → revision, падение последнего чанка, непокрытый хвост, timeout, crash до/после commit, два worker'а и fencing, поздний старый разбор, нерелевантная новая версия при двух источниках и ручном решении, отзыв права ИИ, одинаковые имена с разными ИНН, идемпотентная публикация, 409, проекции карточки, без дублей при переразборе |
| `assertions/assertions.int.test.ts` | **этап 03A**: TC-019…TC-024 — два доказательства и отзыв, опровержение рядом, новый смысл без наследования решения, 409/идемпотентность, FK/CHECK, проверка цитаты базой, эмодзи |
| `assertions/backfill.int.test.ts` | **этап 03A**: TC-025 — перенос legacy-канона, ручные статусы, неоднозначные цитаты, повтор |
| `db/migrate.int.test.ts` | dry-run без DDL, отказ destructive без флага, миграции 001–013 |
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

## E. Этап 03A — утверждения из командной строки и в админке

### E1. Backfill legacy-канона (переменные `DATABASE_URL`, `DATABASE_SSL`, `DOTENV_CONFIG_PATH` — как в разделе B)

Схема с нуля и минимальные legacy-данные: документ, компания, объект, упоминание с ролью, роль на объекте,
событие с ручным статусом `confirmed`:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "INSERT INTO sources (kind,key,title,status) VALUES ('telegram','legacy_canon','legacy','paused'); INSERT INTO raw_documents (source_id, external_id, body, content_hash, lead_hash, body_len, status) SELECT id, 'legacy_canon/1', 'Синтетика: «Демо-Бета» — подрядчик ЖК «Демо-Парк». Срыв срока признан застройщиком.', decode(md5('c1'),'hex'), decode(md5('l1'),'hex'), 80, 'extracted' FROM sources WHERE key='legacy_canon'; INSERT INTO document_sightings (document_id, source_id, external_id) SELECT id, source_id, external_id FROM raw_documents; INSERT INTO companies (name,name_norm,name_latin) VALUES ('Демо-Бета','демо бета','demo beta'); INSERT INTO projects (name,name_norm,name_latin) VALUES ('Демо-Парк','демо парк','demo park'); INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, role, quote, confidence, published_at) SELECT d.id, 'company', c.id, 'Демо-Бета', 'contractor', '«Демо-Бета» — подрядчик ЖК «Демо-Парк»', 0.9, now() FROM raw_documents d, companies c; INSERT INTO project_participants (project_id, company_id, role, confidence, evidence_document_id) SELECT p.id, c.id, 'contractor', 0.9, d.id FROM projects p, companies c, raw_documents d; INSERT INTO events (type, company_id, project_id, document_id, quote, confidence, status) SELECT 'deadline_missed', c.id, p.id, d.id, 'Срыв срока признан застройщиком', 0.9, 'confirmed' FROM projects p, companies c, raw_documents d;"
npm run backfill:revisions -- --apply
```

| Команда | Ожидается |
|---|---|
| `npm run backfill:assertions` | `dry-run`; `project_participant.assertionsCreated: 1`, `mention.assertionsCreated: 1`, `event.manualStatusesMigrated: 1` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM assertions"` | `0` |
| `npm run backfill:assertions -- --apply` | те же числа, `ЗАПИСЬ` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT decision, reviewer, provenance_gap FROM review_decisions"` | одна строка: `reviewed_supported`, `legacy_unknown`, `t` |
| `npm run backfill:assertions -- --apply --from-start` | `assertionsCreated: 0`, `evidenceCreated: 0`, `event.manualStatusesExisting: 1` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE evidence SET quote='x'"` | ошибка `evidence: содержание доказательства неизменяемо` |

### E2. Панель в админке

1. Данные (как в C1 — без `DATABASE_URL`, с `TEST_DATABASE_URL`): `npm run seed:test-assertions`.
2. API (`npm run dev` с переменными раздела B) и UI (`frontend: npm run dev`), вход токеном.
3. «Админка» → «Проверка утверждений» → фильтр «Есть в тексте»: строка «Демо-Гамма — Генподрядчик на объекте
   Демо-Квартал (корпус 3)», «за 2 · против 1».
4. Открыть: слева два «подтверждает» с выделенной цитатой и контекстом, справа одно «опровергает»; ссылки «версии».
5. «Подтвердить» + причина → «Решение записано», история: «подтверждено аналитиком · operator · версия N».
6. Две вкладки: в обеих открыть утверждение; в первой записать «Спорно», во второй — «Отклонить» →
   сообщение «Утверждение изменилось в другой вкладке…», данные обновились, решение первой вкладки на месте.
7. «отозвать» у одного поддерживающего доказательства (причина ≥ 3 символов) → оно тусклое с причиной,
   утверждение в фильтре «Нужен пересмотр», история решений не пропала.
8. Ширина 390 px: колонки «подтверждает/опровергает» друг под другом, без горизонтального скролла страницы.

---

## F. Этап 03B — конвейер из командной строки

### F1. Данные

Схема с нуля (переменные `DATABASE_URL`, `DATABASE_SSL`, `DOTENV_CONFIG_PATH` — как в разделе B):

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
```

Seed запускается без `DATABASE_URL` (иначе guard откажет), затем переменные раздела B возвращаются:

```powershell
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-reprocess
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
```

Ожидается три строки: `опубликован набор #1`, `ждёт публикации набор #2`, `устаревший набор #3`
(номера могут отличаться — дальше подставлять свои).

### F2. Команды

| Команда | Ожидается |
|---|---|
| `npm run pipeline:once -- --runs` | три запуска `completed`, у каждого покрытие `N/N`; наборы `published`, `built`, `built` |
| `npm run pipeline:once -- --preview 2` | `+ добавится (1)`: `event||court_case…`; `- снимется основание (1)`: `event||delay…`; `= без изменений (3)` |
| `npm run pipeline:once -- --preview 3` | строка `УСТАРЕЛ: у публикации есть более новая редакция…` |
| `npm run pipeline:once -- --publish 3` | `rejected_stale`, код выхода 1 (так и должно быть) |
| `npm run pipeline:once -- --publish 2` | `published, версия 2`, `снято` ≥ 1 |
| `npm run pipeline:once -- --publish 2` | `already_published, версия 2` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT status, count(*) FROM evidence GROUP BY status ORDER BY status"` | `active` и `superseded`, строк не меньше, чем до публикации |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT type, origin FROM card_events_v"` | одна строка: `court_case`, `published` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM projects WHERE name = 'Демо-Роща'"` | `1` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT action, actor FROM publication_history ORDER BY id"` | `publish seed`, `rejected_stale cli`, `publish cli` |
| `npm run pipeline:once -- --reextract` | `нужен явный --limit N`, код выхода 1 |
| `npm run pipeline:once -- --merge 1` | `команда заблокирована: слияние заблокировано до этапа 04…` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE extraction_chunk_responses SET error='x'"` | ошибка append-only |

`pipeline:once` без флагов здесь **не запускать**: он обращается к LM Studio.

---

## Уборка

```bash
# Ctrl+C в окнах npm run dev
docker compose -f backend/test-db/docker-compose.yml down   # или: docker rm -f tg-info-test-db
```

## Что прислать

Для каждого шага — «ок» или команду и вывод. Для тестов — хвост вывода с именами упавших тестов.
Содержимое `.env` и токен не присылать.
