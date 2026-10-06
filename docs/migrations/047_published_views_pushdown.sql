-- Опубликованные утверждения без DISTINCT ON: фильтр по компании и объекту доходит до таблиц (06.10.2026).
--
-- DISTINCT ON (a.id, cs.id) и DISTINCT ON (id) не пропускают внутрь условия на другие столбцы: запрос
-- «роли компании X» строил весь набор опубликованных утверждений и только потом оставлял строки X —
-- ~150 мс на каждое касание вида при 45 тыс. утверждений, у компании с девятью утверждениями столько же,
-- сколько у самой крупной. Карточка компании касается видов полтора десятка раз за открытие, а «Подробно»
-- (контрагенты на каждом объекте) — по разу на объект: у крупной компании — десятки секунд.
--
-- Те же строки другим способом: одна строка на (утверждение, активный набор) — у неё наименьший id
-- подтверждающего доказательства в наборе; одна строка на утверждение — публикация раньше по дате, затем по
-- редакции (прежний ORDER BY source_published_at NULLS LAST, published_revision_id). Без DISTINCT вид
-- раскрывается в запрос, и условие по компании идёт индексом assertions_subject_company_idx.
-- Столбцы и порядок прежние — виды заменяются на месте, зависимые (card_*, project_state_history_v,
-- legal_case_events_v) не трогаются.

CREATE OR REPLACE VIEW published_assertions_v AS
SELECT a.*, cs.source_item_id, cs.revision_id AS published_revision_id, r.legacy_document_id AS evidence_document_id,
       r.published_at AS source_published_at
FROM item_publications p
JOIN candidate_sets cs ON cs.id = p.active_set_id
JOIN candidate_set_evidence cse ON cse.set_id = cs.id
JOIN evidence e ON e.id = cse.evidence_id AND e.status = 'active' AND e.stance = 'supports'
JOIN assertions a ON a.id = e.assertion_id AND a.status <> 'rejected'
JOIN document_revisions r ON r.id = cs.revision_id
WHERE NOT EXISTS (
  SELECT 1
  FROM evidence e2
  JOIN candidate_set_evidence cse2 ON cse2.evidence_id = e2.id
  WHERE e2.assertion_id = a.id AND cse2.set_id = cs.id AND e2.status = 'active' AND e2.stance = 'supports'
    AND e2.id < e.id
);

CREATE OR REPLACE VIEW published_assertions_distinct_v AS
SELECT pa.*
FROM published_assertions_v pa
WHERE NOT EXISTS (
  SELECT 1
  FROM evidence e2
  JOIN candidate_set_evidence cse2 ON cse2.evidence_id = e2.id
  JOIN item_publications p2 ON p2.active_set_id = cse2.set_id
  JOIN candidate_sets cs2 ON cs2.id = cse2.set_id
  JOIN document_revisions r2 ON r2.id = cs2.revision_id
  WHERE e2.assertion_id = pa.id AND e2.status = 'active' AND e2.stance = 'supports'
    AND (   (r2.published_at IS NOT NULL AND pa.source_published_at IS NULL)
         OR r2.published_at < pa.source_published_at
         OR (r2.published_at IS NOT DISTINCT FROM pa.source_published_at AND cs2.revision_id < pa.published_revision_id))
);

-- Обратный путь «набор → публикация»: от утверждения к активному набору без перебора всех публикаций.
CREATE INDEX IF NOT EXISTS item_publications_active_set_idx ON item_publications (active_set_id) WHERE active_set_id IS NOT NULL;
