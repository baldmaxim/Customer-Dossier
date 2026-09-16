# Матрица закрытия приёмки 09

Дата: 2026-09-16. Состояние: **пользовательский прогон G01/A–G выполнен; см. `%USERPROFILE%\tg-info-09-closure` и итог в `stages/09_REPORT.md`.**
Статусы: PASS — есть лог на текущем коде с exit 0; PARTIAL — существенная часть ок, есть оговорка; NOT_RUN — не
запускалось; BLOCKED_ENV — среда; N/A — неприменимо. Исторические результаты 09 (`USER_RUN.md`, код `bc4aa36`+фиксы)
относятся к своему коду и старому inventory и здесь не переименованы в новые.

Логи агента: `closure/` рядом с этим файлом. Логи пользовательского закрытия: `%USERPROFILE%\tg-info-09-closure`
(без дампа и `.env`). Отпечаток — `release:fingerprint`. Команды — `USER_RUN_CLOSURE.md` (разделы G01, A–G).

Итоговый код агента (до прогона): HEAD `7c76c35` + 46 путей, `treeSha256 = 22dbe00f…` (`closure/tree-final.json`).
Прогон пользователя: HEAD `10d83d9` + правка `inventory.ts` mid-run (см. ниже); worktree fingerprint **не совпал** с
`tree-final.json` (ожидали `22dbe00f…`, получили `d9c6eb03…` → после фикса `80deaae1…`). Node v24.13.0, npm 11.6.2.

## Группы (G01–G07 из `09_USER_ACCEPTANCE.md`)

| Gate | Что необходимо | Агент (лог) | Пользователь | Статус |
|---|---|---|---|---|
| G01 состояние кода | HEAD + fingerprint, версии, безопасный target | `closure/unit-final.log` (заголовок) | G01 | PASS* (fingerprint ≠ tree-final; docker `postgres:17-alpine` / `test-only`) |
| G02 unit/build | все unit-файлы, typecheck, сборки | `closure/unit-final.log` (35 / 497) | A | PASS (35/497; `npm ci`; check:build ok) |
| G03 интеграция | TC-074/076/077 и полный набор | typecheck тестов | B2 | PASS (19 файлов / 210; после фикса inventory) |
| G04 backup/restore | реальный dump/restore, content-сравнение, функциональное чтение | unit manifest | E1–E7 | PASS (E6: snapshot hash ок; `export_json` sha нестабилен) |
| G05 UI/restart/failure | сценарий, отдельный процесс, отказ БД, 390 px, печать | unit DB-down, static PWA | C2, D1–D2 | PARTIAL (API+probe+503; PDF/390px/Cache Storage NOT_RUN; `export_json` drift) |
| G06 performance | валидный HTTP baseline + synthetic pipeline отдельно | unit bench | F0–F1 | PASS (`local-bench@2`, 5/5 + pipeline_synthetic) |
| G07 документы | инструкции соответствуют выполненному | этот пакет документов | по итогам прогона | обновлено по логам |

## Исходные TC

