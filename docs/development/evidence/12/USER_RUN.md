# Пользовательский прогон этапа 12
**Это форма, а не выполненный прогон.** PowerShell, корень `TG_Info`. Тестовая цель — `127.0.0.1:55433/tg_info_test` с маркером
(`evidence/09/USER_RUN_CLOSURE.md`, B2). Рабочая база, модель и источники не участвуют.

| Шаг | Команда (cwd) | Изменяет данные? | Цель/guard | Ожидается | Фактически | Exit/log |
|---|---|---|---|---|---|---|
| 1 | `cd backend; npx vitest run --maxWorkers=2` | нет | мёртвый адрес БД | все passed, 0 skipped | NOT_RUN | — |
| 2 | `Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue; $env:TEST_DATABASE_URL='postgresql://tg_test:tg_test@127.0.0.1:55433/tg_info_test'; npm run test:integration` | да: пересоздаёт схему `tg_info_test` | общий preflight | все файлы passed; особенно `dossier.int`, `snapshot.int`, `release.int` (статусы роли `reported`/`contradicted` не изменились на их данных) | NOT_RUN | — |
| 3 | seed `npm run seed:test-release` (как C1 закрытия 09), API на `tg_info_test`, затем обращения через UI или API | да: `tg_info_test` | preflight сида | см. сценарии ниже | NOT_RUN | — |
| 4 | `cd frontend; npm run build` | нет | — | exit 0 | NOT_RUN | — |

## Сценарии T12-12 (синтетика seed:test-release, объект «Причал-Релиз»)
Создайте обращения и сохраните из ответа `GET /api/cases/<id>/dossier` поля `role.status`, `chain.status`, коды `role.context[].code`,
`chain.context[].code` и `scope.dimensions` у фраз (не только HTTP 200):

1. «Альфа-Релиз» (ИНН …3893), корпус 2, работы «монтаж систем водоснабжения», роль подрядчик → `role.status = contradicted`
   (отрицание из дайджеста по корпусу 2), `chain.status = scope_unknown`: субподряд «Бета-Релиз» → «Альфа-Релиз» на ВК корпуса 2
   в seed не называет объект — он в `chain.context` как общий фон, а не documented (до этапа 12 было documented).
2. То же, корпус 1 → участие на корпусе 2 в `otherBuildings`, отрицание корпуса 2 в `role.context` (`role_denied_other_scope`),
   субподряд без объекта в `chain.context`.
3. «Гамма-Релиз», корпус 1, отделка, роль подрядчик, дата обращения сегодня → участие 2025-03…2026-03 в `role.context`
   (`role_other_scope`, период), статус `scope_unknown`.
4. «Дельта-Релиз», корпус 1, отделка → роль `reported` (с апреля 2026).
5. Схема связей обращения 1 с фильтром корпуса 2: рёбра корпуса 1 скрыты; рёбра без корпуса (генподряд «Порт-Релиз» → «Бета-Релиз») — с пометкой «корпус в источнике не указан».
6. Новый снимок обращения 1 содержит `role.context`/`chain.context`; снимок, созданный до этапа 12, открывается и выгружается как раньше.

Что передать: JSON-фрагменты полей выше по каждому обращению, хвост интеграционного лога с exit code.
