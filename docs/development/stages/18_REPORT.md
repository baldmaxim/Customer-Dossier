# Отчёт этапа 18 — Регрессия интерфейса и измеряемая скорость

Дата: 2026-09-17. Ветка `main`, основа `12c0fbd`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_18_UI_AND_PERFORMANCE.md`.

## Статусы
IMPLEMENTED: инструменты — да (компонентные тесты, E2E-сценарии, профиль SQL, большой набор); оптимизации — **нет** (нет пользовательских планов)
CODE_CHECKED: frontend `npm test` — 14 PASS (3 файла, vitest 4.1.11 + jsdom 26, Node v24.14.1); frontend `npm run build` PASS; backend typecheck PASS; unit `src/release` — 55 PASS (5 файлов)
REVIEWED: NOT_RUN
USER_VALIDATED: Playwright, печать/PDF, 390 px, Cache Storage, большой набор, EXPLAIN, замер — NOT_RUN (`evidence/18/USER_RUN.md`)

## Что было на ветке (F03, F10, F19)
- Во фронтенде не было ни одного теста и тестового стека; браузерной регрессии не было; печать и 390 px — NOT_RUN с этапа 09.
- `release:bench` (этап 10) — только медиана/мин/макс, без профиля запросов и без выбора обращения; базовый набор маленький.
- Синтетики сверх лимитов выборок (1000 фактов, 2000 рёбер) не было — покрытие этапа 13 не проверялось на объёме.

## Зависимости (обоснование изменения lock-файла)
`frontend` devDependencies: `vitest@^4.1.11` (та же версия, что в backend), `jsdom@^26`, `@testing-library/react@^16`,
`@testing-library/dom@^10` — компонентные тесты без браузера; `@playwright/test@^1.63` — E2E (браузер ставит пользователь,
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`). Установка ничего не запускает и источников не касается. `npm audit`: 1 high в `sharp`
(генератор иконок, было до этапа) — не исправлялось (`--force` ломает мажорную версию), вынесено в риски.

## Карта покрытия интерфейса
| Сценарий | Компонентный тест (jsdom, синтетический API) | E2E (Playwright, пользователь) | Ручное |
|---|---|---|---|
| Ошибка сети / 500 / пустой список различимы | `RunsPage.test` (3) | T18-01 запуски | — |
| Постраничность очереди, «всего» по фильтру | `workbench.test` AmbiguityList | T18-01 очередь | — |
| Запрет выбора по ИНН, конфликт версии решения | `workbench.test` AmbiguityDetail (2) | — | — |
| Устаревший предпросмотр, неполный запуск, отозванный допуск | `workbench.test` PublishPreviewPanel (2) | — | — |
| Краткое досье: статусы словами, недоверенная строка не исполняется, снимок без запросов к базе | `dossierViews.test` NegotiationBrief (2) | T18-04 | — |
| Состояние источника «не запускался», полнота истории неизвестна | `dossierViews.test` SourceHealthCell | — | — |
| Схема: обрезка, легенда, стрелка | `dossierViews.test` GraphPanel | — | — |
| Выход очищает кэш запросов и чувствительные кэши | `dossierViews.test` useSession | T18-02 (после выхода досье нет, Cache Storage без `/api`) | B4 |
| CSRF и чужой Origin | backend `auth.test` | T18-03 | — |
| HTML-выгрузка без скриптов, печатная раскладка без переполнения | backend `snapshot.test`, `brief.test` | T18-04 (+ PDF-артефакт) | B2, B3 |
| 390 px без горизонтальной прокрутки | — | T18-05, проект `phone-390` | B3 |
| Поиск омонимов, форма обращения | — (не автоматизировано) | — | открыто |
| Canary в бандле | `check:build` + `TG_INFO_SECRET_MARKERS` | — | A2 |

Компонентный PASS не заменяет браузер: печать в PDF и 390 px остаются NOT_RUN до B1–B3.

