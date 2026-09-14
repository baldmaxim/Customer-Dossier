# Отчёт этапа 01 — Безопасный локальный запуск и защита изменений

Дата/время: 2026-09-14, 12:40–13:45 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **PASS** — обязательные условия приёмки выполнены на изолированной тестовой базе.
Не проверено в браузере (UI visual, очистка старых SW-кэшей) и не проверено с реальной моделью — см. ниже.

> **Дополнение 2026-09-14.** Docker-контейнер тестовой базы в среде агента поднимать было не нужно —
> пользователь поднимает контейнеры и прогоняет тесты у себя. Контейнер `tg-info-test-db` остановлен.
> Логи в `evidence/01/` — прогон в среде агента; контрольный прогон выполняет пользователь по
> [TESTING_LOCAL.md](../TESTING_LOCAL.md). Для этого добавлены `backend/test-db/docker-compose.yml`
> и `backend/test-db/init/01-test-target-marker.sql` (метка ставится автоматически).

## Исходная база

- Корень `Odintsov/TG_Info`, HEAD `6431a5b` (`main`), коммитов в этапе нет.
- До начала: untracked только zip пакета, `prompts/`, `docs/development/` (артефакты 00). Пользовательских изменений кода не было.
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_01_LOCAL_SAFETY.md`; зависимость — `docs/development/stages/00_REPORT.md` (PASS).
- Разрешение на этап: сообщение пользователя «продолжаем» (2026-09-14). Выбор тестовой цели сделан по умолчанию — отдельный Docker-контейнер на loopback (чужие контейнеры `quantor-postgres`, `servercontrol-dev-db` не затрагивались).

## Что изменилось для пользователя

- `npm run dev` больше не собирает, не разбирает и не пересчитывает ничего сам: только API на `127.0.0.1`. Задания включаются флагами `INGEST_ENABLED`, `METRICS_AUTO_REFRESH`, `BOT_ENABLED` (строго `true/false/1/0`).
- Портал открывается экраном входа. Токен — `backend/.local/operator-token` (создаётся при первом запуске, в git не попадает) или `OPERATOR_TOKEN` в `backend/.env`. Кнопка выхода в шапке.
- В админке у каждого источника видно «сбор: …, ИИ: …» и причину блокировки; кнопка «Допуск» открывает форму решения (основание и ответственный обязательны, изменения пишутся в журнал). Новые источники добавляются на паузе и без сетевых запросов.
- Слияние компаний, удаление источника с документами, переразбор и массовые правки канона выключены и объясняют причину (UI 423, CLI exit 1).
- Светофор помечен `legacy`: «Сигналов не найдено» вместо «Без замечаний», пояснение «не оценка надёжности».
- Service worker не кэширует API и шрифты; внешних шрифтов нет; старые кэши удаляются при старте и выходе.

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/010_source_policy.sql` (новый) | enum `source_permission`, поля допуска в `sources`, CHECK основания, журнал `source_policy_log` | только расширение; все источники → `unknown` (сбор/ИИ заблокированы до решения). На рабочую БД **не применялась** |
| `backend/src/config/parse.ts` (новый), `config/env.ts` | строгие bool/int, `HOST` только loopback, флаги заданий, `OPERATOR_TOKEN`, сессия; `parseEnv()` для тестов; `SCHEMA_VERSION` из env убран (B-18) | неверное значение флага или `DATABASE_SSL=yes` теперь ошибка запуска |
| `backend/src/jobs.ts` (новый), `index.ts` | решение о фоновых заданиях; `listen(PORT, HOST)`; вывод источника токена без значения | по умолчанию ничего не стартует; `PIPELINE_ENABLED=true` воркер не запускает |
| `backend/src/api/auth.ts`, `operatorToken.ts` (новые), `app.ts` | сессии, CSRF, Host/Origin/Sec-Fetch-Site, `no-store`, маскирование ошибок разбора JSON | весь `/api` кроме health/auth требует входа |
| `backend/src/net/addressPolicy.ts`, `net/safeFetch.ts` (новые) | единый клиент источников: allowlist, IP-проверка в lookup, редиректы, лимиты | `website.ts`, `telegramWeb.ts`, `telegramBot.ts` переведены на него |
| `backend/src/ingest/policy.ts` (новый), `sources.ts`, `scheduler.ts`, `cli.ts`, `telegramBot.ts`, `api/manual.routes.ts`, `pipeline/worker.ts` (`claimBatch`), `pipeline/compare.ts` | один gate на всех входах; источники заводятся `paused`; `--add-site` и API без сети; удаление с документами выключено; `updateSourcePolicy` с журналом | CLI `--probe`/`--source` требуют зарегистрированный источник с допуском |
| `backend/src/api/admin.routes.ts` | поля и причины допуска, `PATCH /sources/:id/policy`, merge → 423, delete withDocuments → 423, website без сети | UI обновлён |
| `backend/src/pipeline/guard.ts` (новый), `apply.ts`, `worker.ts`, `quality.ts`, `recheck.ts`, `cli-commands.ts`, `cli-quality.ts`, `cli.ts`, `resolve/merge.ts` | блокировка изменения канона константой: проход воркера, apply/clear, reextract, retry, retry-skipped, renormalize/recheck без `--dry`, merge | чтение и `--dry` работают; снятие — только кодом 03B/04 |
| `backend/src/db/migrate.ts` | dry-run через `to_regclass` без DDL; `DESTRUCTIVE_MIGRATIONS` (009) требует `--allow-destructive`; экспорт `planMigrations` | история 001–009 не изменена |
| `backend/src/db/testTarget.ts` (новый), `__tests__/setup.ts`, `__tests__/integration/*`, `vitest.config.ts`, `vitest.integration.config.ts` (новый), `package.json` | unit без наследования env (`=`, `DOTENV_CONFIG_PATH`, TZ=UTC); интеграционный профиль с guard; scripts `test:integration`, `typecheck` | `npm test` больше не видит `backend/.env` |
| `backend/src/resolve/normalize.ts`, `company.ts` (R01) | `taxIdKind/compareTaxIds`: ИНН≠ОГРН не конфликт; быстрые пути alias/key — только один совместимый кандидат, иначе без автослияния и в очередь | больше пар в очереди при одноимённых компаниях |
| `backend/src/resolve/project.ts` (R02) | alias/key — только единственный кандидат с известным и равным городом | при неизвестном городе объекты создаются отдельно (дубль вместо склейки) — осознанно, пересмотр в 04 |
| `backend/src/pipeline/verify.ts` (R04) | ИНН, сумма, город, адрес — из собственной подтверждённой цитаты; сторона события обязана быть в цитате, контрагент иначе обнуляется | меньше принятых реквизитов и сумм |
| `backend/src/pipeline/worker.ts`, `llm/client.ts` (R05, R06, B-15) | `planChunks` с покрытием; неполный текст/упавший чанк/повтор на укороченном тексте → `failed incomplete`, без apply; `recordExtraction` заменяет строку-ошибку, при другом успешном payload — `ExtractionPayloadMismatchError`; статус не зависает | вступит в силу, когда запись канона разблокируют (03B) |
| `backend/src/api/companies.routes.ts` (R18), `contractors.routes.ts` (R19), `metrics/cli.ts` (R20) | алиасы и ИНН в отборе поиска; строгий bool `includeGrey`; рабочий `metrics:refresh` | — |
| `backend/src/ingest/scheduler.ts` (R12), `website.ts` (R14) | честный комментарий о первой странице без backfill; ошибка RSS не предлагает нереализованный `listSelector` | — |
| `backend/package-lock.json` | одна битая запись `node_modules/rolldown/node_modules/@rolldown/binding-openharmony-arm64` (без `version`, из-за неё `npm ci` падал `Invalid Version`) заменена полной записью `node_modules/@rolldown/binding-openharmony-arm64@1.2.8` с integrity из реестра | +17/−4 строк; пакет optional под OpenHarmony, на Windows не ставится; `npm install --package-lock-only` падал той же ошибкой, массового обновления нет |
| `frontend/src/api/client.ts`, `hooks/useSession.ts`, `pages/LoginPage.*`, `App.tsx`, `components/Layout.tsx`, `lib/cachePurge.ts`, `main.tsx` (новые/изменённые) | вход, CSRF в памяти, 401 → экран входа, выход с очисткой кэшей | — |
| `frontend/src/pages/AdminPage.*`, `components/SourcePolicyEditor.*` (новый), `api/types.ts`, `lib/labels.ts` | колонка и форма допуска, выключенное слияние, удаление без документов | AdminPage 348 строк |
| `frontend/src/components/RiskBadge.*`, `pages/CompanyPage.tsx`, `ContractorsPage.tsx`, `SearchPage.tsx` | legacy-метка и формулировки | — |
| `frontend/vite.config.ts`, `index.html`, `public/manifest.json`, `src/index.css` | без runtimeCaching `/api` и шрифтов, `navigateFallbackDenylist`, `cleanupOutdatedCaches`; dev/preview на 127.0.0.1 с `strictPort`; без Google Fonts; описание без «Казахстана» | — |
| `CLAUDE.md`, `README.md`, `docs/USAGE.md`, `backend/.env.example`, `.gitignore` | точечные правки I-01…I-07 (см. ниже), новые флаги и порядок работы, `.local/` в игноре | полезные правила сохранены |
| `docs/development/ADR-001-local-operator-and-source-policy.md` (новый) | решения этапа | — |

