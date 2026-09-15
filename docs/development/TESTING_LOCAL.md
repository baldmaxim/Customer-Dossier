# Проверка у себя — пошагово

Все команды — из корня `TG_Info`, ветка `dossier-stages`. Для PowerShell и bash даны оба варианта там,
где они различаются. Рабочая база, `.env` и живые источники не используются.

**Сейчас проверяется этап 07** (объяснимые сигналы вместо индекса риска): шаги A1–A5, затем раздел K (данные — из J1).
Разделы B–J — проверки этапов 01–06 (пройдены), повторять не обязательно.
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

Ожидается: typecheck без ошибок; unit — **27 файлов / 398 тестов passed**; сборка frontend успешна.

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

Ожидается: `[integration] тестовая цель: 127.0.0.1:55433/tg_info_test`, затем **15 файлов / 163 теста passed**:

| Файл | Что проверяет |
|---|---|
| `signals/signals.int.test.ts` | **этап 07**: TC-060…TC-064 — снимок на срез через API, карточка без индекса риска и deprecated legacy-эндпоинт, пять перепечаток и событие без даты, drilldown совпадает с SQL, компания без публикаций, контекст объекта без пересечения периодов, список подрядчиков без сортировки по риску, сбой пересчёта сохраняет снимок, детерминизм повтора |
| `reprocess/semantic/semantic.int.test.ts` | **этап 06**: TC-052…TC-058 — отрицание из другой публикации опровергает роль (решение сохранено, нужен пересмотр, очередь), план и слух не в карточке, «факт» с признаком плана — на проверку, цепочка договоров без транзитивного, два дела и стадии дела с номером через API, состояние объекта при поздней статье, чужая сумма, перенос объекта договора при слиянии |
| `ingest/telegram/telegram.int.test.ts` | **этап 05B**: TC-047…TC-051 — первый запуск без истории, разрыв и ограниченная догрузка без дублей, сбой страницы разрыва, отзыв допуска во время прохода, чужой канал в data-post, правка и короткое опровержение, одинаковый текст в двух каналах, пересылка без источника; бот — повтор обновления и перезапуск, сбой посреди пачки, правка сообщения, скрытый автор и подпись без вложения, пустой allowlist, пропуск update_id и отзыв допуска |
| `ingest/sites/sites.int.test.ts` | **этап 05A**: TC-042…TC-046 — RSS-анонс → полная статья, честный анонс при недоступной статье, 304 по ETag, повтор без дублей, правка статьи, редирект вне allowlist, HTML-список с пагинацией и датами зоны профиля, значимый query-параметр, сбой второй страницы и продолжение, лимит страниц и хвост, parser_degraded, 429/403/oversize, неверный профиль, карточка объекта без ложных «новостей», проба без записи |
| `resolve/identity.int.test.ts` | **этап 04**: TC-034…TC-041 — разные ИНН при одном имени, бренд и юрлицо, неоднозначность без выбора первой строки, ЖК в двух городах и неизвестный город, корпуса, поиск по реквизиту и алиасу, слияние с дубликатами, сбой в середине, коллизия уникальности, конкуренция и встречные операции, повтор, отмена и отказ небезопасной отмены, backfill идентичности |
| `reprocess/reprocess.int.test.ts` | **этап 03B**: полный путь и цепочка evidence → chunk → run → revision, падение последнего чанка, непокрытый хвост, timeout, crash до/после commit, два worker'а и fencing, поздний старый разбор, нерелевантная новая версия при двух источниках и ручном решении, отзыв права ИИ, одинаковые имена с разными ИНН, идемпотентная публикация, 409, проекции карточки, без дублей при переразборе |
| `assertions/assertions.int.test.ts` | **этап 03A**: TC-019…TC-024 — два доказательства и отзыв, опровержение рядом, новый смысл без наследования решения, 409/идемпотентность, FK/CHECK, проверка цитаты базой, эмодзи |
| `assertions/backfill.int.test.ts` | **этап 03A**: TC-025 — перенос legacy-канона, ручные статусы, неоднозначные цитаты, повтор |
| `db/migrate.int.test.ts` | dry-run без DDL, отказ destructive без флага, миграции 001–018 |
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

