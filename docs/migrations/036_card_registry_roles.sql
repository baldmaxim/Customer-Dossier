-- Роль застройщика из реестра (ДОМ.РФ) — в карточках компании и объекта (этап 20D).
--
-- Утверждения происхождения registry публикуются не наборами кандидатов конвейера, а сразу при снимке
-- (registry/publish.ts), поэтому published_assertions_v их не видит, и роль из реестра в карточки не
-- попадала с этапа 20B — хотя ADR-012 это обещал. Здесь у них своя ветка: не отклонено, положительное
-- сообщение о состоявшемся и есть действующее подтверждающее доказательство (снятое доказательство —
-- снятая роль). Утверждение, которое конвейер опубликовал и сам, остаётся в ветке published: дубля нет.
--
-- Столбцы и порядок прежние — вид заменяется на месте, зависимые виды (co_participations_v) не трогаются.

CREATE OR REPLACE VIEW card_participations_v AS
SELECT pp.project_id, pp.company_id, pp.role, pp.confidence, pp.evidence_document_id, pp.is_current,
       'legacy'::text AS origin, NULL::bigint AS assertion_id,
       NULL::text AS scope_building, NULL::text AS work_package, NULL::date AS valid_from, NULL::date AS valid_to,
       'unknown'::text AS period_precision
FROM project_participants pp
WHERE pp.evidence_document_id IS NULL
   OR pp.evidence_document_id NOT IN (SELECT document_id FROM replaced_legacy_documents_v)
UNION ALL
SELECT pa.object_project_id, pa.subject_company_id, pa.role, coalesce(pa.confidence_extraction, 0.5),
       pa.evidence_document_id, pa.valid_to IS NULL OR pa.valid_to >= current_date, 'published', pa.id,
       pa.scope_building, pa.work_package, pa.valid_from, pa.valid_to, pa.period_precision
FROM published_assertions_v pa
WHERE pa.predicate = 'participates_in_project' AND pa.subject_company_id IS NOT NULL AND pa.object_project_id IS NOT NULL
  AND pa.polarity = 'positive' AND pa.modality IN ('reported_fact', 'unknown')
UNION ALL
SELECT a.object_project_id, a.subject_company_id, a.role, coalesce(a.confidence_extraction, 0.5),
       (SELECT r.legacy_document_id
          FROM evidence e JOIN document_revisions r ON r.id = e.revision_id
         WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'
         ORDER BY e.id DESC LIMIT 1),
       a.valid_to IS NULL OR a.valid_to >= current_date, 'registry', a.id,
       a.scope_building, a.work_package, a.valid_from, a.valid_to, a.period_precision
FROM assertions a
WHERE a.origin = 'registry' AND a.predicate = 'participates_in_project'
  AND a.subject_company_id IS NOT NULL AND a.object_project_id IS NOT NULL
  AND a.status <> 'rejected' AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'unknown')
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')
  AND NOT EXISTS (SELECT 1 FROM published_assertions_v pa WHERE pa.id = a.id);