### Правки инструкций (I-01…I-07)

| ID | Было | Стало |
|---|---|---|
| I-01, I-02 | «Вклад документа = последнее извлечение… переразбирать всё (`--reextract` без `--source`)» | переразбор любого объёма заблокирован до 03B с объяснением причины; качество промпта — через `--shadow/--compare` |
| I-03 | «`--probe` запускать первым на новой машине» | живой probe — только после допуска; старые команды не запускать автоматически |
| I-04 | «После любой правки нормализатора — `--renormalize`» | смотреть `--renormalize --dry`; запись заблокирована до версионного backfill (04) |
| I-05 | светофор как основа оценки | legacy-индекс, не оценка надёжности; `grey` сохранён |
| I-06 | корневой CLAUDE.md: «NetworkFirst для /api/» | в `TG_Info/CLAUDE.md` явное переопределение; корневой файл не трогался |
| I-07 | `npm run dev` = API + ингест + пайплайн + бот | запуск только API, задания флагами |

I-08 (`GREATEST` confidence), I-09 (удаление с документами — теперь выключено), I-10 (атрибуция коммитов) — не менялись, см. BACKLOG.

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Воспроизводимая установка | `npm ci` ×2 | — | 0/0 | PASS | evidence/01/npm-ci-*.log; lock backend: 1 запись |
| Typecheck backend/frontend | `tsc --noEmit` ×2 | — | 0/0 | PASS | backend-typecheck.log, frontend-typecheck.log |
| Сборка backend/frontend | `npm run build` ×2 | — | 0/0 | PASS | backend-build.log, frontend-build.log |
| Unit | `vitest run` | мёртвый URL | 0 | PASS 267/267 (было 148) | unit-tests.log |
| Integration PostgreSQL | `vitest -c vitest.integration.config.ts` | 127.0.0.1:55433/tg_info_test | 0 | PASS 34/34 | integration-tests.log |
| TC-001 старт без заданий | `jobs.test.ts`; smoke `tsx src/index.ts` с одобренным активным источником и документом в очереди | test | 0 | PASS: source_runs 0→0, документ `queued`/0 попыток, extractions 0→0 | startup-smoke*.log |
| TC-002 тесты не видят рабочий URL | `DATABASE_URL=<удалённый> vitest run`; guard без цели / совпадение / удалённый / без маркера | unit/test | 0; 1×4 | PASS | unit-tests-with-external-database-url.log, guard-*.log |
| TC-003 dry-run без DDL/DML | `migrate.int.test.ts`; CLI на пустой схеме | test | 0 | PASS: 0 объектов до/после; отказ destructive без записи | integration-tests.log, migrate-cli.log |
| TC-004 изменение без авторизации | `auth.test.ts` (9 маршрутов → 401); `policy.int` PATCH без сессии, источник не изменён; прокси-smoke | unit/test | 0 | PASS | integration-tests.log, ui-proxy-smoke.log |
| TC-005 Origin/Host/CSRF | `auth.test.ts`: чужой Origin, Sec-Fetch-Site cross-site, без/неверный CSRF, чужой Host, login CSRF | unit | 0 | PASS | unit-tests.log |
| TC-006 SSRF | `safeFetch.test.ts`: 27 адресов, литерал, DNS во внутреннюю сеть, смешанный DNS, редирект на metadata/чужой хост, цикл, oversize, gzip-бомба, реальный loopback-сервер недоступен | unit | 0 | PASS | unit-tests.log |
| TC-007 LM Studio на loopback | `env.test.ts` (loopback принят как доверенный адрес) + `safeFetch.test.ts` (тот же адрес запрещён политикой источников) | unit | 0 | PASS (логика); **реальная модель NOT_RUN** | unit-tests.log |
| TC-008 единый gate | `policy.test.ts`; `policy.int.test.ts`: шедулер/`ingestTelegramSource` (unknown, revoked, expired), бот (без обращения к сети), ручная вставка API (403 → 201 после решения → 403 после отзыва), `claimBatch`, теневой прогон; CLI `--source/--probe/--probe-site` процессами | unit/test | 0; CLI 1 | PASS; переразбор закрыт guard'ом канона целиком | integration-tests.log, cli-gates.log |
| TC-009 PWA-кэш | сборка: в `sw.js` нет NetworkFirst и шрифтов, denylist `/api`; `Cache-Control: no-store`; очистка `caches.delete` при старте и выходе | build | 0 | PASS (сборка/заголовки); **браузер NOT_RUN** | sw-check.txt, ui-proxy-smoke.log |
| TC-010 строгие флаги | `env.test.ts` | unit | 0 | PASS | unit-tests.log |
| Loopback API/Vite/preview | лог `слушает http://127.0.0.1`; LAN-адреса: подключение не установлено (TIMEOUT, firewall мешает отличить от refused); Vite `host`, `strictPort` | test | 0 | PASS по bind-логу; сетевая проверка неоднозначна | startup-smoke.log |
| Пустой allowlist бота | существующая логика `parseAllowedUserIds` не менялась; бот теперь ещё и за допуском | — | — | PASS (без изменений; доп. gate проверен) | integration-tests.log |
| Адресные R01, R02, R04, R05, R06/B-15, R18, R19, R20, R12, R14 | unit + integration | — | 0 | PASS | см. PATCH_COVERAGE |

