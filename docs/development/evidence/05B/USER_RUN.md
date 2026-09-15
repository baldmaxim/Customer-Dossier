# Прогон пользователя — этап 05B

## Прогон 1 — 2026-09-15, `dossier-stages @ 5a62b94`

| Шаг | Результат |
|---|---|
| A2 `git pull`, `npm ci` | ок |
| A3 unit | ок — 25 / 356 |
| A3 frontend build | ок |
| A4 тестовая база | ок |
| A5 `npm run test:integration` | ок — 13 файлов / 148 (в т.ч. `ingest/telegram/telegram.int.test.ts`) |
| I1 seed | ок — demo_tg_gap: ok, gap_open_max_pages; demo_tg_renamed: identity_changed; бот: обработано 3, принято 2, отклонено 1; повтор: 3 уже обработанных |
| I2 курсор | ок — lastPostId 160, gap after 100 / before 150, причина «101…149» |
| I2 публикации | ок — gap 11, renamed 0 |
| I2 журнал бота | ок — 9001 inserted, 9002 rejected_sender, 9003 new_revision |
| I2 правки и происхождение | ок — ред. 1 message / hidden_user; ред. 2 «Поправка: не так.» / edited_message |
| I2 append-only | ок — UPDATE запрещён |
| I3 админка | ок по API — gap: «в порядке», разрыв, ok / gap_open_max_pages / tg_web@2 / 11; renamed: identity_uncertain, identity_changed; таблица в scroll-x |
| 390 px глазами | NOT_RUN |
| Живой канал / бот | NOT_RUN — допуска и токена нет |

Этап 05B — PASS.
