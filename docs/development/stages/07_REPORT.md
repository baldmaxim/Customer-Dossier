# Отчёт этапа 07 — Объяснимая аналитика и общий фон компании

Дата/время: 2026-09-15 (+02:00). Исполнитель: Claude Code (Opus 5), единственный writer.
Статус: **AWAITING_USER_RUN** — код, unit и сборки PASS в среде агента; интеграция и раздел K TESTING_LOCAL — у пользователя.

## Исходная база

- Ветка `dossier-stages`, 06 закрыт по core-gates коммитом `a82de45`.
- Stage prompt: `prompts/Customer_Dossier_Prompts/stages/STAGE_07_ANALYTICS.md`; зависимость — `06_REPORT.md`.
- Соответствие путей: `docs/migrations/007_metrics.sql` (только чтение), `backend/src/metrics/refresh.ts`, `cli.ts`,
  `api/companies.routes.ts`, `api/contractors.routes.ts`, `frontend/src/components/RiskBadge.tsx`, `lib/labels.ts`,
  `pages/CompanyPage.tsx`, `pages/ContractorsPage.tsx` — на месте. Новое — `backend/src/signals/*`.

## Что изменилось для пользователя

- В карточке компании нет цветного вердикта и индекса. Вместо них три блока: идентификация и полнота данных,
  опыт по объектам, публикации и события. У каждого числа раскрывается правило, окно, знаменатель и исходные id.
- «Пять перепечаток» — пять публикаций, одна семья текста и одно событие; происхождение без первоисточника
  в выборке — «не установлено», не независимое подтверждение.
- Событие без даты не попадает в «последние 12 месяцев»; отдельно видно «без даты, опубликовано за 90 дней».
- Суд показан ролью компании в деле и стадиями; истец не выглядит нарушителем.
- «Контекст объекта»: участие компании и события объекта с пометкой, пересекаются ли периоды и корпус.
- Нет публикаций — «недостаточно данных», а не ноль и не «зелёный».
- Список подрядчиков без индекса и сортировки по нему; главная — распределение по статусу идентификации.
- Видно, на какой срез рассчитаны сигналы и устарели ли они; ошибка пересчёта не стирает прежний снимок.

## Изменения

| Файл/миграция | Суть | Совместимость/риск |
|---|---|---|
| `docs/migrations/018_signals_read_model.sql` (новый) | `signal_refreshes`, `company_signal_snapshots`, `signal_active_refresh_v` | только новые объекты; 007 не менялась |
| `backend/src/signals/types.ts`, `intervals.ts`, `rules.ts` (новые) | правила `signals@1`: окна, пересечения, семьи происхождения, блоки | чистые функции |
| `backend/src/signals/load.ts`, `refresh.ts`, `context.ts` (новые) | загрузка на срез, пересчёт с журналом и stale, контекст объекта | пересчёт — только явно |
| `backend/src/api/companies.routes.ts` | `risk` убран из карточки; `/:id/signals`, `/:id/context`, deprecated `/:id/legacy-risk` | фронтенд прежнего этапа ждал `risk` |
| `backend/src/api/contractors.routes.ts`, `contractors.test.ts` | список и сводка из снимка; `includeGrey` → `includeInsufficient`; сортировка `projects`/`name` | параметр `sort=risk` теперь 400 |
| `backend/src/metrics/cli.ts`, `refresh.ts` | `metrics:refresh [--cutoff]` пересчитывает снимок сигналов и legacy MV; планировщик — оба | по-прежнему только `METRICS_AUTO_REFRESH=true` |
| `frontend/src/components/CompanySignals.*`, `SignalAggregate.tsx`, `ProjectContextPanel.tsx` (новые) | блоки сигналов, drilldown, контекст | — |
| `frontend/src/pages/CompanyPage.tsx`, `ContractorsPage.tsx`, `SearchPage.tsx`, `api/types.ts`, `lib/labels.ts` | без вердикта и светофора; новые подписи | `RiskBadge` удалён |
| тесты: `signals/signals.test.ts` (unit, 12), `signals/signals.int.test.ts` (интеграция, 8) | см. «Тесты» | интеграция — у пользователя |
| `ADR-009-explainable-signals.md` (новый), `CLAUDE.md`, `README.md`, `TESTING_LOCAL.md` (A, K), `PATCH_COVERAGE.md` (R08, R09) | решения и инструкция | — |

