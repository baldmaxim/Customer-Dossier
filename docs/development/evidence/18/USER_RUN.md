# Пользовательский прогон этапа 18
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. Тестовая цель — `127.0.0.1:55433/tg_info_test` с маркером.
Браузер, база и замеры — только пользователь. Замер создаёт снимки: не выполнять его между baseline и дампом (`evidence/09/USER_RUN_CLOSURE.md` раздел E).

## A. Без базы
| Шаг | Команда (cwd) | Изменяет данные? | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|
| A1 | `cd frontend; npm ci; npm test` | нет | 3 файла, 14 passed (RunsPage, workbench, dossierViews) | NOT_RUN | — |
| A2 | `$env:TG_INFO_SECRET_MARKERS='canary-e2e-7f3a,canary-db-91c2'; $env:VITE_FAKE_CANARY='canary-e2e-7f3a'; npm run build; npm run check:build` | `dist/` | `check:build ok`, маркеров в бандле 0 (маркер из VITE_* не используется кодом и в бандл не попадает) | NOT_RUN | — |
| A3 | `cd ..\backend; npx vitest run src/release src/dossier --maxWorkers=2` | нет | passed, в т.ч. `queryProfile.test.ts` | NOT_RUN | — |

## B. Браузерная регрессия (Playwright, тестовый стенд)
Подготовка: база после `npm run test:integration` или `migrate`, затем `npm run seed:test-release` и `npm run seed:test-brief`
(оба пишут только в тестовую цель через preflight). API: `DATABASE_URL` оболочки = тестовая база, фоновые флаги false, `npm run dev`;
фронтенд `npm run dev`. Один раз с сетью: `cd frontend; npx playwright install chromium`.

| Шаг | Команда (cwd `frontend`) | Изменяет данные? | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|
| B1 | `$env:E2E_TEST_TARGET_CONFIRMED='tg_info_test'; $env:E2E_OPERATOR_TOKEN=(Get-Content ..\backend\.local\operator-token -Raw).Trim(); npm run e2e` | да: снимки обращения в тестовой базе (T18-04) | проекты `desktop` и `phone-390`: 6 тестов × 2 passed; отчёт `frontend/e2e-report/` | NOT_RUN | — |
| B2 | Открыть `frontend/e2e-results/*desktop*/snapshot-print.pdf` | нет | человек: страницы не обрезаны, «Кратко для переговоров» первым, основания и ограничения читаются | NOT_RUN (ручная) | — |
| B3 | Вручную в браузере: «Версия для печати» снимка → Печать → PDF; окно 390 px (DevTools) на обращении | нет | то же, что B2; в 390 px блоки не выходят за ширину | NOT_RUN (ручная) | — |
| B4 | DevTools → Application → Cache Storage после выхода | нет | нет записей `/api/…` (дублирует T18-02 вручную) | NOT_RUN (ручная) | — |

Токен в B1 читается из файла в переменную окружения и не печатается; при другом способе хранения токена — подставить так же, без вывода.

## C. Большой набор и замер
| Шаг | Команда (cwd `backend`) | Изменяет данные? | Цель/guard | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|---|
| C1 | `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npm run release:bench -- --runs 20 --profile-queries --out "$env:USERPROFILE\tg-info-18\bench-before.json"` | да: снимки | preflight | `отчёт действителен`; у шагов p95 (20 выборок) и строки `SQL: N запросов` | NOT_RUN | — |
| C2 | `npm run seed:test-large -- --facts 1200 --edges 2100 --revised 50 --reviewed 50` | да: ~3300 утверждений, ~2100 компаний, ~85 публикаций | preflight; повтор не дублирует | `[seed-large] обращение #N: …` | NOT_RUN | — |
| C3 | `npm run release:bench -- --runs 20 --profile-queries --case-id <N из C2> --out "$env:USERPROFILE\tg-info-18\bench-large.json"` | да: снимки | preflight | действителен; досье обращения показывает `selection_truncated_company_facts`, схема — `truncated`; топ SQL и N+1 перечислены | NOT_RUN | — |
| C4 | Для 3 самых дорогих запросов из C3: `docker exec -it tg-info-test-db psql -U tg_test -d tg_info_test` → `EXPLAIN (ANALYZE, BUFFERS) <запрос с подставленными id из набора>` | нет (SELECT) | тестовая база | планы в файл `explain-*.txt` | NOT_RUN | — |

Сравнивать можно только C1 с C1 (тот же объём) или C3 с C3 после оптимизации на **том же** наборе и машине. C1 и C3 — разные наборы, не «до/после».
Что передать: логи A–C с exit code, `bench-*.json`, планы C4, отчёт Playwright (без токенов), решение по B2/B3.
