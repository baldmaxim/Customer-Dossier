# Отчёт этапа 13 — Согласованный снимок и честная полнота выборки

Дата: 2026-09-17. Ветка `main`, основа `312de2e`. Промт: `prompts/TG_Info_Next_Stages_2026-09-16/stages/STAGE_13_SNAPSHOTS_AND_COMPLETENESS.md`.

## Статусы
IMPLEMENTED: да
CODE_CHECKED: typecheck PASS; unit `src/snapshot`, `src/dossier`, `src/signals`, `src/graph` — 66 PASS (`--maxWorkers=1`); полный unit — BLOCKED_ENV (память машины агента)
REVIEWED: NOT_RUN
USER_VALIDATED: NOT_RUN (миграция 022, гонки и ключи на PostgreSQL, экспорт в браузере)

## Исходная проблема (подтверждено чтением кода)
- **F07 / R08.** `snapshot/repository.ts::createSnapshot`: найденный `idempotency_key` сразу возвращал прежний снимок без сверки обращения
  и периода — ключ обращения A отдавал снимок A на запрос по обращению B. Конкурентный повтор ключа давал необработанный 23505 (500).
- **F08.** `snapshot/build.ts` и `dossier/load.ts` вызывали `refreshState()`, который читал общий pool вне транзакции REPEATABLE READ
  снимка. Кроме того, первая команда транзакции (точка чтения) возникала только внутри построения.
- **F09.** `signals/load.ts`: completeness и dedup_hash публикации брались от последней редакции на срез, хотя доказательство
  ссылалось на более раннюю — необработанная правка меняла семью перепечаток и полноту старой цитаты.
- **F10.** `dossier/facts.ts` — `ORDER BY a.id LIMIT 1000` без признака неполноты (усекались как раз новые сведения);
  `graph/load.ts` — `LIMIT 2000` и `LIMIT 500` без отметки; усечение загрузки не отличалось от лимита узлов.

## Контракты
- **snapshot-request@1** (`snapshot/requestIdentity.ts`): hash канонического `{caseId, effectiveFrom, effectiveTo}`. Тот же ключ + тот же
  запрос → прежний снимок (200), даже если живое досье изменилось. Тот же ключ + другой запрос → 409 `idempotency_key_conflict`.
  Снимок актуального состояния — новый ключ. Снимки до этапа 13 (`request_hash = NULL`) сверяются только по сохранённым `case_id`,
  `effective_from`, `effective_to`; неизвестное не считается совпадением. Конкурентный повтор: 23505 → чтение победителя вне
  прерванной транзакции и та же сверка. Срез знаний по-прежнему только «сейчас» (прошлое → 422).
