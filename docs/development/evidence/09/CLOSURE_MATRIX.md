# Матрица закрытия приёмки 09

Дата: 2026-09-16. Состояние: **подготовлено к пользовательской приёмке; обязательные пользовательские проверки NOT_RUN.**
Статусы: PASS — есть лог на текущем коде с exit 0; NOT_RUN — не запускалось на текущем коде; BLOCKED_ENV — не
запустилось по причине среды; N/A — неприменимо, с причиной. Исторические результаты 09 (`USER_RUN.md`, код `bc4aa36`+фиксы)
относятся к своему коду и старому inventory и здесь не переименованы в новые.

Логи агента: `closure/` рядом с этим файлом. Отпечаток кода — в заголовке каждого лога (`release:fingerprint`:
HEAD + sha256 рабочего дерева без `docs/development/`, `prompts/`, `.env*`, `*.zip`, `dist`, `node_modules`).
Пользовательские шаги — `USER_RUN_CLOSURE.md` (разделы G01, A–G).

Итоговый код агента: HEAD `7c76c35` + 46 незакоммиченных путей кода, `treeSha256 = 22dbe00f4c0e231e2536c45120affe26a11233ef4e5aad3d4ffb91bb164fda0a` (`closure/tree-final.json`,
2026-09-16, Windows 10 Pro 19045, Node v24.14.1, npm 11.11.0, vitest 4.1.11). Все три итоговых лога агента сняты на нём.

## Группы (G01–G07 из `09_USER_ACCEPTANCE.md`)

| Gate | Что необходимо | Агент (лог) | Пользователь | Статус |
|---|---|---|---|---|
| G01 состояние кода | HEAD + fingerprint, версии, безопасный target | `closure/unit-final.log` (заголовок) | G01 | агент: зафиксировано; пользователь NOT_RUN |
| G02 unit/build | все unit-файлы, typecheck, сборки | `closure/unit-final.log` (35 / 497, exit 0), `closure/backend-typecheck-build.log`, `closure/frontend-build.log` | A | агент: PASS; пользователь NOT_RUN |
| G03 интеграция | TC-074/076/077 и полный набор | typecheck тестов | B2 | NOT_RUN |
| G04 backup/restore | реальный dump/restore, content-сравнение, функциональное чтение | unit manifest | E1–E7 | NOT_RUN |
| G05 UI/restart/failure | сценарий, отдельный процесс, отказ БД, 390 px, печать | unit DB-down, static PWA | C2, D1–D2 | NOT_RUN |
| G06 performance | валидный HTTP baseline + synthetic pipeline отдельно | unit bench | F0–F1 | NOT_RUN |
| G07 документы | инструкции соответствуют выполненному | этот пакет документов | по итогам прогона | CODE_READY |

## Исходные TC

