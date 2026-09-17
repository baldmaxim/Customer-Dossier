# Приёмка 10–19 — карта доказательств

Классы: **C** — подтверждено чтением кода; **W** — тест/шаг написан, NOT_RUN на `d33521b`; **R** — выполнено с логом и отпечатком
(на `d33521b` таких пока нет); **Z** — заявлено агентом без сохранённого журнала; **N/A** — вне ограниченного сценария (с причиной).
Шаги — из `USER_RUN_CONSOLIDATED.md`. Колонка «Результат» заполняется по факту; сейчас — NOT_RUN.
Индекс рисков — `prompts/TG_Info_Acceptance_10-19_2026-09-17/reference/ACCEPTANCE_MATRIX.md` (AC-xx); исходные критерии — T10…T19 в `prompts/TG_Info_Next_Stages_2026-09-16/stages/`.

## По AC
| AC | Этап | Тест / шаг | Класс | Тип | Шаг | Результат |
|---|---|---|---|---|---|---|
| AC-01 | все | `git rev-parse`, `release:fingerprint`, lock blobs | **R** | O | A0 | **PASS** 2026-09-17: HEAD `8a0ed5e` (= `d33521b` + документы), diff только `docs/development/**` и `prompts/**`, lock blobs совпали, отпечаток `dirtyPaths 0`, 354 файла, exit 0 (`A0-git.txt`, `A0-tree.json`) |
| AC-02 | все | эта карта; отчёты 10–19 | C | O | — | подготовлено |
| AC-03 | все | backend `typecheck`, `build`, `test`; frontend `test`, `build`, `check:build` | backend **R**, frontend W | O | A1, A2 | backend **PASS** 2026-09-17: typecheck exit 0, build exit 0, unit 46 файлов / 613 тестов, 0 skipped, exit 0 (`A1-*.log`); frontend — NOT_RUN |
| AC-04 | 10,19 | `db/testTarget.test.ts`, `testTargetBootstrap` + отрицательные контроли closure B1; `release.int` «цель проверяется перед разрушительными действиями» | C, W | O,D | B0 | NOT_RUN |
| AC-05 | все | `db/migrate.int.test.ts`, `release.int` TC-074 «с пустой схемы» (001–023) | W | D | B1 | NOT_RUN |
| AC-06 | 11,13,15A | **автотеста апгрейда 020→023 с данными нет** (`release.int` апгрейдит только с 009); ручной сценарий B2 (сид на `8b1a944`, миграция `d33521b`) | W (ручной) | D | B2 | NOT_RUN |
| AC-07 | 10,15A | `release/manifest.test.ts`, `manifestSpec.ts` содержит `ambiguity_decisions`; UNCLASSIFIED_TABLE на реальной схеме | C, W | O,D | A1, B2, B3 | NOT_RUN |
| AC-08 | 10 | `release/manifest.int.test.ts` (мутации текста/цитаты/решения/payload/policy/sequence → MISMATCH) | W | D | B1 | NOT_RUN |
| AC-09 | 10,19 | restore в новую цель + `release:manifest --compare` MATCH + негативный контроль | W | D | B3 | NOT_RUN |
| AC-10 | 10,19 | API на копии + `release:probe --compare`, контролируемая запись после сравнения | W | D,B | B4 | NOT_RUN |
| AC-11 | 11 | `reprocess/executionIdentity.test.ts`; `reprocess.int` «этап 11» T11-01/02, стейл-конфиг | C, W | O,D | A1, B1 | NOT_RUN |
| AC-12 | 11,16 | `reprocess.int` T11-03/04/05, `telegram.int` «отзыв допуска во время прохода», 15B «допуск отозван между предпросмотром…» | W | D | B1 | NOT_RUN |
| AC-13 | 11,15B | `reprocess.int` T11-08, TC-076 late chunk, 15B «отмена выполняемого», T15B-07 | W | D | B1 | NOT_RUN |
| AC-14 | 12,04 | `identity.int` TC-034, 15A «два ООО с разными ИНН», `resolve/ambiguities.test.ts` | W, unit Z | D | A1, B1 | NOT_RUN |
| AC-15 | 12 | `dossier/scope.test.ts`, `dossier.test.ts` «этап 12» (13), `snapshot.test` схема; сценарии T12-12 | Z, W | O,D | A1, B1, C1 | NOT_RUN |
| AC-16 | 12,15A | `dossier.test` T12-10/11, `brief.test` «отклонённое отрицание», `release.int` merge→review | Z, W | O,D | A1, B1 | NOT_RUN |
| AC-17 | 13 | `snapshot.int` «этап 13» (409 чужой ключ, конкурентный повтор), `snapshot/completeness.test.ts` (hash запроса) | W | D | B1 | NOT_RUN |
| AC-18 | 13 | `snapshot.int` барьер `afterFirstRead` (REPEATABLE READ) | W | D | B1 | NOT_RUN |
| AC-19 | 13,17 | `release.int` «старый снимок цел», `snapshot.int`; `brief.test` «снимок до @3»; B2 проба старого снимка | W | D | B1, B2 | NOT_RUN |
| AC-20 | 13,18 | `snapshot/completeness.test.ts` (coverage@1 фактов и схемы); `seed:test-large` + досье/схема | Z, W | D,P | A1, C2 | NOT_RUN |
| AC-21 | 14A | `reprocess/semantic/evaluation.test.ts` (14: ошибки в знаменателе, plan до модели); `pipeline:once --compare` без `--legacy` — отказ | Z, W | O | A1, D1 | NOT_RUN |
| AC-22 | 14A/B | `benchmark:model --out` на LM Studio, `--replay` | W | M,H | D1 | NOT_RUN |
| AC-23 | 14B | `experiments.test.ts` (8); `--experiment` paired + `--compare`; QUALITY_DECISION владельца | Z, W | M,H | A1, D1 | NOT_RUN |
| AC-24 | 15A | `ambiguities.test.ts` (13), `identity.int` «этап 15A» (6), `workbench.test.tsx` AmbiguityDetail; браузер 15A п.1–4 | Z, W | D,B | A1, A2, B1, C1 | NOT_RUN |
| AC-25 | 15A | `identity.int` T15A-04 stale preview; `entityMerge` idempotency TC-040 | W | D,B | B1, C1 | NOT_RUN |
| AC-26 | 15A | `identity.int` T15A-05/06 (цепочка слияний, одно решение); `release.int` старый снимок | W | D,B | B1, C1 | NOT_RUN |
| AC-27 | 15B | `reprocess.int` «этап 15B» T15B-01/06, `RunsPage.test.tsx`; API не отдаёт raw/payload (проверяется в T15B-01) | W, Z | D,B | A2, B1, C1 | NOT_RUN |
| AC-28 | 15B | `reprocess.int` T15B-02 (решение и допуск после предпросмотра, новая редакция), T15B-07 | W | D,B | B1, C1 | NOT_RUN |
| AC-29 | 16 | `ingest/sourceContract.test.ts` (15), `pilotManifest.test` | Z | O,D | A1 | NOT_RUN |
| AC-30 | 16 | `sites.int` «этап 16» (цикл, префиксы), TC-044/045; `telegram.int` TC-047/049 | W | D | B1 | NOT_RUN |
| AC-31 | 16 | `evidence/16/USER_RUN.md` 4–7 | W | S,H | D2 | NOT_RUN (нет перечня) |
| AC-32 | 17 | `brief.test.ts` (15); `seed:test-brief` + ручной replay цитат | Z, W | D,B,H | A1, C1 | NOT_RUN |
| AC-33 | 17 | `brief.test` перепечатки; `dossierViews.test` легенда/стрелка; браузер | Z, W | D,B,H | A1, A2, C1 | NOT_RUN |
| AC-34 | 18 | `playwright.config.ts` baseURL `127.0.0.1:5173`, Vite-прокси `/api` → API `:4100` (настоящий API, без mock) | C, W | B | C1 | NOT_RUN |
| AC-35 | 18 | `dossierViews.test` logout/недоверенная строка; E2E T18-02/03; `check:build` с canary | Z, W | O,B | A2, C1 | NOT_RUN |
| AC-36 | 18 | E2E `desktop`/`phone-390`, PDF-артефакт + ручная печать | W | B,H | C1 | NOT_RUN |
| AC-37 | 18 | `release/bench.test.ts`, `queryProfile.test.ts`; `release:bench --runs 20` | Z, W | D,P | A1, C2 | NOT_RUN |
| AC-38 | 18 | `seed:test-large`, `--profile-queries`, EXPLAIN вручную | W | D,P | C2 | NOT_RUN |
| AC-39 | 19 | `api/dbDown.test.ts`; closure D1–D2 (перезапуск процесса, остановка БД) | Z, W | D,B | A1, C3 | NOT_RUN |
| AC-40 | 19 | `pilotManifest.test.ts` (7); `pilot:check` на тестовой цели с отрицательными контролями | Z, W | O,D | A1, E1 | NOT_RUN |
| AC-41 | 19 | `pilot/PILOT_DECISION.md` — решения владельца нет | — | H | E2 | PILOT_NOT_RUN |
| AC-42 | 19 | `evidence/19/USER_RUN.md` C–D | — | S,M,D,B,H | E3 | PILOT_NOT_RUN |
| AC-43 | 18 | `SECURITY_TRIAGE.md`; `npm explain sharp`, `npm audit --json` | **R** (sharp), открыто (backend `qs`/`express`) | O,H | A3 | **VERIFIED** 2026-09-17: sharp 0.34.5 dev, прямая, high, два advisory об обработке изображений; в production-аудите 0. Решение владельца: `npm ci` во frontend допустим, `icons:generate` выключен. Новое: backend 2 moderate (`qs`, `express`) — ждёт деталей |
| AC-44 | 15A,19 | `__tests__/sql-sanity.test.ts`: детектор **не менялся**, изменён запрос; отрицательные тесты «детекторы сами по себе» на месте; DB-путь — `identity.int` 15A | C, Z, W | O,D | A1, B1 | NOT_RUN |