- **Согласованное чтение.** Транзакция снимка: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` → `SELECT 1` (точка чтения) → сверка
  ключа → построение. Все чтения построения идут через client транзакции: обращение, факты, линия решений, очередь, идентичность,
  состояние объекта, **состояние сигналов** (`refreshState(client)`), утверждения, доказательства, решения, компания, объект, схема
  (`graphLoader(client)`). Внешних вызовов в транзакции нет. Выдача живого досье (`loadCaseDossier`) и резюме компании тоже читают сигналы
  своим исполнителем.
- **Редакция основания** (`signals/load.ts`): у публикации completeness и dedupHash — от последней из редакций, на которые ссылаются
  доказательства; отдельно `evidenceRevisionNo`, `latestRevisionNo`, `pendingRevision`. Правила `signals@1` не менялись (исправлен вход).
- **coverage@1** (`dossier/facts.ts::coverageOf`): `{ source, limit, loaded, total, truncated }`; total известен (или `null`, не подменяется
  loaded). Выборка фактов: сначала сведения по объекту обращения, затем новые; лимит 1000 сохранён, при превышении — счёт total и
  пометка. Досье: `coverage`, пробел `selection_truncated_*`, вместо «не найдено» — «в загруженной части не найдено». Схема:
  `loaderTruncated` (assertions / co_mentioned) отдельно от `truncated` (лимит узлов) и заметка. Снимок `dossier-snapshot@2`: поле
  `coverage` и строки в `limitations` (попадают в HTML/Markdown/JSON).

## Изменения
- `docs/migrations/022_snapshot_request_identity.sql` (additive): `dossier_snapshots.request_hash`, guard неизменяемости включает её.
- `backend/src/snapshot/requestIdentity.ts` (новый), `repository.ts` (сверка ключа, 23505, точка чтения, `afterFirstRead` для теста гонки),
  `build.ts` (`refreshState(client)`, покрытие, `dossier-snapshot@2`), `api/snapshot.routes.ts` (409).
- `backend/src/signals/refresh.ts` (`refreshState(exec)`), `signals/load.ts`, `signals/types.ts` (редакция основания).
- `backend/src/dossier/facts.ts` (`loadCompanyFactsPage`/`loadProjectFactsPage`, `coverageOf`, приоритет объекта), `load.ts`, `companySummary.ts`,
  `caseDossier.ts` (покрытие и пробелы).
- `backend/src/graph/load.ts` (пределы как константы, `truncations`), `graph.ts` (`loaderTruncated`, заметка).
- Тесты: `snapshot/completeness.test.ts` (новый, 10); `snapshot/snapshot.int.test.ts` — describe «этап 13» (6).

Отклонено: удаление LIMIT; API-пагинация фактов досье (досье строится целиком шаблоном; вместо этого приоритет объекта и явное покрытие —
постраничный просмотр сведений компании остаётся за этапом 15B/18); пересчёт старых снимков.

## Проверки

| Scenario ID | Файл/тест | Кем | Результат |
|---|---|---|---|
| T13-01 (R08) | `completeness.test.ts` «R08…»; `snapshot.int` «R08 / T13-01…» | AGENT / USER | unit PASS; int NOT_RUN |
| T13-02 | `snapshot.int` «T13-02: настоящий повтор…» | USER | NOT_RUN |
| T13-03 | `snapshot.int` «T13-03: два одновременных запроса…» | USER | NOT_RUN |
| T13-04 | `completeness.test.ts` «T13-04: состояние сигналов читается переданным исполнителем» | AGENT | PASS |
| T13-05 | `snapshot.int` «T13-05: переименование, закоммиченное во время построения…» (барьер `afterFirstRead`) | USER | NOT_RUN |
| T13-06 | `snapshot.int` «новая публикация, переименование, слияние… не меняют S1» (08B) + «T13-08 / T13-10…» (S1 verified) | USER | NOT_RUN на коде 13 |
| T13-07 | `snapshot.int` «T13-07: правка без разбора…» | USER | NOT_RUN |
| T13-08 | `completeness.test.ts` «coverage@1» (1001 из 1000, total неизвестен, досье без ложного «не найдено») | AGENT | PASS; большой набор на БД NOT_RUN |
| T13-09 | `completeness.test.ts` «T13-09: усечение загрузки связей…» | AGENT | PASS; 2001 связь на БД NOT_RUN |
| T13-10 | `snapshot.int` «T13-08 / T13-10: новый снимок несёт покрытие…»; ограничения в выгрузках | USER | NOT_RUN |
| T13-11 | `completeness.test.ts` «T13-11: снимок до этапа 13 без request_hash…»; старые фикстуры `snapshot.test.ts` (@1) | AGENT | PASS |
| T13-12 | 422 для прошлого среза — прежний тест 08B | USER | NOT_RUN на коде 13 |

## Неизменённые ограничения
Рабочая БД, `.env`, источники, флаги, модель не трогались. Старые снимки, их payload и hash не пересчитывались. Историческое время
(срез знаний в прошлом) по-прежнему не поддерживается.

## Миграция и откат
`022_snapshot_request_identity.sql` — additive, не destructive (применяет пользователь). Прежний код читает таблицу без новой колонки.
Откат кода — `git revert`: ключи снова начнут возвращать прежний снимок без сверки (не рекомендуется); снимки `dossier-snapshot@2`
остаются читаемыми (поле `coverage` игнорируется). Отключить новый формат отдельно нельзя без revert — формат аддитивный.

## Открытые риски
- Большие наборы (1000+ фактов, 2000+ связей) на PostgreSQL не прогонялись — покрытие проверено на чистых функциях.
- Постраничного просмотра всех сведений компании в UI нет: при усечении досье честно сообщает об ограничении.

## Следующий шаг пользователя
`evidence/13/USER_RUN.md`.
