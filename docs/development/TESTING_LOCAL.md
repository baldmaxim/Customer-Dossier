# Проверка у себя — пошагово

Все команды — из корня `TG_Info`, ветка `dossier-stages`. Для PowerShell и bash даны оба варианта там,
где они различаются. Рабочая база, `.env` и живые источники не используются.

**Сейчас проверяется этап 05A** (адаптеры сайтов, догоняющий обход, здоровье источников): шаги A1–A5, затем раздел H.
Разделы B–G — проверки этапов 01–04 (пройдены), повторять не обязательно.
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

Ожидается: typecheck без ошибок; unit — **24 файла / 352 теста passed**; сборка frontend успешна.

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

Ожидается: `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, затем **12 файлов / 135 тестов passed**:

| Файл | Что проверяет |
|---|---|
| `ingest/sites/sites.int.test.ts` | **этап 05A**: TC-042…TC-046 — RSS-анонс → полная статья, честный анонс при недоступной статье, 304 по ETag, повтор без дублей, правка статьи, редирект вне allowlist, HTML-список с пагинацией и датами зоны профиля, значимый query-параметр, сбой второй страницы и продолжение, лимит страниц и хвост, parser_degraded, 429/403/oversize, неверный профиль, карточка объекта без ложных «новостей», проба без записи |
| `resolve/identity.int.test.ts` | **этап 04**: TC-034…TC-041 — разные ИНН при одном имени, бренд и юрлицо, неоднозначность без выбора первой строки, ЖК в двух городах и неизвестный город, корпуса, поиск по реквизиту и алиасу, слияние с дубликатами, сбой в середине, коллизия уникальности, конкуренция и встречные операции, повтор, отмена и отказ небезопасной отмены, backfill идентичности |
| `reprocess/reprocess.int.test.ts` | **этап 03B**: полный путь и цепочка evidence → chunk → run → revision, падение последнего чанка, непокрытый хвост, timeout, crash до/после commit, два worker'а и fencing, поздний старый разбор, нерелевантная новая версия при двух источниках и ручном решении, отзыв права ИИ, одинаковые имена с разными ИНН, идемпотентная публикация, 409, проекции карточки, без дублей при переразборе |
| `assertions/assertions.int.test.ts` | **этап 03A**: TC-019…TC-024 — два доказательства и отзыв, опровержение рядом, новый смысл без наследования решения, 409/идемпотентность, FK/CHECK, проверка цитаты базой, эмодзи |
| `assertions/backfill.int.test.ts` | **этап 03A**: TC-025 — перенос legacy-канона, ручные статусы, неоднозначные цитаты, повтор |
| `db/migrate.int.test.ts` | dry-run без DDL, отказ destructive без флага, миграции 001–015 |
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

## G. Этап 04 — идентичность и слияние

### G1. Данные

Схема с нуля (переменные `DATABASE_URL`, `DATABASE_SSL`, `DOTENV_CONFIG_PATH` — как в разделе B), затем seed без `DATABASE_URL`:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-identity
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
```

Ожидается три строки: `пара-дубль #N1`, `пара с разными ИНН #N2`, `ЖК в двух городах #N3` — дальше подставлять свои номера.

### G2. Команды (флаг `MERGE_APPLY_ENABLED` пока не задан)

| Команда | Ожидается |
|---|---|
| `npm run pipeline:once -- --merges` | три пары |
| `npm run pipeline:once -- --merge N1` | предпросмотр: «Гранит-Демо» → «Демо-Гранит», `mentions 1`, `participants 1`, блоков нет, подсказка `--yes` |
| `npm run pipeline:once -- --merge N1 --yes` | предпросмотр, затем `команда заблокирована: применение слияния выключено (MERGE_APPLY_ENABLED=false)`, код 1 |
| `npm run pipeline:once -- --merge N2` | `БЛОК [identifier_conflict]`, код 1 |
| `npm run pipeline:once -- --merge N3` | `БЛОК [city_conflict]`, код 1 |

### G3. Применение, повтор и отмена

```powershell
$env:MERGE_APPLY_ENABLED = 'true'
```

| Команда | Ожидается |
|---|---|
| `npm run pipeline:once -- --merge N1 --yes` | `применено: слияние #M` |
| `npm run pipeline:once -- --merge N1 --yes` | предпросмотр с `уже слита` и код 1 (пара уже применена; второго слияния нет) |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT id, merged_into_id, version FROM companies ORDER BY id"` | у «Гранит-Демо» `merged_into_id` = id «Демо-Гранит», строка не удалена |
| `npm run pipeline:once -- --merge-history` | `#M company «Гранит-Демо» → «Демо-Гранит» applied (cli)` |
| `npm run pipeline:once -- --merge-undo M` | `слияние #M отменено, восстановлено изменений: K` |
| `npm run pipeline:once -- --merge-undo M` | `слияние #M уже отменено этой командой` |
| тот же `SELECT` | `merged_into_id` снова пусто |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE entity_merge_moves SET old_value = NULL"` | ошибка append-only |

Небезопасная отмена:

