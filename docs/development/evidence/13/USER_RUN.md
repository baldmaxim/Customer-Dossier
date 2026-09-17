# Пользовательский прогон этапа 13
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. Тестовая цель — `127.0.0.1:55433/tg_info_test` с маркером.

| Шаг | Команда (cwd) | Изменяет данные? | Цель/guard | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|---|
| 1 | `cd backend; npx vitest run --maxWorkers=2` | нет | мёртвый адрес БД | все passed, 0 skipped | NOT_RUN | — |
| 2 | `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npx vitest run -c vitest.integration.config.ts src/snapshot/snapshot.int.test.ts` | да: пересоздаёт схему, миграции 001–022 | общий preflight | все тесты файла passed, включая describe «этап 13» (R08 409, повтор, два одновременных ключа, барьер переименования, редакция основания, покрытие) | NOT_RUN | — |
| 3 | `npm run test:integration` | да: то же | то же | все файлы passed, 0 skipped | NOT_RUN | — |
| 4 | Повтор раздела E `evidence/09/USER_RUN_CLOSURE.md` (dump → restore → `release:manifest --compare`) на данных после шага 3 или seed | да: restore-цель | preflight / маркер restore-цели | `MATCH`; manifest видит новые колонки `previous_run_id` (021), `request_hash` (022) без `UNCLASSIFIED_TABLE` | NOT_RUN | — |
| 5 (браузер) | API + UI на `tg_info_test`: создать снимок обращения, «Версия для печати», Markdown, JSON | да: снимок | тестовая цель | в «Ограничениях» нет строк об усечении на малой выборке; старый снимок открывается и выгружается | NOT_RUN | — |

Что передать: хвосты логов шагов 1–3 с exit code; вывод compare шага 4; при падении — имя теста и ошибка.