## I. Этап 05B — Telegram: курсоры, разрыв, журнал бота

Сеть и токены не нужны: seed отдаёт страницы `t.me/s/` внедрённым транспортом и подменяет Bot API внутри процесса.

### I1. Данные

Схема с нуля и seed — как в H1, последней командой `npm run seed:test-telegram` вместо `seed:test-sites`:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-telegram
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
```

Ожидается:
- `[seed] demo_tg_gap: ok`;
- `[seed] demo_tg_renamed: identity_changed: …`;
- `[seed] бот: обработано 3, принято 2, отклонено 1; повтор: 3 уже обработанных`;
- `[seed] demo_tg_gap: ok, gap_open_max_pages` и `[seed] demo_tg_renamed: identity_changed, identity_changed`.

### I2. База

| Команда | Ожидается |
|---|---|
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT key, health, health_reason, cursor->'tg' AS tg FROM sources WHERE key LIKE 'demo_tg_%' ORDER BY key"` | gap: `ok`, «разрыв постов 101…149 ещё не догружен», `tg` с `"lastPostId": 160` и `"gap": {"after": 100, "before": 150}`; renamed: `identity_uncertain`, курсора `tg` нет |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT s.key, count(i.id) FROM sources s LEFT JOIN source_items i ON i.source_id = s.id WHERE s.key LIKE 'demo_tg_%' GROUP BY s.key ORDER BY s.key"` | gap — 11 (посты 150…160); renamed — 0 |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT update_id, update_kind, outcome FROM bot_processed_updates ORDER BY update_id"` | три строки: 9001 `message` `inserted`; 9002 `message` `rejected_sender`; 9003 `edited_message` `new_revision`. Повтор строк не добавил |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT r.revision_no, left(r.body, 30) AS body, o.transport_meta->>'updateKind' AS kind, o.transport_meta->'forwardOrigin'->>'type' AS origin, o.transport_meta->>'editDate' AS edit FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id JOIN sources s ON s.id = i.source_id JOIN source_observations o ON o.revision_id = r.id WHERE s.key = 'bot' ORDER BY r.id, o.id"` | редакция 1 — `message`, origin `hidden_user`; редакция 2 — «Поправка: не так.», `edited_message`, дата правки заполнена |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE bot_processed_updates SET outcome = 'ignored' WHERE update_id = 9001"` | ошибка триггера append-only |

### I3. Админка

API и UI как в H4. «Админка» → «Источники»:

1. `demo_tg_gap`: «в порядке», причина «разрыв постов 101…149 ещё не догружен», «успешно: найдено 11, сохранено 11…»,
   «покрытие: разрыв постов ещё не догружен», `tg_web@2`.
2. `demo_tg_renamed`: «канал не совпадает с источником», итог «другой канал на странице».
3. Ширина 390 px: таблица скроллится внутри, страница без горизонтального скролла.

---

## J. Этап 06 — смысл связей, дела, состояние объекта, очередь проверки

LM Studio для J1–J3 не нужен: seed подменяет модель шаблонными ответами.

### J1. Данные

