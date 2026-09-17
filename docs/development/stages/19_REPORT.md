# Отчёт этапа 19 — Ограниченный пилот и локальная эксплуатация

Дата: 2026-09-17. Ветка `main`, основа `f355f8d`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_19_CONTROLLED_PILOT.md`.

## Статусы
IMPLEMENTED: подготовка — да (манифест, проверка перед стартом, маршрут проверки человеком, остановки, копии, хранение, обновление)
PILOT: **PILOT_NOT_RUN** — нет утверждённого манифеста, названных источников и оснований; агент источники не подбирал
CODE_CHECKED: backend typecheck PASS; **полный unit backend — 46 файлов / 613 PASS** (`npx vitest run --maxWorkers=1 --no-file-parallelism`, Node v24.14.1, итоговый код пакета); frontend `npm test` — 3 / 14 PASS (этап 18); `release/pilotManifest.test.ts` — 7 PASS
REVIEWED: NOT_RUN
USER_VALIDATED: NOT_RUN (`evidence/19/USER_RUN.md`)
Решение: **PENDING → PILOT_NOT_RUN** (`pilot/PILOT_DECISION.md`). PRODUCTION_READY не заявляется. LIVE_SOURCE_VALIDATED — пусто.
LOCAL_MODEL_VALIDATED — нет.

## Готовность по компонентам
`docs/development/pilot/LIMITED_READINESS.md`: ядро на синтетике — PASS 09, этапы 10–18 на базе NOT_RUN; модель — не валидирована
(последний замер до этапов 11/14A без отпечатка исполнения); источники — пусто; маршрут оператора — код есть, браузер NOT_RUN;
копия/восстановление — PASS 09 closure, после миграций 021–023 NOT_RUN. Исторический PASS 09 не закрывает F04–F20.

## Изменения
| Файл | Что |
|---|---|
| `backend/src/release/pilotManifest.ts` (новый) | `pilot-manifest@1` (строгая схема; запреты и обязательная проверка — литералы), `pilot-gate@1` (блоки и предупреждения, разрешённые шаги сбора и ИИ) |
| `backend/src/release/pilotCli.ts` (новый), `package.json` | `npm run pilot:check -- --manifest <файл>`: только чтение (имя базы, допуск источников, неприменённые миграции), exit 1 при BLOCKED |
| `backend/src/release/pilotManifest.test.ts` (новый, 7) | T19-01/03/05 |
| `docs/development/pilot/pilot-manifest.template.json` (новый) | черновик без источников — по нему пилот не стартует (проверяется тестом) |
| `docs/development/pilot/LIMITED_READINESS.md`, `PILOT_DECISION.md`, `OPERATIONS.md` (новые) | готовность, решение PILOT_NOT_RUN, маршрут проверки человеком, условия остановки, копия и учения, хранение, обновление и откат |
| `docs/development/evidence/19/USER_RUN.md` (новый) | последовательность пилота и таблица фактических результатов |
| `backend/src/resolve/ambiguities.ts` | дефект этапа 15A, найденный полным unit-прогоном: `sql-sanity` не видел плейсхолдеры условия, вынесенного в интерполяцию — условие записано в тексте обоих запросов (поведение не изменилось) |
| `BACKLOG.md`, `RELEASE_READINESS.md`, `STATE.md`, `HANDOFF.md`, `CLAUDE.md` | итоги пакета 10–19 |
Миграций нет.

## Проверка перед стартом (`pilot-gate@1`)
Блокирует: неутверждённый манифест; пустой перечень источников; источник не зарегистрирован или без действующего допуска на сбор
(основание в манифесте допуск не выдаёт); ИИ заявлен без ИИ-допуска; другая база, чем в манифесте; неприменённые миграции
(для рабочей базы — «нужно отдельное разрешение, пилот им не является»); `INGEST/PIPELINE/BOT/METRICS_AUTO_REFRESH`,
`REPROCESS_AUTO_PUBLISH`, `MERGE_APPLY_ENABLED` = true; не-loopback; конфигурация модели «rejected» при ИИ-шагах; манифест,
пытающийся разрешить автопубликацию, слияние, пропуск ручной проверки или превысить лимиты (≤ 200 на источник, ≤ 1000 всего).
Предупреждает: модель не выбрана по оценке (кандидаты только через ручную проверку), нет отпечатка исполнения, пилот на рабочей
базе (копия и учения), срок хранения сырых попыток не задан.

## Проверки
| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T19-01 | `pilotManifest.test` «черновик, пустой перечень…», «шаблон манифеста… не стартует» | AGENT | PASS |
| T19-02 | replay досье до цитат и scope; limits и атрибуция в снимке — `brief.test` (этап 17), `snapshot.int` | AGENT / USER | unit PASS; на базе и в пилоте NOT_RUN |
| T19-03 | `pilotManifest.test` «запреты — литералы», «отклонённая … конфигурация» | AGENT | PASS |
| T19-04 | испорченный manifest/цель — `release:manifest` INCOMPATIBLE/MISMATCH exit 1 (09), preflight | AGENT (09) / USER | unit PASS; учения NOT_RUN |
| T19-05 | `pilotManifest.test` «фоновые задачи, автопубликация…» | AGENT | PASS |
| T19-06 | отзыв допуска прекращает вызовы — `reprocess.int` T11-03/05, `telegram.int` отзыв во время прохода | USER (DB) | NOT_RUN на итоговом коде |
| T19-07 | итог перечисляет подтверждённое и непроверенное — этот отчёт, `LIMITED_READINESS.md` | AGENT | PASS (документ) |
| T19-08 | пилот на реальных данных | USER | PILOT_NOT_RUN |

## Остановка и откат
Функция — только проверка и документы: `pilot:check` ничего не пишет. Отказаться — не запускать. Расписаний, фоновых копий и очистки
не добавлялось.

## Следующее действие пользователя
1. Прогоны `evidence/10…18/USER_RUN.md` на итоговом коде (минимум unit обоих пакетов и `npm run test:integration`).
2. Решение по модели: `evidence/14A`, `14B` → `quality/QUALITY_DECISION.md`.
3. Список источников с основаниями → `evidence/16/USER_RUN.md` шаги 4–7.
4. Манифест пилота → `npm run pilot:check` → `evidence/19/USER_RUN.md`.
Пакет 10–19 завершён; дальше — только по отдельной задаче.