| TC / требование | Автоматическая проверка (файл → тест) | Ручной шаг | Статус на текущем коде |
|---|---|---|---|
| **TC-074** установка с нуля, повтор, dry-run без записи | `release/release.int.test.ts` → «миграции применяются с пустой схемы, повтор ничего не делает, dry-run не пишет»; `db/migrate.int.test.ts` → «dry-run без schema_migrations не выполняет DDL и DML (TC-003)», «повторный запуск и dry-run — no-op» | B2 | NOT_RUN (DB_USER) |
| TC-074 synthetic-legacy upgrade | `release.int` → «база, накаченная только до 009, доганяется без потери legacy-данных». Формулировка результата: «миграции прошли на построенной базе до 009 с подготовленными legacy-строками», не миграция ваших данных | B2 | NOT_RUN (DB_USER) |
| TC-074 `--upto` валиден, применённые миграции не правятся | `db/migrate.test.ts` → «некорректный --upto — ошибка…», «неизвестный флаг…», «применённые миграции 001–020 на месте…»; CLI `--upto` требует общий preflight тестовой цели | — | PASS (unit, агент) |
| TC-074 чистая установка из lock | `npm ci` | A | NOT_RUN (агент зависимостей не переустанавливал) |
| **TC-075** dump/restore + содержательное сравнение + чтение | `release/manifest.test.ts` (26), `release/manifest.int.test.ts` (10), `release/inventory.test.ts` (9) | E1–E7 | unit PASS; DB_USER NOT_RUN |
| **TC-076** полный путь, правка, evidence, review, merge, старый снимок | `release.int` → «публикация, разбор…», «отрицание даёт противоречие…», «обращение, досье и снимок…», «новая публикация, правка, переразбор и слияние…»; `snapshot/snapshot.int.test.ts` → «новая публикация, переименование, слияние… не меняют S1» | C2 | NOT_RUN (DB_USER/UI_USER) |
| TC-076 late chunk failure ПОСЛЕ успешного релевантного | `reprocess/reprocess.int.test.ts` → «TC-076: сбой позднего чанка ПОСЛЕ релевантного успешного — partial, канон и решения аналитика прежние, повтор публикует целиком» (новый); прежний «падение последнего чанка → partial…» | — | NOT_RUN (DB_USER) |
| TC-076 атомарность публикации, повтор | `reprocess.int` → «crash внутри транзакции публикации: читатель видит прежнее состояние целиком», «повтор той же публикации идемпотентен» | — | NOT_RUN (DB_USER) |
| TC-076 merge → review | `release.int` → «слияние сущности с решением аналитика: решение остаётся у исходного утверждения, досье видит его через линию слияния, повтор не удваивает, старый снимок цел» (новый); `resolve/identity.int.test.ts` TC-039…041; `dossier/dossier.test.ts` → «решение до слияния видно через линию слияния, но не переносится…» | — | unit PASS; DB_USER NOT_RUN |
| TC-076 перезапуск отдельного процесса | `release.int` «перезапуск приложения…» — пересоздание в том же процессе, **не заменяет** ручной шаг | D1 (`release:probe`) | NOT_RUN (DB_USER) |
| **TC-077** БД недоступна / восстановление | `api/dbDown.test.ts` (7, мёртвый адрес: 5xx, не пустые данные, процесс отвечает) | D2 (`docker stop/start`) | unit PASS; DB_USER NOT_RUN |
| TC-077 модель: исключение, timeout | `release.int` → «модель недоступна…»; `reprocess.int` → «timeout модели записывается как timeout, запуск failed» | — | NOT_RUN (DB_USER) |
| TC-077 сеть/таймаут | `net/safeFetch.test.ts` → «зависший сервер: исход timeout…», «тело, оборванное на середине: timeout…» (новые) | — | PASS (unit, агент) |
| TC-077 таймаут разборщика | N/A: разбор HTML синхронный и ограничен размером ответа (`oversize`, `parser_degraded` в `sites.int`) | — | N/A |
| TC-077 ошибочная схема ответа | `release.int` → «ответ модели не по схеме…»; `reprocess.int` (invalid_json последнего чанка) | — | NOT_RUN (DB_USER) |
| TC-077 допуск отозван до apply/publish | `reprocess.int` → «отзыв права ИИ после разбора…»; `release.int` → «допуск источника отозван…»; `ingest/policy.int.test.ts`; `telegram.int` → «отзыв допуска во время прохода…». Отзыв между чанками — замечание F05, этап 11 | — | NOT_RUN (DB_USER) |
| TC-077 два worker'а, повтор задания | `reprocess.int` → «два worker'а: захватывает один…», «crash до commit итога…» | — | NOT_RUN (DB_USER) |
| TC-077 несанкционированная запись, CSRF/Origin/Host | `api/auth.test.ts` «защита API (TC-004, TC-005)»; `release.int` → «без входа, без CSRF и с чужим Origin…» | C2 (выход) | unit PASS; DB_USER NOT_RUN |
| TC-077 опасный URL (SSRF) | `net/safeFetch.test.ts` (DNS, редиректы, metadata, loopback) | — | PASS (unit) |
| TC-077 PWA-кэш `/api` | `frontend/scripts/check-build.mjs` (артефакт сборки: только NavigationRoute с `/api` в denylist, стратегий кэширования нет, очистка кэша `api` при старте и выходе) | C2 в браузере (Application → Cache Storage) | static PASS (`closure/frontend-build.log`); UI_USER NOT_RUN |
| TC-077 ошибка записи: публикация и курсор не расходятся | `ingest/telegram/telegram.int.test.ts` → «TC-077: инъекция ошибки записи курсора…» (новый; контролируемый триггер, **не** заполнение диска) | — | NOT_RUN (DB_USER). Реальный disk-full — не проверяется |
| **TC-078** HTTP/read-model | `release/bench.test.ts` (12: HTTP 400/401 и пустое досье — ошибка, медиана только по успешным, невалидный отчёт) | F1 | unit PASS; DB_USER NOT_RUN |
| TC-078 ingestion/pipeline отдельно | `release/benchPipeline.ts` (`--pipeline-synthetic`, метка `synthetic/mocked model`) | F1 | NOT_RUN. Реальная модель — NOT_RUN |