Схема с нуля и seed — как в H1, последней командой `npm run seed:test-semantic`:

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npx tsx src/db/migrate.ts --allow-destructive
Remove-Item Env:DATABASE_URL
$env:TEST_DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
npm run seed:test-semantic
$env:DATABASE_URL = 'postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'
```

Ожидается:
- «договоры»: две строки — `Демо-Порт → Демо-Зенит`, `general_contract`, `reported_fact`, корпус `корпус 2`;
  `Демо-Зенит → Демо-Вектор`, `subcontract`, пакет `ВК`. Договора `Демо-Зенит → Демо-Кварц` нет.
- «на проверку»: одна строка «на проверку: в цитате план или намерение, а утверждение — состоявшийся факт».
- «очередь»: `P2 polarity_conflict` и `P3 correction` с одним и тем же `ref_id`.
- «дело»: три строки `case:А40-555/2026` — `claim_filed` / `claim` / `12000000.00`; `decision` / `satisfied` / `award` /
  `9000000.00`; `appeal_filed` без суммы.
- «состояние объекта»: `construction`, `2026-07-01`, `month` (поздняя мартовская статья его не изменила).

### J2. База и CLI

| Команда | Ожидается |
|---|---|
| `npm run pipeline:once -- --queue` | `P2 polarity_conflict #…` и `P3 correction #…` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT a.polarity, a.status, a.needs_revalidation, (SELECT count(*) FROM evidence e WHERE e.assertion_id = a.id AND e.stance = 'contradicts') AS contradicts FROM assertions a WHERE a.predicate = 'participates_in_project' ORDER BY a.id"` | `positive`, `reviewed_supported`, `t`, 1; `negative`, `text_grounded`, `f`, 0 |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT count(*) FROM card_participations_v WHERE origin = 'published'"` | 1 (отрицание ролью не стало) |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT state, valid_from, period_precision FROM project_state_history_v ORDER BY valid_from"` | `suspended 2026-03-01 month`, `construction 2026-07-01 month` — ровно две строки |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "UPDATE assertions SET polarity = 'negative' WHERE id = (SELECT min(id) FROM assertions)"` | ошибка «содержание утверждения неизменяемо» |

### J3. API и админка

API и UI как в H4, вход токеном. В той же вкладке браузера (cookie сессии) откройте:

1. `http://127.0.0.1:5173/api/review-queue` — JSON `items` с `polarity_conflict` (priority 2) и `correction` (priority 3).
2. `http://127.0.0.1:5173/api/projects/<id>/state-history` — id объекта «Демо-Причал»
   (`SELECT id FROM projects WHERE name = 'Демо-Причал'`): `history` из двух состояний, `current` — `construction`.
3. `http://127.0.0.1:5173/api/companies/<id>/legal-cases` — id «Демо-Вектор»: одно дело `case:А40-555/2026` с тремя стадиями,
   суммы строками (`"12000000.00"`).
4. «Админка» → «Утверждения» → «Все»: строки «Демо-Порт → Демо-Зенит: договор генподряда по объекту Демо-Причал (корпус 2)»,
   «Демо-Зенит — не генподрядчик на объекте Демо-Причал», «Судебное дело: Демо-Вектор (истец) · контрагент Демо-Зенит · дело
   А40-555/2026». В карточке утверждения суда — «стадия: …», «требование: 12000000.00 RUB» или «присуждено: 9000000.00 RUB».
5. Фильтр «Нужен пересмотр»: положительная роль Демо-Зенит, в карточке «опровергает (1)».
6. Ширина 390 px: список и карточка утверждения без горизонтального скролла.

### J4. Необязательно: замер локальной модели

Только если LM Studio поднят с моделью из `LMSTUDIO_MODEL`. Отправляются только вымышленные тексты корпуса, база не нужна
(команда читает ваш `.env` ради адреса модели — значения не присылайте):

```bash
cd backend
npm run benchmark:model -- --out benchmark-06.json
```

Пришлите последнюю строку `[benchmark] …: safety X/Y, recall X/Y, ошибок модели N, медиана … мс` и строки «не выполнено».
Это не precision/recall на реальных данных; результат попадёт в отчёт как LOCAL_MODEL на синтетике.

---

## K. Этап 07 — объяснимые сигналы вместо индекса риска

LM Studio не нужен. Данные — те же, что в разделе J.

### K1. Данные и пересчёт

Выполните J1 (схема с нуля и `npm run seed:test-semantic`), затем с переменными раздела B (`DATABASE_URL` на тестовую базу):

```powershell
npm run metrics:refresh
```

Без `--cutoff` срез — текущий момент. Ожидается `[signals] снимок #1: компаний 4, срез <сейчас>, … мс` и строка
`[metrics] legacy company_metrics …`. Повтор с тем же `--cutoff <ISO-время позже seed>` даёт тот же payload (детерминизм проверен в A5).

