# Этап 03A — прогон пользователя

Дата: 2026-09-14. Машина пользователя, ветка `dossier-stages` @ `9ad0bcb`. Инструкция: `docs/development/TESTING_LOCAL.md`.
Результаты переданы пользователем текстом.

| Шаг | Результат |
|---|---|
| A2 `git pull` | ок → `9ad0bcb` |
| A2 `npm ci` frontend | ок |
| A2 `npm ci` backend | сначала `EPERM` — зависший `esbuild.exe` от прежнего `npm run dev`; после завершения процесса — ок |
| A3 typecheck | ок |
| A3 `npm test` | ок — 21 файл / 311 passed |
| A3 frontend tsc + build | ок |
| A4 `docker compose … up -d --wait` | ок, без настройки File Sharing |
| A4 метка БД | ок — `tg_info:test-target` |
| A5 `npm run test:integration` | сначала отказ guard: в окружении остался `DATABASE_URL`, равный тестовой цели («совпадает с DATABASE_URL») — ожидаемое поведение; без переменной — ок |
| A5 итог | **9 файлов / 82 passed**, цель `127.0.0.1:55433/tg_info_test` |
| E1 dry-run | ок — participant/mention `assertionsCreated: 1`, event `manualStatusesMigrated: 1` |
| E1 `count(*)` после dry-run | ок — 0 |
| E1 `--apply` | ок — те же числа |
| E1 `review_decisions` | ок — `reviewed_supported` / `legacy_unknown` / `t` |
| E1 `--apply --from-start` | ок — created 0, `event.manualStatusesExisting: 1` |
| E1 `UPDATE evidence SET quote` | ок — «evidence: содержание доказательства неизменяемо» |
| E2 `seed:test-assertions` | ок — утверждение 10 |
| E2 список «Есть в тексте» | ок — «Демо-Гамма … Демо-Квартал (корпус 3)», за 2 · против 1 |
| E2 доказательства | ок — 2 supports + 1 contradicts, цитаты с контекстом, ссылки «версии» |
| E2 «Подтвердить» | ок — `reviewed_supported`, история operator / версия |
| E2 две вкладки | ок — A → disputed 201; B со старой версией → 409 `version_conflict`, решение A на месте |
| E2 отзыв доказательства | ок — withdrawn с причиной, `needsRevalidation`, фильтр «Нужен пересмотр», история сохранена |
| E2 390 px | по CSS ок (одна колонка до 768 px); живой viewport глазами не смотрел — **visual NOT_RUN** |