| TC / требование | Автоматическая проверка (файл → тест) | Ручной шаг | Статус на текущем коде |
|---|---|---|---|
| **TC-074** установка с нуля, повтор, dry-run без записи | `release/release.int.test.ts` → «миграции применяются с пустой схемы, повтор ничего не делает, dry-run не пишет»; `db/migrate.int.test.ts` → «dry-run без schema_migrations не выполняет DDL и DML (TC-003)», «повторный запуск и dry-run — no-op» | B2 | PASS (в полном наборе 19/210) |
| TC-074 synthetic-legacy upgrade | `release.int` → «база, накаченная только до 009, доганяется без потери legacy-данных». Формулировка результата: «миграции прошли на построенной базе до 009 с подготовленными legacy-строками», не миграция ваших данных | B2 | PASS (в полном наборе 19/210) |
| TC-074 `--upto` валиден, применённые миграции не правятся | `db/migrate.test.ts` → «некорректный --upto — ошибка…», «неизвестный флаг…», «применённые миграции 001–020 на месте…»; CLI `--upto` требует общий preflight тестовой цели | — | PASS (unit, агент) |
| TC-074 чистая установка из lock | `npm ci` | A | PASS (backend+frontend `npm ci`, логи в tg-info-09-closure) |
| **TC-075** dump/restore + содержательное сравнение + чтение | `release/manifest.test.ts` (26), `release/manifest.int.test.ts` (10), `release/inventory.test.ts` (9) | E1–E7 | PASS (MATCH restore; E7 MISMATCH evidence; E6 snapshot hash ок) |
| **TC-076** полный путь, правка, evidence, review, merge, старый снимок | `release.int` → «публикация, разбор…», «отрицание даёт противоречие…», «обращение, досье и снимок…», «новая публикация, правка, переразбор и слияние…»; `snapshot/snapshot.int.test.ts` → «новая публикация, переименование, слияние… не меняют S1» | C2 | PASS* (интеграция + API C2; визуал браузера/PDF/390px NOT_RUN) |
| TC-076 late chunk failure ПОСЛЕ успешного релевантного | `reprocess/reprocess.int.test.ts` → «TC-076: сбой позднего чанка ПОСЛЕ релевантного успешного — partial, канон и решения аналитика прежние, повтор публикует целиком» (новый); прежний «падение последнего чанка → partial…» | — | PASS (в полном наборе 19/210) |
| TC-076 атомарность публикации, повтор | `reprocess.int` → «crash внутри транзакции публикации: читатель видит прежнее состояние целиком», «повтор той же публикации идемпотентен» | — | PASS (в полном наборе 19/210) |
| TC-076 merge → review | `release.int` → «слияние сущности с решением аналитика: решение остаётся у исходного утверждения, досье видит его через линию слияния, повтор не удваивает, старый снимок цел» (новый); `resolve/identity.int.test.ts` TC-039…041; `dossier/dossier.test.ts` → «решение до слияния видно через линию слияния, но не переносится…» | — | PASS (после фикса `assertion_company_merged`) |
| TC-076 перезапуск отдельного процесса | `release.int` «перезапуск приложения…» — пересоздание в том же процессе, **не заменяет** ручной шаг | D1 (`release:probe`) | PARTIAL (snapshot/html/md/dossier совпали; `export_json` sha плавает) |
| **TC-077** БД недоступна / восстановление | `api/dbDown.test.ts` (7, мёртвый адрес: 5xx, не пустые данные, процесс отвечает) | D2 (`docker stop/start`) | PASS (health 503; healthy; snapshot hash прежний) |
| TC-077 модель: исключение, timeout | `release.int` → «модель недоступна…»; `reprocess.int` → «timeout модели записывается как timeout, запуск failed» | — | PASS (в полном наборе 19/210) |
| TC-077 сеть/таймаут | `net/safeFetch.test.ts` → «зависший сервер: исход timeout…», «тело, оборванное на середине: timeout…» (новые) | — | PASS (unit, агент) |
| TC-077 таймаут разборщика | N/A: разбор HTML синхронный и ограничен размером ответа (`oversize`, `parser_degraded` в `sites.int`) | — | N/A |
| TC-077 ошибочная схема ответа | `release.int` → «ответ модели не по схеме…»; `reprocess.int` (invalid_json последнего чанка) | — | PASS (в полном наборе 19/210) |
| TC-077 допуск отозван до apply/publish | `reprocess.int` → «отзыв права ИИ после разбора…»; `release.int` → «допуск источника отозван…»; `ingest/policy.int.test.ts`; `telegram.int` → «отзыв допуска во время прохода…». Отзыв между чанками — замечание F05, этап 11 | — | PASS (интеграция; C2 revoke API hash снимка прежний) |
| TC-077 два worker'а, повтор задания | `reprocess.int` → «два worker'а: захватывает один…», «crash до commit итога…» | — | PASS (в полном наборе 19/210) |
| TC-077 несанкционированная запись, CSRF/Origin/Host | `api/auth.test.ts` «защита API (TC-004, TC-005)»; `release.int` → «без входа, без CSRF и с чужим Origin…» | C2 (выход) | PASS (интеграция + unit) |
| TC-077 опасный URL (SSRF) | `net/safeFetch.test.ts` (DNS, редиректы, metadata, loopback) | — | PASS (unit) |
| TC-077 PWA-кэш `/api` | `frontend/scripts/check-build.mjs` (артефакт сборки: только NavigationRoute с `/api` в denylist, стратегий кэширования нет, очистка кэша `api` при старте и выходе) | C2 в браузере (Application → Cache Storage) | static PASS (`closure/frontend-build.log`); UI_USER NOT_RUN |
| TC-077 ошибка записи: публикация и курсор не расходятся | `ingest/telegram/telegram.int.test.ts` → «TC-077: инъекция ошибки записи курсора…» (новый; контролируемый триггер, **не** заполнение диска) | — | PASS (интеграция). Реальный disk-full — не проверяется |
| **TC-078** HTTP/read-model | `release/bench.test.ts` (12: HTTP 400/401 и пустое досье — ошибка, медиана только по успешным, невалидный отчёт) | F1 | PASS (`bench.json` / `bench.log`, все шаги OK 5/5) |
| TC-078 ingestion/pipeline отдельно | `release/benchPipeline.ts` (`--pipeline-synthetic`, метка `synthetic/mocked model`) | F1 | PASS (synthetic/mocked). Реальная модель — NOT_RUN |

## Три отдельные проверки