## Замер и профиль
- `release:bench` (local-bench@2): добавлены `p95` — только при 20+ успешных выборках шага (иначе `null`), `--case-id` (обращение
  большого набора), `--profile-queries` (`release/queryProfile.ts`, query-profile@1): на выборку — число запросов и время SQL, топ-5
  запросов по времени, признак N+1 (один запрос > 20 раз на выборку). Тексты запросов нормализуются без литералов — значения не пишутся.
  Запросы идут через настоящий `createApp`, вход и CSRF (как в этапе 10); ошибки в статистику времени не входят.
- `npm run seed:test-large` (`__tests__/integration/seedLargeDemo.ts`): preflight тестовой цели, детерминированные имена, жёсткие
  пределы (≤ 5000 утверждений и рёбер), по умолчанию 1200 утверждений участия у одной компании, 2100 договоров с партнёрами,
  вторые редакции и 50 решений, обращение для замера. Повтор не дублирует.

### Невалидные сравнения (не делать)
- Базовый набор этапа 09/10 и большой набор — разные объёмы: не «до/после».
- Замер на машине агента: не выполнялся (правило); чужая машина или другая конкурентная нагрузка — несопоставимо.
- p95 при < 20 выборках не публикуется; медиана 5 выборок — не SLA.

## Оптимизации
Индексы, кэш и изменения запросов **не вносились**: пользовательских планов (EXPLAIN) и профиля на большом наборе нет. Адресные
изменения — после C3/C4 с регрессией «содержимое досье и hash снимка на одном входе не меняются». Кэш live-досье не вводился.

## Изменения
| Файл | Что |
|---|---|
| `frontend/package.json`, `package-lock.json` | devDependencies выше; скрипты `test`, `e2e` |
| `frontend/vitest.config.ts`, `src/test/{setup.ts,render.tsx}` (новые) | jsdom, подменённый fetch, провайдеры |
| `frontend/src/pages/RunsPage.test.tsx`, `src/components/{workbench,dossierViews}.test.tsx` (новые) | 14 тестов |
| `frontend/playwright.config.ts`, `e2e/dailyRoute.spec.ts` (новые) | 6 сценариев × 2 размера окна; отказ без `E2E_TEST_TARGET_CONFIRMED=tg_info_test` |
| `backend/src/release/queryProfile.ts` + `.test.ts` (новые), `bench.ts`, `benchCli.ts` | профиль SQL, p95, `--case-id` |
| `backend/src/__tests__/integration/seedLargeDemo.ts` (новый), `package.json` | `seed:test-large` |
| `.gitignore` | `frontend/e2e-report/`, `frontend/e2e-results/` |
Миграций нет. Контракт отчёта замера расширен полями `p95`, `queries` (добавление; `local-bench@2` сохранён).

## Проверки
| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T18-01 | компонентные тесты состояний и постраничности; E2E очередь/запуски | AGENT / USER | component PASS; E2E NOT_RUN |
| T18-02 | `dossierViews.test` useSession; E2E T18-02 | AGENT / USER | component PASS; E2E NOT_RUN |
| T18-03 | `dossierViews.test` недоверенная строка; `check:build` canary; E2E T18-03/04 | AGENT / USER | component PASS; A2, E2E NOT_RUN |
| T18-04 | покрытие выборок на большом наборе (`seed:test-large` + досье/схема) | USER | NOT_RUN |
| T18-05 | E2E `phone-390`, ручная печать | USER | NOT_RUN |
| T18-06 | `queryProfile.test`; `release:bench` с профилем | AGENT / USER | unit PASS; замер NOT_RUN |
| T18-07 | оптимизации не вносились — неизменность досье/hash тривиальна | — | NOT_APPLICABLE до изменений |
| T18-08 | бюджеты времени не заявлены | — | NOT_RUN (нет замера) |

## Открытые риски
- Поиск омонимов и форма обращения без автоматических тестов.
- `sharp` high (dev-зависимость генератора иконок).
- Профилировщик оборачивает `query` пула в процессе замера; вне `--profile-queries` не устанавливается.

## Следующий шаг пользователя
`docs/development/evidence/18/USER_RUN.md` A → B → C; по результатам C4 — отдельное адресное изменение.
