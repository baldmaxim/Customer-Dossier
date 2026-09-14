# ADR-002 — Публикации, неизменяемые редакции и наблюдения

Статус: принято на этапе 02 (2026-09-14). Названия и семантика сохраняются в следующих этапах
(DATA_CONTRACTS: SourceItem, DocumentRevision).

## Контекст

`raw_documents` смешивал публикацию и текст: глобальная уникальность `content_hash` делала один
текст в трёх каналах одним документом, а правка поста с тем же `external_id` возвращала
`edited_skipped` и терялась. Переписать `body` нельзя — к нему привязаны цитаты.

## Решение

Три таблицы (миграция `011_source_items_revisions.sql`):

- **`source_items`** — личность публикации: `(source_id, item_key)`. Ключ:
  `ext:<external_id>` → иначе `url:<канонический URL>` → иначе `text:<sha256>` (ручная вставка
  без адреса). Канонический URL убирает только закрытый список tracking-параметров (utm_*, yclid,
  gclid, fbclid, _openstat, mc_*) и фрагмент; содержательные параметры и путь не трогаются.
  Поля: даты (published/first/last observed), указатель на текущую редакцию и когда её состояние
  наблюдали, `state` (`present` / `deleted_observed` только при реально наблюдённом удалении),
  `history_before_import` (`complete` / `unknown`), `origin` (`ingest` / `legacy_import`).
- **`document_revisions`** — неизменяемая редакция: `revision_no`, `body` в представлении,
  с которым сверяются цитаты, `body_representation` (`telegram_web_text@1`, `rss_text@1+title`,
  `article_text@1+title`, `telegram_bot_text@1`, `manual_text@1`, `legacy_raw_documents_body`),
  `body_hash` (sha256 канонической формы: NFC, LF, без хвостовых пробелов строк), `dedup_hash`
  (сигнал перепечатки), полнота `full/excerpt/caption_only/failed/unknown` с причиной, вложения,
  даты, `chronology` (`source_modified_at` / `observed_order` / `unknown`),
  `same_content_as_revision_id` (A→B→A), `legacy_document_id`. UPDATE и DELETE запрещены триггером.
- **`source_observations`** — факт наблюдения: `new_item`, `new_revision`, `unchanged`, `stale`,
  `deleted_observed`, `legacy_import`; ссылки на запуск и legacy-sighting.

Правила записи (`backend/src/revisions/decide.ts`, `store.ts`):

- тот же текст → только наблюдение; другой текст → новая редакция и новое текущее состояние;
- наблюдение старее текущего состояния (по дате изменения от источника или, без неё, по времени
  получения) → редакция сохраняется, но текущей не становится (`stale`);
- порядок без надёжной даты — `observed_order`, дата изменения не выдумывается;
- запись в транзакции; upsert публикации блокирует строку — параллельные наблюдения одного
  состояния не размножают редакции.

Полнота — по происхождению текста, а не по длине: пост Telegram — `full`, подпись к медиа —
`caption_only` (вложение `unsupported`); description/summary ленты — `excerpt`; content:encoded —
`unknown`; текст страницы статьи по явному селектору или семантическому контейнеру — `full`,
по эвристике — `unknown`; ручная вставка — `unknown`.

**Мост к legacy.** `ingest/store.ts` пишет публикацию и, только для первой редакции новой
публикации, legacy-документ (как раньше, с дедупом по хэшу). Правки и повторы legacy не
трогают: цитаты и карточки читают прежний текст, очередь старого apply не пополняется.
Флаг `REVISION_WRITE_ENABLED=false` возвращает прежнее поведение.

**Backfill** (`npm run backfill:revisions`, по умолчанию dry-run): sightings и документы без
sightings → публикации `legacy_import` с `history_before_import='unknown'`, редакции с
`chronology='unknown'`, `completeness='unknown'`. Идемпотентность — явные проверки существования
и уникальные индексы; checkpoint в `backfill_checkpoints`; advisory lock; конфликт с публикацией,
уже ведущейся новым сбором, — в отчёт, без записи.

## Отклонено

- Переписывать `raw_documents.body` при правке — ломает цитаты.
- Одна таблица «версий документа» по content hash — склеивает разные публикации.
- Физическое удаление при исчезновении со страницы — «не получили в выборке» не доказывает удаление.

## Последствия

- Извлечение по-прежнему идёт по legacy-документу (первой редакции). Разбор последующих редакций —
  этап 03B (append-only runs по `revision_id`).
- Offsets цитат будут считаться по `document_revisions.body` (этап 03A).
- Удаление источника теперь учитывает и публикации.
