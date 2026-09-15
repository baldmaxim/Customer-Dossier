# Прогон пользователя — этап 05A

## Прогон 1 — 2026-09-15, `dossier-stages @ 6b6d173`

| Шаг | Результат |
|---|---|
| A2 `git pull`, `npm ci` | ок (снят зависший esbuild) |
| A3 unit | ок — 24 / 352; первый прогон 351 / 352 из-за `MERGE_APPLY_ENABLED=true` в сессии, после сброса — зелёный |
| A3 frontend build | ок |
| A4 тестовая база | ок |
| A5 `npm run test:integration` | ок — 12 файлов / 135 |
| H1 seed | ок — ok / parser_degraded / rate_limited; ok: найдено 3, сохранено 3 |
| H2 SQL | ок — health; runs exhausted / parser_degraded / rate_limited + retry; редакции n1 full, n2 unknown + no_year, карточка объекта full; cursor caughtUp: true |
| H3 неверный профиль | ок — «профиль источника некорректен», `onFetch` в config не записан |
| H3 `--probe-site` | ок — network; source_runs 3 → 3; health/status degraded не изменились |
| H4 API/UI | ок по API — health и подписи; «Проба» → network / ничего не сохранено; таблица скроллится внутри (min-width 740 на 390 px) |
| 390 px глазами | NOT_RUN |
| Живые сайты | NOT_RUN — approved-сайтов нет |

Замечание прогона: unit-тест защиты слияния зависел от флага в оболочке. Исправлено после прогона: `__tests__/setup.ts`
и `__tests__/integration/setup.ts` фиксируют `MERGE_APPLY_ENABLED=false`, `REPROCESS_AUTO_PUBLISH=false`,
`REVISION_WRITE_ENABLED=true` (проверено: unit 24 / 352 при `MERGE_APPLY_ENABLED=true` в окружении).

Этап 05A — PASS.
