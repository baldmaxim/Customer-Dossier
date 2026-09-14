# Прогон пользователя — этап 03B

## Прогон 1 — 2026-09-14, `dossier-stages @ 7e1cf2d`

| Шаг | Результат |
|---|---|
| A2 `git pull`, `npm ci` backend/frontend | ок (перед `npm ci` сняты старые dev/esbuild) |
| A3 typecheck, `npm test`, frontend build | ок — unit 22 / 325 |
| A4 тестовая база (compose) | ок — `tg_info:test-target` |
| A5 `npm run test:integration` | **не ок** — 10 файлов / 103: 2 failed, 101 passed; остальные 9 файлов зелёные |
| F seed, `--runs`, `--preview 2/3`, `--publish 3/2/2`, evidence / card_events / Демо-Роща / history, `--reextract`, `--merge`, UPDATE ответов | ок |

Упавшие тесты `reprocess/reprocess.int.test.ts`:

1. «публикация: … проекция карточки» — `card_events_v` для «Демо-Альфа» `expected 1 to be 2`.
   Причина (дефект кода): два суда без даты, суммы и контрагента имели одинаковый `content_key` и при публикации
   сливались в одно утверждение. Исправлено: `assertions.event_discriminator` (хэш нормализованной цитаты
   недоопределённого события) входит в ключ и неизменяем; та же логика в подписи предпросмотра.
2. «API: предпросмотр и 409» — POST без CSRF вернул 200.
   Причина (дефект теста): тестовый HTTP-клиент подставляет cookie и CSRF сам. Исправлено: отсутствие cookie и
   CSRF задаётся явно (`401` / `403`), как в тестах 03A; дополнительно проверено, что версия публикации не изменилась.
