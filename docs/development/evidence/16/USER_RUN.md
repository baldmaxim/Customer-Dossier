# Пользовательский прогон этапа 16
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. Живые шаги (5–7) — только после явного списка адресов/каналов
и оснований владельца; без списка они NOT_RUN, а `VALIDATED_SOURCES.md` остаётся пустым.

| Шаг | Команда (cwd) | Изменяет данные? | Цель/guard | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|---|
| 1 | `cd backend; npx vitest run src/ingest src/net --maxWorkers=2` | нет | без сети и БД | все passed, в т.ч. `sourceContract.test.ts` (профиль, состояния, фикстуры, шаблоны) | NOT_RUN | — |
| 2 | `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npx vitest run -c vitest.integration.config.ts src/ingest/sites/sites.int.test.ts src/ingest/telegram/telegram.int.test.ts` | да: тестовая схема | общий preflight; сеть — внедрённый транспорт | все passed, включая «этап 16: цикл пагинации и разрешённые пути» | NOT_RUN | — |
| 3 (браузер) | API + UI на `tg_info_test` после seed | нет (чтение) | тестовая цель | «Источники»: у каждого состояние словами (не запускался / работает / …), причина, «полнота истории: неизвестна», ИИ отдельно | NOT_RUN | — |
| 4 | (без сети) `npm run ingest:once -- --add-site <URL_ИЗ_СПИСКА>`; профиль из `docs/development/sources/site-profile.template.json` → `npm run ingest:once -- --site-profile <ключ> --file <profile.json>` | да: строка источника в **выбранной** базе | адрес из утверждённого списка; допуск не меняется | «профиль … записан», источник `paused`, допуск `unknown` | NOT_RUN (списка нет) | — |
| 5 | Оператор в админке: допуск на сбор с основанием; `npm run ingest:once -- --probe-site <ключ>` | нет (проба не пишет) | только после допуска; `INGEST_ENABLED=false` | исход, `layout_stats`, до 3 образцов с полнотой | NOT_RUN | — |
| 6 | `npm run ingest:once -- --source <ключ>` один раз | да: публикации и курсор источника | фон выключен, допуск на сбор есть | состояние `healthy` или `partial_history` с границами; редакции с честной полнотой | NOT_RUN | — |
| 7 | Канал отдельно: `--add <канал>`, `--telegram-profile <канал> --file <profile.json>`, допуск, `--probe <канал>`, `--source <канал>` | как 4–6 | как 4–6 | первый проход без истории, граница истории в покрытии | NOT_RUN | — |

Для шагов 4–7 заранее решить, в какой базе ведётся подключение (тестовая или рабочая) — агент эту базу не выбирает.
Что передать: логи шагов 1–2 с exit code; для 5–7 — исход, покрытие, число записей, полноту текста, ИИ-допуск отдельно; строку для
`docs/development/sources/VALIDATED_SOURCES.md` заполняет пользователь.