### K2. База

| Команда | Ожидается |
|---|---|
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT id, rules_version, status, companies FROM signal_refreshes ORDER BY id"` | одна строка `signals@1`, `succeeded`, 4 |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT c.name, s.identity_status, s.projects, s.roles, s.events_dated_12m, s.events_undated, s.publications, s.families FROM company_signal_snapshots s JOIN companies c ON c.id = s.company_id ORDER BY c.name"` | Демо-Зенит: `name_only`, 1, `{general_contractor}`, 0, 3, 6, 6; Демо-Вектор: projects 0, events_undated 3, publications 4 |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT payload->'media'->'courtRoles' FROM company_signal_snapshots s JOIN companies c ON c.id = s.company_id WHERE c.name IN ('Демо-Зенит','Демо-Вектор') ORDER BY c.name"` | Вектор — `plaintiff: 1`; Зенит — `defendant: 1` |
| `docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT count(*) FROM company_risk"` | legacy-представление 007 на месте (число компаний) |

### K3. Сбой пересчёта сохраняет снимок

```powershell
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "ALTER TABLE company_signal_snapshots ADD CONSTRAINT k3_fail CHECK (false) NOT VALID"
npm run metrics:refresh
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "SELECT id, status, left(error, 60) FROM signal_refreshes ORDER BY id"
docker exec tg-info-test-db psql -U tg_test -d tg_info_test -c "ALTER TABLE company_signal_snapshots DROP CONSTRAINT k3_fail"
```

Ожидается: вторая команда печатает `[signals] пересчёт #2 не удался, остаётся прежний снимок: …` и код 1; в журнале #1 `succeeded`,
#2 `failed`; снимков #2 нет. Пока ограничение не снято — проверьте K4.1 (карточка показывает «Устарело: последний пересчёт
завершился ошибкой…» и прежние числа). После снятия ограничения `npm run metrics:refresh` снова успешен и пометка исчезает.

### K4. Админка и карточки

API и UI как в H4, вход токеном.

1. Карточка «Демо-Зенит» (поиск): в шапке нет цветной полосы-вердикта, бейджа и индекса. Под шапкой — «Срез … · правила signals@1»
   и три блока: «Идентификация и полнота данных» (только название, реквизитов нет; публикаций 6), «Опыт по объектам»
   (объектов 1, генподрядчик; «Не учтено как опыт … 1»; два договора — исполнитель по договору генподряда и заказчик по договору
   субподряда), «Публикации и события» (событий с датой за 12 месяцев 0, без даты 3; «компания — ответчик»; «Роль в деле — не вывод
   о нарушении»).
2. Раскрыть любое число: правило словами, окно, «из N», список `#id`. Клик по событию — карточка утверждения ниже.
3. «контекст объекта» у Демо-Причал: приостановка и возобновление «по сообщению источника», «пересечение неизвестно» (период
   участия не указан), состояние «строится с 01.07.2026», примечание «пересечение периодов не доказывает причинность».
4. «Статистика подрядчиков»: столбцы «Идентификация», «Объектов», «Роли», «События с датой, 12 мес», «Без даты», «Суды (роль)»,
   «Публикаций / семей»; сортировка только «По числу объектов» / «По названию». Демо-Зенит — первым.
5. Главная: «Идентификация компаний: только название, реквизитов нет — 4».
6. `http://127.0.0.1:5173/api/companies/<id>/legacy-risk` — JSON с `"deprecated": true`.
7. Ширина 390 px: блоки сигналов столбиком, числа раскрываются, без горизонтального скролла страницы.

---

## Уборка

```bash
# Ctrl+C в окнах npm run dev
docker compose -f backend/test-db/docker-compose.yml down   # или: docker rm -f tg-info-test-db
```

## Что прислать

Для каждого шага — «ок» или команду и вывод. Для тестов — хвост вывода с именами упавших тестов.
Содержимое `.env` и токен не присылать.
