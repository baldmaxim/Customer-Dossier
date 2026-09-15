# Прогон пользователя — этап 07

## Прогон 1 — 2026-09-15, `dossier-stages @ 2f67e51`

| Шаг | Результат |
|---|---|
| A2 `git pull`, `npm ci` | ок (сначала EPERM на esbuild — остановлены прежние `npm run dev`) |
| A3 unit | ок — 27 / 398 |
| A3 frontend build | ок |
| A4 тестовая база | ок — `tg_info:test-target` |
| A5 `npm run test:integration` | ок — 15 файлов / 163 (в т.ч. `signals/signals.int.test.ts`) |
| J1 seed | ок — договоры, очередь, дело, construction с 2026-07-01 |
| K1 `metrics:refresh` | ок — `[signals] снимок #1: компаний 4` |
| K2 SQL | ок — Зенит: name_only, 1 объект, `{general_contractor}`, без даты 3, публикаций 6; Вектор plaintiff 1, Зенит defendant 1 |
| K3 сбой пересчёта | ок — #2 failed, снимок #1 на месте; после снятия `k3_fail` — #3 succeeded |
| K4 карточка Демо-Зенит (API) | ок — без `risk`; signals@1; name_only, публикаций 6; объектов 1, генподрядчик; 2 договора (performer/client); без даты 3, defendant 1; при сбое stale=true с причиной, после #3 stale=false |
| K4 контекст Демо-Причал | ок — construction с 2026-07-01; примечание о причинности; участие без периода |
| K4 подрядчики и главная | ок — Зенит первым; сводка name_only: 4; сортировки projects/name |
| K4 `/legacy-risk` | ок — `"deprecated": true`, в том числе через :5173 |
| 390 px | ок по вёрстке (блоки столбиком, media ≥ 768); просмотр в DevTools на 390 px — NOT_RUN |

Этап 07 — PASS.
