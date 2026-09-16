# Пользовательский прогон этапа 11
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. Реальная модель не нужна: провайдеры детерминированные.

Перед изменяющими шагами — цель `127.0.0.1:55433/tg_info_test` с маркером (`evidence/09/USER_RUN_CLOSURE.md`, B2). Рабочая база не участвует.

| Шаг | Команда (cwd) | Изменяет данные? | Цель/guard | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|---|
| 1 | `cd backend; npm run typecheck; npx vitest run --maxWorkers=2` | нет | мёртвый адрес БД | exit 0, все файлы passed, 0 skipped | NOT_RUN | — |
| 2 | `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npx vitest run -c vitest.integration.config.ts src/reprocess/reprocess.int.test.ts` | да: пересоздаёт схему `tg_info_test`, применяет 001–021 | общий preflight (адрес, роль, маркер) | все тесты файла passed, включая describe «этап 11» (T11-01…T11-05, T11-08) и прежние «два worker'а», «crash до commit итога» | NOT_RUN | — |
| 3 | `npm run test:integration` | да: то же | то же | все файлы passed, 0 skipped (≈ 19 файлов / 217 тестов) | NOT_RUN | — |
| 4 (по желанию, рабочая копия) | `npm run migrate -- --dry` на копии, затем `npm run pipeline:once -- --runs` | нет / нет | копия, не рабочая база | в плане только `021_run_execution_identity.sql` (не destructive) | NOT_RUN | — |

Что передать: хвосты логов шагов 1–3 с exit code; при падении — имена тестов и текст ошибки.
Если на рабочей копии есть поставленные до этапа 11 запуски, после миграции их заменяет `npm run pipeline:once -- --retry --limit N`
(прежние → `cancelled` с причиной `config_mismatch`) — это отдельное решение оператора.