## Тесты

| Gate/сценарий | Команда | Target | Exit | Статус | Лог/наблюдение |
|---|---|---|---|---|---|
| Typecheck/build backend и frontend | `tsc --noEmit`, `npm run build` | — | 0/0 | PASS | среда агента |
| Unit | `npm test` | мёртвый URL | 0 | PASS: 27 / 398 (было 26 / 386) | среда агента |
| TC-060 событие без даты не в окне 12 мес; окно публикаций 90 дней отдельно; будущая дата и граница окна | `signals.test.ts` | unit | 0 | PASS | — |
| TC-061 пересечение периодов участия и события; событие объекта не становится событием компании | то же | unit | 0 | PASS | — |
| TC-062 пять перепечаток: публикаций 5, семья 1, событие 1; established / named / unknown | то же | unit | 0 | PASS | — |
| TC-063 ноль публикаций и нулевой знаменатель — insufficient_data | то же | unit | 0 | PASS | — |
| Суды по роли и стадии; отклонённое и спорное видны и не reviewed; план/отрицание — не учтено | то же | unit | 0 | PASS | — |
| Опыт без сумм; статус идентификации | то же | unit | 0 | PASS | — |
| TC-064 детерминизм на срезе и независимость от порядка входа | то же | unit | 0 | PASS | — |
| Снимок на срез через API; карточка без `risk`; deprecated legacy-эндпоинт | `signals.int.test.ts` | tg_info_test | — | AWAITING_USER_RUN | — |
| TC-060/062 на PostgreSQL: пять перепечаток, событие без даты, задержка объекта не у компании | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| Drilldown id публикаций и объектов совпадают с SQL | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| TC-063 компания без публикаций | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| TC-061 контекст объекта через API: no_overlap, другой корпус | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| Список подрядчиков из снимка, `sort=risk` — 400 | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| TC-064 сбой пересчёта сохраняет снимок и помечает stale; повтор на срез — тот же payload | то же | tg_info_test | — | AWAITING_USER_RUN | — |
| Регрессия 01–06 (14 файлов / 155) | `npm run test:integration` | tg_info_test | — | AWAITING_USER_RUN | ожидается 15 файлов / 163 |
| Upgrade схемы и представлений на тестовой копии, CLI, UI 390 px | TESTING_LOCAL K | tg_info_test | — | AWAITING_USER_RUN | — |

## Данные, безопасность и откат

- Рабочая БД не подключалась; миграция 018 к ней не применялась; пересчёт на рабочих данных не запускался;
  источники не включались; LM Studio не вызывался. Docker в среде агента не запускался. `.env` не менялся.
- Флаги: новых нет. `METRICS_AUTO_REFRESH=false` — планировщик пересчёта выключен.
- Откат: прежний фронтенд и API из git; `company_risk` не удалялся. Таблицы 018 можно оставить.

## Непроверенное, остаточные риски

- Сигналы строятся только по утверждениям: если на рабочей базе не выполнен `backfill:assertions`, legacy-роли
  и события в сигналах не учтены (в карточке — явное предупреждение с количеством).
- Статус доказательства, сменившийся после среза, на прошлый срез не восстанавливается.
- Семья публикаций — по одинаковому тексту; перепечатка с правками попадёт в отдельную семью.
- Контекст объекта — живой запрос, не часть снимка: для воспроизводимости у него есть параметр `cutoff`.
- Пересчёт всех компаний одной транзакцией — на больших объёмах может быть долгим.
- Разделы «Объекты» и «События» карточки по-прежнему читают проекции 017 (включая legacy): числа в блоках
  сигналов и эти списки могут расходиться, если legacy-канон не перенесён.

## Завершение

Следующий промт после подтверждения прогона: **`prompts/Customer_Dossier_Prompts/stages/STAGE_08A_DOSSIER_UI.md`**.
