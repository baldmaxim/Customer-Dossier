# Этап 02 — прогон пользователя

Дата: 2026-09-14. Машина пользователя, ветка `dossier-stages` @ `aa7ed01`, Node v24.13.0, Docker Desktop.
Инструкция: `docs/development/TESTING_LOCAL.md`. Результаты переданы пользователем текстом; логи не прикладывались.

| Шаг | Результат |
|---|---|
| A2 `npm ci` backend/frontend | ок |
| A3 typecheck backend | ок |
| A3 `npm test` | ок — 20 файлов / 297 passed |
| A3 frontend tsc + build | ок |
| A4 `docker compose … up -d --wait` | **ошибка**: каталог `backend/test-db/init` не в Docker Desktop File Sharing. Обход: `docker run` на :55433 + `COMMENT ON DATABASE … 'tg_info:test-target'` вручную → healthy, метка на месте. Исправлено после прогона: compose без bind-mount, метку ставит healthcheck |
| A5 `npm run test:integration` | ок — цель `127.0.0.1:55433/tg_info_test`, **7 файлов / 61 passed** |
| B dry-run | ок — `rowsScanned: 3`, `revisionsCreated: 3` |
| B `count(*)` после dry-run | ок — 0 |
| B `--apply --batch 2` | ок — items/revisions/observations = 3, `ambiguousCount: 0` |
| B повтор `--apply` | ок — `rowsScanned: 0` |
| B `--apply --from-start` | ок — scanned 3, created 0, `observationsExisting: 3` |
| B `count(*)` | ок — 3 |
| B `UPDATE document_revisions` | ок — «document_revisions неизменяемы: UPDATE запрещён» |
| C `seed:test-revisions` | ок |
| C API + UI по данным | ок — две публикации (2 ред. full; 1 ред. caption_only), chronology observed_order, текст rev1, diff −/+, photo/unsupported, страница 5173 → 200 |
| C визуально: 390 px, метка «текущая», ссылка «версии» в карточке | **NOT_RUN** — без автоматизации браузера |
| D1 unit с чужим DATABASE_URL | ок — 297 passed |
| D2 guard: без цели / не loopback / совпадение | ок — все три отказа |
| D3 migrate dry / без флага / с флагом | ок — exit 0 / 1 / 0, 11 миграций, у 009 «ВНИМАНИЕ» |
| D3 ingest / reextract / merge | ок — блокировки |
| D4 jobs off + listen, curl 401/403 | ок |
| D5 UI админки, DevTools caches | частично — страница входа 200, конфиг SW проверен; клик-сценарий не прогонялся |

Примечание: до переключения ветки пользователь сохранил свои незакоммиченные изменения
(`stash` с `merge.ts`, `cli.ts` вынесен во временный каталог). В ветку они не попали.
