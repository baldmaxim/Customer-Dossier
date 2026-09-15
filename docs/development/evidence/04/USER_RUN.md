# Прогон пользователя — этап 04

## Прогон 1 — 2026-09-15, `dossier-stages @ d987683`

| Шаг | Результат |
|---|---|
| A2 `git pull`, `npm ci` backend/frontend | ок |
| A3 unit, frontend build | ок — 23 / 340 |
| A4 тестовая база | ок — `tg_info:test-target` |
| A5 `npm run test:integration` | ок — 11 файлов / 123 (в т.ч. `identity.int`, `resolve.int`, `reprocess.int`) |
| G1 seed | ок — пары #1 дубль, #3 разные ИНН, #5 два города |
| G2 флаг выключен | ок — предпросмотр; `--yes` заблокирован; #3 `identifier_conflict`; #5 `city_conflict` |
| G3 применение/отмена | ок — применено #1/#2, повтор already_merged, отмена, повтор отмены, append-only; небезопасная отмена с `mentions: добавлено 1` |
| G4 backfill | ок — `identifiersExisting: 2`; без `--confirm-copy` отказ; с флагом ЗАПИСЬ |
| G5 API/админка | ок по API — 3 пары; дубль canApply; ИНН/город canApply:false; слияние → журнал → отмена → очередь снова 3; «Демо-Гранит» legal_entity / ООО / ИНН 7707083893 |
| 390 px | NOT_RUN глазами — проверен CSS (колонки с 768 px, на 390 друг под другом) |

Этап 04 — PASS.
