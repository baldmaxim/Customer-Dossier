# ADR-003 — Утверждения, доказательства и решения аналитика

Статус: принято на этапе 03A (2026-09-14). Названия и семантика сохраняются (DATA_CONTRACTS: Assertion,
Evidence, ReviewDecision).

## Контекст

Канон хранил вывод модели как факт: роль на объекте с единственным `evidence_document_id`, события с
`status='auto'`. Переразбор удалял вклад документа вместе с тем, что подтвердил другой источник; ручного
решения, переживающего переразбор, не было.

## Решение

Миграция `012_assertions_evidence_reviews.sql`:

- **`assertions`** — смысл: `predicate` (`participates_in_project`, `event`, `company_mentioned`,
  `project_mentioned`), роль/тип события, стороны реальными FK (`subject_company_id` / `subject_project_id`,
  `object_*`, `counterparty_company_id`), неразрешённая сторона (`subject_text`, `object_text`) допустима
  только у кандидата или отклонённого, корпус и пакет работ, период с точностью, модальность
  (`reported_fact/claim/planned/possible/negated/unknown`), значение с валютой. `content_key` — sha256
  всего содержания: одинаковый смысл из двух документов — одно утверждение с двумя доказательствами.
  **Содержательные поля неизменяемы (триггер)**: новый смысл — новое утверждение со ссылкой
  `supersedes_assertion_id`, решения не наследуются. Изменяемы только состояние (`status`,
  `needs_revalidation`, `version`) и уверенности. Удаление запрещено.
- **`evidence`** — `revision_id` + `[span_start, span_end)` + `quote` + контекст ±80 символов, `stance`
  (`supports/contradicts/mentions`), `status` (`active/withdrawn/unavailable`) с причиной. **Offsets —
  code points** строки `document_revisions.body`: тот же счёт у PostgreSQL `substring`, поэтому триггер
  при вставке проверяет совпадение цитаты с фрагментом. Содержание неизменяемо, удаление запрещено,
  отзыв — статусом.
- **`review_decisions`** — append-only (триггер): решение (`reviewed_supported/disputed/rejected/candidate`
  — снять оценку), `scope` (`reflects_source` — источник так пишет / `fact_confirmed`), reviewer, причина,
  `assertion_version` и `evidence_set_hash` (активные доказательства `id:stance`) на момент решения,
  `idempotency_key`, `provenance_gap`, legacy-ссылка.

Состояние (`backend/src/assertions/model.ts`, `repository.ts`): есть решение (не `candidate`) — статус из
решения, `needs_revalidation`, если набор доказательств изменился; решения нет — `text_grounded` при активном
поддерживающем доказательстве, иначе `candidate`. Уверенность модели (`confidence_extraction`), уверенность
сопоставления (`confidence_identity`) и решение аналитика — разные поля.

Конкуренция: `version` растёт при каждом изменении состояния и при каждом решении; запись решения требует
`expectedVersion` (409 при расхождении), повтор с тем же `idempotency_key` возвращает прежний результат,
тот же ключ с другим содержанием — 422.

**Legacy** (`npm run backfill:assertions`, dry-run по умолчанию; требует выполненного `backfill:revisions`):
mentions → `*_mentioned`, project_participants → `participates_in_project` (доказательство — упоминание той же
компании с той же ролью в документе-основании), events → `event`. Доказательство создаётся только при
однозначном нахождении цитаты в редакции с тем же текстом; при нескольких вхождениях или отсутствии — счётчик
в отчёте, без записи. Автостатус не становится подтверждением. Ручные `confirmed/rejected` событий переносятся
решением `reviewer='legacy_unknown'`, `provenance_gap=true`, даже без найденного доказательства (утверждение —
кандидат). Модальность legacy — `unknown`.

## Отклонено

- Полиморфный `entity_id` без FK (как в `mentions`) — висячие ссылки.
- Одно поле confidence для всего.
- Offsets в UTF-16: база не может проверить совпадение цитаты без внешнего кода.
- Перенос решения на изменённое утверждение.

## Последствия

- Утверждения пока создаются backfill'ом, seed-скриптами и API решений; запись из конвейера — этап 03B.
- Карточки по-прежнему читают legacy-канон; переход досье на утверждения — этапы 07/08A.
- Расширение набора предикатов (договор, корпоративная связь) — этап 06.