| Проверка | Что доказано | Что НЕ доказано | Статус |
|---|---|---|---|
| XSS/экспорт | `snapshot/snapshot.test.ts` → «HTML: без скриптов…», «Markdown: ссылки…», «опасный URL источника (javascript:/data:/vbscript:/file:…) не становится ссылкой…» (новый); `release.int` «опасный фрагмент…» | исполнение в реальном браузере | unit PASS; браузер NOT_RUN |
| Prompt injection | `reprocess/semantic/semantic.test.ts` TC-059 (4); `release.int` → «инструкция в тексте источника (mock-модель): неподтверждённые сущности и роль не попадают в канон, допуск, флаги и сеть не затронуты» (новый) | устойчивость настоящей модели | unit PASS; DB_USER NOT_RUN; реальная модель NOT_RUN |
| Секреты | `release/secrets.test.ts` (4: значения маркеров в логах, ответах HTTP, ошибках env и тестовой цели, manifest); `release/manifest.test.ts` «pickConfig…»; `db/testTarget.test.ts` «ни одна ошибка preflight не содержит пароль»; бандл — `check:build` с маркерами в окружении сборки | отсутствие настоящих секретов в чужих местах машины | PASS (unit + static, агент) |

## Защита тестовой цели

| Сценарий | Проверка | Статус |
|---|---|---|
| Имя со словом test, неразрешённое имя/адрес | `db/testTarget.test.ts` → «произвольное имя с test и не-loopback адрес отклоняются»; B1 | PASS (B1: `prod_test` и пустой TEST_DATABASE_URL → exit 1) |
| Нет выделенной цели, fallback на DATABASE_URL | «имя со словом test без выделенного TEST_DATABASE_URL отклоняется, DATABASE_URL не подхватывается» | unit PASS |
| Известная рабочая цель (оболочка, `backend/.env`) | «известная рабочая цель из backend/.env…», «рабочий адрес из оболочки…» | unit PASS |
| Незаданный параметр (роль) | «роль в адресе обязательна» | unit PASS |
| Заявленное ≠ фактическое (база, роль, маркер) | «после подключения: несовпадение базы, роли или отсутствие маркера — отказ»; F0 | PASS (F0: нет маркера → exit 1) |
| Общий preflight до записи | `db/testTargetBootstrap.ts` в `integration/setup.ts`, `integration/db.ts`, всех `seed*Demo.ts`, `release/benchCli.ts`, `migrate --upto` | PASS (интеграция + bench/seed на прогоне) |

## Пользовательский прогон закрытия (2026-09-16)

Логи: `C:\Users\odintsov.a.a\tg-info-09-closure` (`RESULTS.md`, `UI_USER.md`). Дамп и `.env` не прилагались.

Найдено и исправлено в прогоне: `assertion_company_merged` считал исторические утверждения на tombstone после
слияния (ложная связность после merge→review). Правка: только утверждения с **активными** основаниями —
`backend/src/release/inventory.ts` (коммит `c289cb1`). Первый B2: 1 failed / 210; после фикса:
19 / 210 exit 0.

Разбор оговорок (агент, после прогона):

- **`export_json` sha плавает — не дефект снимка.** JSON-выгрузка содержит `availability.checkedAt` — время проверки
  текущего допуска при выдаче (`snapshot/availability.ts`), оно новое на каждый запрос. HTML и MD его не содержат и совпали;
  hash и payload снимка стабильны. `release:probe` исправлен: `export_json` сравнивается без `availability.checkedAt`.
  D1/E6 → PASS по содержанию; повторная проба новой версией желательна, но не обязательна.
- **fingerprint ≠ `tree-final.json`.** Две причины: правка `inventory.ts` во время прогона и `tree-fingerprint@1`, который
  хешировал сырые байты — при `core.autocrlf=true` у вас рабочее дерево в CRLF, у агента файлы в LF. `tree-fingerprint@2`
  хеширует git blob с нормализацией окончаний строк (проверено: CRLF и LF дают один blob). Код прогона = `10d83d9` +
  правка `inventory.ts` из `c289cb1`, это подтверждается коммитом, а не отпечатком.
- Визуал браузера (печать в PDF, 390 px, Cache Storage) — NOT_RUN, UI_USER; сборка проверена статически (`check:build`).

Сырые логи лежат на машине пользователя; агент принимает gates по присланной сводке `RESULTS.md`.

## Прогоны агента на текущем коде

| Проверка | Команда (cwd) | Exit | Итог | Лог |
|---|---|---|---|---|
| typecheck + build backend | `npm run typecheck`, `npm run build` (backend) | 0 / 0 | PASS | `closure/backend-typecheck-build.log` |
| unit | `npx vitest run --maxWorkers=2 --reporter=verbose` (backend, unit-профиль с мёртвым адресом БД) | 0 | PASS: 35 файлов / 497 тестов, 0 skipped | `closure/unit-final.log` (промежуточный прогон до последних правок — `unit-maxworkers2-intermediate.log`, не итоговый) |
| frontend build + check:build с маркерами | `npm run build`, `npm run check:build` (frontend) | 0 / 0 | PASS | `closure/frontend-build.log` (попытки 1–3 сохранены: 1 — ложные срабатывания правил проверки, исправлены; 2 — exit 127 на шаге PWA без вывода, не воспроизвёлся; 3 — PASS до финальной правки backend-скрипта) |