| Команда | Ожидается |
|---|---|
| `npm run pipeline:once -- --merge N1 --yes` | `применено: слияние #M2` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "INSERT INTO mentions (document_id, entity_kind, entity_id, surface_form, quote, confidence, published_at) SELECT document_id, 'company', (SELECT merged_into_id FROM companies WHERE name = 'Гранит-Демо'), 'x', 'новое после слияния', 0.9, now() FROM mentions LIMIT 1"` | `INSERT 0 1` |
| `npm run pipeline:once -- --merge-undo M2` | `Простая отмена небезопасна…`, строка `mentions: добавлено 1…`, шаги плана, код 1; `merged_into_id` не изменился |

### G4. Backfill идентичности

| Команда | Ожидается |
|---|---|
| `npm run backfill:identity -- --identifiers` | `dry-run`, `identifiersExisting` ≥ 2 (реквизиты seed уже в реестре) |
| `npm run backfill:identity -- --renormalize --apply` | `запись требует --confirm-copy`, код 1 |
| `npm run backfill:identity -- --renormalize --apply --confirm-copy` | `ЗАПИСЬ`, `companiesScanned`/`projectsScanned` ≥ 0 |
| та же команда | `companiesScanned: 0`, `projectsScanned: 0` |

### G5. Админка (API с `MERGE_APPLY_ENABLED=true`)

Повторить G1 (схема с нуля и seed). Окно API — с переменными раздела B и `$env:MERGE_APPLY_ENABLED = 'true'`, затем
`npm run dev`; UI — `frontend: npm run dev`, вход токеном.

1. «Админка» → «Очередь слияний»: три пары. «Предпросмотр» у пары-дубля: две карточки сторон (вид, форма, город,
   реквизиты), «1 упоминаний», «1 ролей на объектах (legacy)», кнопка «Слить» активна.
2. У пары с разными ИНН и у ЖК в двух городах — красные строки «Нельзя: …», «Слить» неактивна.
3. «Слить» у пары-дубля → уведомление «Слияние #… применено», пара ушла из очереди, в «Журнале слияний» строка.
4. «Отменить» в журнале → «Слияние отменено…», пара вернулась в очередь.
5. Карточка «Демо-Гранит» (поиск по `7707083893`): в шапке «юрлицо · ООО · ИНН 7707083893».
6. Ширина 390 px: карточки сторон друг под другом, без горизонтального скролла.

## H. Этап 05A — адаптеры сайтов и здоровье источников

Сеть не нужна: seed отдаёт страницы синтетических сайтов `*.test` внедрённым транспортом внутри процесса.

### H1. Данные

Схема с нуля (переменные `DATABASE_URL`, `DATABASE_SSL`, `DOTENV_CONFIG_PATH` — как в разделе B), затем seed без `DATABASE_URL`:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-sites
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
```

Ожидается: `ok-sites-demo.test … ok`, `degraded-sites-demo.test … parser_degraded`, `limited-sites-demo.test … rate_limited`;
строки `ok-sites-demo.test: ok, найдено 3, сохранено 3, ошибок 0` (две статьи и карточка объекта).

### H2. База

| Команда | Ожидается |
|---|---|
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT key, health, health_reason FROM sources WHERE key LIKE '%sites-demo.test' ORDER BY key"` | degraded — `parser_degraded` («селектор списка нашёл 0…»); limited — `rate_limited` («HTTP 429»); ok — `ok` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT s.key, r.outcome, r.pages_fetched, r.coverage->>'stopReason' AS stop, r.retry_after_at IS NOT NULL AS retry FROM source_runs r JOIN sources s ON s.id = r.source_id ORDER BY r.id"` | ok: `ok`, 2 страницы, `exhausted`; degraded: `parser_degraded`; limited: `rate_limited`, `retry = t` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT i.item_key, r.body_representation, r.completeness, r.completeness_reason, r.published_at_precision, r.published_at_raw FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id ORDER BY i.item_key"` | `/n1` — `site_article@1+title`, `full`, `local_tz`; `/n2` — `unknown`, `article_selector_missing`, `no_year`, сырой «11 сентября»; `/objects/1` — `project_card@1`, `full` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT cursor FROM sources WHERE key = 'ok-sites-demo.test'"` | `"site": {"caughtUp": true, "backlogNext": null, …}` |

### H3. CLI

Файл с неверным профилем (например, `bad-profile.json` с содержимым `{"mode":"html_list","startUrls":["https://ok-sites-demo.test/news"],"onFetch":"eval(1)"}`):

| Команда | Ожидается |
|---|---|
| `npm run ingest:once -- --site-profile ok-sites-demo.test --file bad-profile.json` | ошибка `профиль источника некорректен: …`, код 1, профиль в базе не изменился |
| `npm run ingest:once -- --probe-site ok-sites-demo.test` | живой запрос к несуществующему домену `*.test`: исход `network`, «ничего не сохранено» по смыслу, код 1 |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -t -c "SELECT count(*) FROM source_runs"` | то же число, что до пробы (проба не пишет запусков) |
| `npm run ingest:once -- --probe-site degraded-sites-demo.test` | тот же `network` (сети нет); допуск и статус источника не изменились |

### H4. Админка

API (`npm run dev` с переменными раздела B) и UI, вход токеном. «Админка» → «Источники»:

1. Колонка «Здоровье и последний запуск»: у ok-сайта «в порядке», «успешно: найдено 3, сохранено 3…», «покрытие: пройдены все
   страницы», время попытки и успеха, `site@1`; у degraded — «вёрстка изменилась?» и причина; у limited — «ограничение
   частоты (429)» и «повтор не раньше …».
2. Кнопка «Проба» у ok-сайта → блок «Проба: сеть недоступна…», «Ничего не сохранено».
3. У telegram/manual-источников колонка показывает прежние «запуск …: новых N из M» без поломки.
4. Ширина 390 px: таблица скроллится внутри, страница без горизонтального скролла.

---

## Уборка

```bash
# Ctrl+C в окнах npm run dev
docker compose -f backend/test-db/docker-compose.yml down   # или: docker rm -f tg-info-test-db
```

## Что прислать

Для каждого шага — «ок» или команду и вывод. Для тестов — хвост вывода с именами упавших тестов.
Содержимое `.env` и токен не присылать.