Core gates: PASS. Live-source: NOT_RUN (ни одного допуска). Реальная модель: NOT_RUN. UI visual: NOT_RUN (нет браузера в среде; HTTP-сценарий через Vite-прокси — PASS).

## Данные, безопасность и откат

- Рабочая БД: **не подключалась и не изменялась**. Её расположение по-прежнему не установлено (`DATABASE_URL` нигде не задан).
- Миграции применены: только к `tg_info_test` в контейнере `tg-info-test-db` (многократно, со сбросом схемы). 010 на рабочей базе не применялась.
- Backfill: нет. Backup/restore: не требовались (рабочие данные не трогались).
- Созданы вне репозитория: Docker-контейнер `tg-info-test-db` (label `project=tg-info`, `purpose=test-only`), порт только `127.0.0.1:55433`. Удаление: `docker rm -f tg-info-test-db`.
- Создан `backend/.local/operator-token` (smoke-запуск без `OPERATOR_TOKEN`), игнорируется git; значение нигде не выводилось.
- Feature flags по умолчанию: `INGEST_ENABLED=false`, `PIPELINE_ENABLED=false` (и заблокирован кодом), `METRICS_AUTO_REFRESH=false`, `BOT_ENABLED=false`, `HOST=127.0.0.1`.
- `.env` не читался и не менялся. Секреты в отчёт и логи не попали (скан: только синтетические значения тестов).
- Безопасный откат: `git checkout -- .` для изменённых файлов и удаление новых (список в «Изменения»); `docker rm -f tg-info-test-db`; `backend/.local/` можно удалить. Флаги выключены — безопасный fallback. Старый удаляющий pipeline не возвращать.