## Исходные критерии этапов → AC / шаги
| Этап | Критерии | Покрытие |
|---|---|---|
| 10 | T10-01…09 | T10-04/05/07/08 выполнены в 09 closure на старом коде; на `d33521b` — AC-03/04/08/09/37 (A1, B0, B1, B3, C2) |
| 11 | T11-01…08 | AC-11/12/13 (B1); T11-06/07 (fingerprint/документы) — C |
| 12 | T12-01…12 | AC-15/16 unit и B1; T12-12 — сценарии `evidence/12` в C1 на `seed:test-release` |
| 13 | T13-01…08 | AC-17/18/19/20 (B1, C2) |
| 14A | T14A-01…08 | AC-21 (A1), AC-22 (D1) |
| 14B | T14B-01…07 | AC-23 (A1, D1); T14B-04 second-pass — N/A (зарегистрирован как not_implemented) |
| 15A | T15A-01…07 | AC-24/25/26 (A1, B1, C1) |
| 15B | T15B-01…07 | AC-27/28 (A2, B1, C1) |
| 16 | T16-01…08 | AC-29/30 (A1, B1); AC-31 (D2) |
| 17 | T17-01…08 | AC-32/33 (A1, C1) |
| 18 | T18-01…08 | AC-34…38 (A2, C1, C2); T18-07 — N/A до первой оптимизации |
| 19 | T19-01…08 | AC-39…42 (A1, C3, E) |
| 09 TC-074…078 | — | TC-074 → AC-05/06; TC-075 → AC-08/09; TC-076 → B1 `release.int`; TC-077 → AC-12/13/39; TC-078 → AC-37 |

Повторяющиеся сценарии выполняются один раз: полный `test:integration` (B1) закрывает D-часть AC-05, 08, 11–19, 24–28, 30, 44;
один набор сидов и один restore (B3) используются C1, C2 и E1.