## Три отдельные проверки

| Проверка | Что доказано | Что НЕ доказано | Статус |
|---|---|---|---|
| XSS/экспорт | `snapshot/snapshot.test.ts` → «HTML: без скриптов…», «Markdown: ссылки…», «опасный URL источника (javascript:/data:/vbscript:/file:…) не становится ссылкой…» (новый); `release.int` «опасный фрагмент…» | исполнение в реальном браузере | unit PASS; браузер NOT_RUN |
| Prompt injection | `reprocess/semantic/semantic.test.ts` TC-059 (4); `release.int` → «инструкция в тексте источника (mock-модель): неподтверждённые сущности и роль не попадают в канон, допуск, флаги и сеть не затронуты» (новый) | устойчивость настоящей модели | unit PASS; DB_USER NOT_RUN; реальная модель NOT_RUN |
| Секреты | `release/secrets.test.ts` (4: значения маркеров в логах, ответах HTTP, ошибках env и тестовой цели, manifest); `release/manifest.test.ts` «pickConfig…»; `db/testTarget.test.ts` «ни одна ошибка preflight не содержит пароль»; бандл — `check:build` с маркерами в окружении сборки | отсутствие настоящих секретов в чужих местах машины | PASS (unit + static, агент) |

## Защита тестовой цели

| Сценарий | Проверка | Статус |
|---|---|---|
| Имя со словом test, неразрешённое имя/адрес | `db/testTarget.test.ts` → «произвольное имя с test и не-loopback адрес отклоняются»; B1 | unit PASS; B1 NOT_RUN |
| Нет выделенной цели, fallback на DATABASE_URL | «имя со словом test без выделенного TEST_DATABASE_URL отклоняется, DATABASE_URL не подхватывается» | unit PASS |
| Известная рабочая цель (оболочка, `backend/.env`) | «известная рабочая цель из backend/.env…», «рабочий адрес из оболочки…» | unit PASS |
| Незаданный параметр (роль) | «роль в адресе обязательна» | unit PASS |
| Заявленное ≠ фактическое (база, роль, маркер) | «после подключения: несовпадение базы, роли или отсутствие маркера — отказ»; F0 | unit PASS; F0 NOT_RUN |
| Общий preflight до записи | `db/testTargetBootstrap.ts` в `integration/setup.ts`, `integration/db.ts`, всех `seed*Demo.ts`, `release/benchCli.ts`, `migrate --upto` | code review; DB_USER NOT_RUN |

## Прогоны агента на текущем коде

| Проверка | Команда (cwd) | Exit | Итог | Лог |
|---|---|---|---|---|
| typecheck + build backend | `npm run typecheck`, `npm run build` (backend) | 0 / 0 | PASS | `closure/backend-typecheck-build.log` |
| unit | `npx vitest run --maxWorkers=2 --reporter=verbose` (backend, unit-профиль с мёртвым адресом БД) | 0 | PASS: 35 файлов / 497 тестов, 0 skipped | `closure/unit-final.log` (промежуточный прогон до последних правок — `unit-maxworkers2-intermediate.log`, не итоговый) |
| frontend build + check:build с маркерами | `npm run build`, `npm run check:build` (frontend) | 0 / 0 | PASS | `closure/frontend-build.log` (попытки 1–3 сохранены: 1 — ложные срабатывания правил проверки, исправлены; 2 — exit 127 на шаге PWA без вывода, не воспроизвёлся; 3 — PASS до финальной правки backend-скрипта) |