## Непроверенное, дефекты, решения

- **Чтобы открыть портал на рабочей базе, нужны действия пользователя**: определить рабочую базу; сделать backup; решить по миграции 010 (и по 009, если она там не применена) — отдельное согласование. Без 010 выборки источников упадут с ошибкой «column does not exist».
- Все источники после 010 будут заблокированы до решения оператора — это ожидаемо, но сбор остановится до ручного подтверждения.
- R02: при неизвестном городе объекты теперь не склеиваются быстрым путём → больше дублей и пар в очереди (слияние выключено до 04). Осознанный размен «дубль дешевле склейки».
- R03 (цитата связи), R07–R09, R13, R15–R17 — не реализованы; закрыты блокировками/маркировкой до своих этапов.
- B-12 (роли без evidence после удаления) — предотвращено запретом удаления с документами; B-13, B-14, B-16, B-17 — остаются (05A/05B/02/04).
- Сессии в памяти: рестарт API требует повторного входа.
- LAN-проверка bind дала TIMEOUT (вероятно, firewall), а не ECONNREFUSED — фактический bind подтверждается логом и кодом, но не сетевым отказом.
- UI visual и очистка старого SW-кэша в браузере не проверены — выполнить вручную: открыть `http://127.0.0.1:5173`, войти, админка → «Допуск», выйти; DevTools → Application → Cache Storage без `api`.
- Независимое review не выполнялось.

## Завершение

Фактический diff: 57 изменённых файлов (+1993/−748) и новые файлы из таблицы «Изменения»; commit/push не выполнялись.
Независимое review: не выполнялось (`prompts/Customer_Dossier_Prompts/service/REVIEW_STAGE.md`).
Следующий разрешаемый промт: **`prompts/Customer_Dossier_Prompts/stages/STAGE_02_DOCUMENT_REVISIONS.md`** — сам не запускался.
Обновлены: `docs/development/STATE.md`, `docs/development/HANDOFF.md`, `PATCH_COVERAGE.md`, `BACKLOG.md`.
