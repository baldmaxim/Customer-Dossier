-- 017: смысл связей, история ролей и корректные события (этап 06, ADR-008).
--
-- Только расширение. Утверждения получают полярность, объект договора, подпись пакета работ,
-- автора заявления, номер дела, процессуальные роли, стадию и результат, налоговую базу суммы.
-- Новые предикаты: contract (прямой договор между компаниями) и corporate_relation.
-- Совместное участие и упоминание не хранятся утверждениями — это представления.
-- Проекции карточек пересоздаются: отрицание, план и слух больше не становятся ролью или событием.

ALTER TABLE assertions
  ADD COLUMN polarity           TEXT NOT NULL DEFAULT 'positive' CHECK (polarity IN ('positive', 'negative')),
  ADD COLUMN context_project_id BIGINT REFERENCES projects(id),
  ADD COLUMN work_package_label TEXT,
  ADD COLUMN attributed_to      TEXT,
  ADD COLUMN case_number        TEXT,
  ADD COLUMN procedural_role    TEXT CHECK (procedural_role IS NULL OR procedural_role IN
                                ('plaintiff', 'defendant', 'applicant', 'creditor', 'debtor', 'third_party')),
  ADD COLUMN counterparty_role  TEXT CHECK (counterparty_role IS NULL OR counterparty_role IN
                                ('plaintiff', 'defendant', 'applicant', 'creditor', 'debtor', 'third_party')),
  ADD COLUMN event_stage        TEXT,
  ADD COLUMN event_outcome      TEXT CHECK (event_outcome IS NULL OR event_outcome IN
                                ('satisfied', 'partially_satisfied', 'dismissed', 'overturned', 'settled')),
  ADD COLUMN tax_basis          TEXT CHECK (tax_basis IS NULL OR tax_basis IN ('with_vat', 'without_vat'));

CREATE INDEX assertions_context_project_idx ON assertions (context_project_id) WHERE context_project_id IS NOT NULL;
CREATE INDEX assertions_case_number_idx ON assertions (upper(regexp_replace(case_number, '\s+', '', 'g'))) WHERE case_number IS NOT NULL;

ALTER TABLE assertions DROP CONSTRAINT assertions_predicate_check;
ALTER TABLE assertions ADD CONSTRAINT assertions_predicate_check CHECK (predicate IN
  ('participates_in_project', 'contract', 'corporate_relation', 'event', 'company_mentioned', 'project_mentioned'));

ALTER TABLE assertions DROP CONSTRAINT assertions_role_check;
ALTER TABLE assertions ADD CONSTRAINT assertions_role_check CHECK (role IS NULL OR role IN (
  'customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier', 'designer', 'investor', 'operator',
  'general_contract', 'subcontract', 'supply', 'design_contract', 'contract',
  'owns_share', 'controls', 'member_of_group', 'brand_of'));

ALTER TABLE assertions DROP CONSTRAINT assertions_predicate_shape;
ALTER TABLE assertions ADD CONSTRAINT assertions_predicate_shape CHECK (
  CASE predicate
    WHEN 'participates_in_project' THEN role IN ('customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier',
                                                  'designer', 'investor', 'operator')
         AND subject_project_id IS NULL
         AND (object_project_id IS NOT NULL OR (object_text IS NOT NULL AND status IN ('candidate', 'rejected')))
    WHEN 'contract' THEN role IN ('general_contract', 'subcontract', 'supply', 'design_contract', 'contract')
         AND subject_company_id IS NOT NULL AND object_company_id IS NOT NULL AND subject_company_id <> object_company_id
    WHEN 'corporate_relation' THEN role IN ('owns_share', 'controls', 'member_of_group', 'brand_of')
         AND subject_company_id IS NOT NULL AND object_company_id IS NOT NULL AND subject_company_id <> object_company_id
    WHEN 'event' THEN event_type IS NOT NULL
    WHEN 'company_mentioned' THEN subject_project_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
    WHEN 'project_mentioned' THEN subject_company_id IS NULL AND num_nonnulls(object_company_id, object_project_id) = 0
  END
);

-- Содержание утверждения неизменяемо, включая смысловые поля этапа 06.
CREATE OR REPLACE FUNCTION assertions_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'assertions: удаление запрещено' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.predicate, NEW.role, NEW.event_type, NEW.subject_company_id, NEW.subject_project_id, NEW.subject_text,
      NEW.object_company_id, NEW.object_project_id, NEW.object_text, NEW.counterparty_company_id,
      NEW.scope_building, NEW.work_package,
      NEW.valid_from, NEW.valid_to, NEW.period_precision, NEW.modality, NEW.value_type, NEW.value_numeric,
      NEW.value_currency, NEW.content_key, NEW.supersedes_assertion_id, NEW.origin, NEW.created_at,
      NEW.event_discriminator, NEW.polarity, NEW.context_project_id, NEW.work_package_label, NEW.attributed_to,
      NEW.case_number, NEW.procedural_role, NEW.counterparty_role, NEW.event_stage, NEW.event_outcome, NEW.tax_basis)
     IS DISTINCT FROM
     (OLD.predicate, OLD.role, OLD.event_type, OLD.subject_company_id, OLD.subject_project_id, OLD.subject_text,
      OLD.object_company_id, OLD.object_project_id, OLD.object_text, OLD.counterparty_company_id,
      OLD.scope_building, OLD.work_package,
      OLD.valid_from, OLD.valid_to, OLD.period_precision, OLD.modality, OLD.value_type, OLD.value_numeric,
      OLD.value_currency, OLD.content_key, OLD.supersedes_assertion_id, OLD.origin, OLD.created_at,
      OLD.event_discriminator, OLD.polarity, OLD.context_project_id, OLD.work_package_label, OLD.attributed_to,
      OLD.case_number, OLD.procedural_role, OLD.counterparty_role, OLD.event_stage, OLD.event_outcome, OLD.tax_basis) THEN
    RAISE EXCEPTION 'assertions: содержание утверждения неизменяемо — новый смысл оформляется новым утверждением'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Проекции карточек: пересоздаются, потому что a.* получил новые столбцы.

DROP VIEW card_events_v;
DROP VIEW card_participations_v;
DROP VIEW published_assertions_v;
-- replaced_legacy_documents_v не зависит от a.* и остаётся как есть.

CREATE VIEW published_assertions_v AS
SELECT DISTINCT ON (a.id, cs.id)
       a.*, cs.source_item_id, cs.revision_id AS published_revision_id, r.legacy_document_id AS evidence_document_id,
       r.published_at AS source_published_at
FROM item_publications p
JOIN candidate_sets cs ON cs.id = p.active_set_id
JOIN candidate_set_evidence cse ON cse.set_id = cs.id
JOIN evidence e ON e.id = cse.evidence_id AND e.status = 'active' AND e.stance = 'supports'
JOIN assertions a ON a.id = e.assertion_id AND a.status <> 'rejected'
JOIN document_revisions r ON r.id = cs.revision_id;

-- Одно утверждение, опубликованное несколькими публикациями (перепечатки, поздняя статья), — одна строка.
-- Публикации и доказательства при этом не теряются: они в evidence и candidate_set_evidence.
CREATE VIEW published_assertions_distinct_v AS
SELECT DISTINCT ON (id) *
FROM published_assertions_v
ORDER BY id, source_published_at NULLS LAST, published_revision_id;

-- Роль на объекте в карточке — только положительное сообщение о состоявшемся (или legacy без модальности).
-- План, слух, заявление и отрицание роли остаются утверждениями и видны в проверке, но ролью не становятся.
CREATE VIEW card_participations_v AS
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
  AND pa.polarity = 'positive' AND pa.modality IN ('reported_fact', 'unknown');

-- События карточки: положительные; план и слух не становятся событием, заявление (иск, претензия) — да.
-- Дата неизвестна — NULL, не сегодня. Стадия и номер дела — для группировки стадий одного дела.
CREATE VIEW card_events_v AS
SELECT e.id, e.type, e.occurred_on, e.project_id, e.company_id, e.counterparty_id, e.severity, e.amount_rub,
       e.document_id, e.quote, e.confidence, e.status, 'legacy'::text AS origin,
       NULL::text AS period_precision, NULL::date AS occurred_to, NULL::text AS case_number, NULL::text AS event_stage,
       NULL::text AS value_type, NULL::text AS value_currency, NULL::text AS modality
FROM events e
WHERE e.status = 'confirmed'
   OR e.document_id NOT IN (SELECT document_id FROM replaced_legacy_documents_v)
UNION ALL
SELECT -pa.id, pa.event_type, pa.valid_from, coalesce(pa.object_project_id, pa.subject_project_id),
       pa.subject_company_id, pa.counterparty_company_id,
       (CASE WHEN pa.event_type IN ('bankruptcy', 'bankruptcy_procedure', 'license_revoked') THEN 3
             WHEN pa.event_type IN ('court_case', 'deadline_missed', 'bankruptcy_filing') THEN 2
             WHEN pa.event_type IN ('delay', 'contractor_change', 'suspension', 'payment_claim', 'bankruptcy_intent') THEN 1
             ELSE 0 END)::smallint,
       CASE WHEN pa.value_type IS NOT NULL AND (pa.value_currency = 'RUB' OR pa.value_type = 'amount') THEN pa.value_numeric END,
       pa.evidence_document_id,
       (SELECT ev.quote FROM evidence ev WHERE ev.assertion_id = pa.id AND ev.status = 'active' ORDER BY ev.id LIMIT 1),
       coalesce(pa.confidence_extraction, 0.5), pa.status::text, 'published',
       pa.period_precision, pa.valid_to, pa.case_number, pa.event_stage, pa.value_type, pa.value_currency, pa.modality::text
FROM published_assertions_distinct_v pa
WHERE pa.predicate = 'event' AND pa.polarity = 'positive' AND pa.modality IN ('reported_fact', 'claim', 'unknown');

-- ---------------------------------------------------------------------------
-- Производные связи и истории

-- Совместное участие: две компании на одном объекте. Не договор и не корпоративная связь.
CREATE VIEW co_participations_v AS
SELECT DISTINCT a.project_id, a.company_id AS company_a_id, b.company_id AS company_b_id, a.role AS role_a, b.role AS role_b,
       a.scope_building AS building_a, b.scope_building AS building_b
FROM card_participations_v a
JOIN card_participations_v b ON b.project_id = a.project_id AND b.company_id > a.company_id;

-- История состояния объекта в действительном времени. Событие без даты состояния не задаёт.
-- recorded_at — когда утверждение записано в систему; порядок — по действительному времени, не по записи.
CREATE VIEW project_state_history_v AS
SELECT coalesce(pa.object_project_id, pa.subject_project_id) AS project_id,
       pa.scope_building,
       CASE pa.event_type
         WHEN 'construction_start' THEN 'construction'
         WHEN 'resumption' THEN 'construction'
         WHEN 'suspension' THEN 'suspended'
         WHEN 'cancellation' THEN 'cancelled'
         WHEN 'commissioning' THEN 'commissioned'
       END AS state,
       pa.valid_from, pa.valid_to, pa.period_precision, pa.id AS assertion_id, pa.modality::text AS modality,
       pa.created_at AS recorded_at, pa.source_published_at
FROM published_assertions_distinct_v pa
WHERE pa.predicate = 'event'
  AND pa.event_type IN ('construction_start', 'resumption', 'suspension', 'cancellation', 'commissioning')
  AND pa.polarity = 'positive' AND pa.modality IN ('reported_fact', 'unknown')
  AND pa.valid_from IS NOT NULL
  AND coalesce(pa.object_project_id, pa.subject_project_id) IS NOT NULL;

-- Текущее состояние: самое позднее по действительному времени. Поздно полученная старая статья его не меняет.
CREATE VIEW project_current_state_v AS
SELECT DISTINCT ON (project_id, coalesce(scope_building, ''))
       project_id, scope_building, state, valid_from, period_precision, assertion_id, recorded_at
FROM project_state_history_v
ORDER BY project_id, coalesce(scope_building, ''), valid_from DESC, valid_to DESC NULLS LAST,
         (CASE period_precision WHEN 'day' THEN 3 WHEN 'month' THEN 2 WHEN 'quarter' THEN 1 ELSE 0 END) DESC,
         recorded_at DESC;

-- Судебные и банкротные события: стадии одного дела — одна история по номеру; без номера каждое событие отдельно.
CREATE VIEW legal_case_events_v AS
SELECT CASE WHEN pa.case_number IS NOT NULL
            THEN 'case:' || upper(regexp_replace(pa.case_number, '\s+', '', 'g'))
            ELSE 'assertion:' || pa.id END AS case_key,
       pa.id AS assertion_id, pa.event_type, pa.subject_company_id, pa.procedural_role, pa.counterparty_company_id,
       pa.counterparty_role, pa.case_number, pa.event_stage, pa.event_outcome, pa.valid_from, pa.valid_to,
       pa.period_precision, pa.value_type, pa.value_numeric, pa.value_currency, pa.tax_basis, pa.modality::text AS modality,
       pa.attributed_to, pa.object_project_id AS project_id, pa.status::text AS status
FROM published_assertions_distinct_v pa
WHERE pa.predicate = 'event'
  AND pa.event_type IN ('court_case', 'bankruptcy', 'bankruptcy_intent', 'bankruptcy_filing', 'bankruptcy_procedure', 'payment_claim')
  AND pa.polarity = 'positive';

-- Очередь проверки по приоритету: идентичность → конфликт ролей/периодов → исправление → оспаривание.
-- Вторая модель не нужна: всё считается из утверждений, доказательств и решений.
CREATE VIEW review_queue_v AS
SELECT 1 AS priority, 'identity'::text AS kind, ra.id AS ref_id, NULL::bigint AS assertion_id,
       jsonb_build_object('entityKind', ra.entity_kind, 'surface', ra.surface, 'candidates', ra.candidate_ids) AS detail,
       ra.created_at AS since
FROM resolution_ambiguities ra
WHERE ra.status = 'open'
UNION ALL
SELECT 2, 'polarity_conflict', pos.id, pos.id,
       jsonb_build_object('negativeAssertionId', neg.id, 'predicate', pos.predicate, 'role', pos.role),
       greatest(pos.updated_at, neg.updated_at)
FROM assertions pos
JOIN assertions neg ON neg.predicate = pos.predicate AND neg.role IS NOT DISTINCT FROM pos.role
  AND neg.subject_company_id IS NOT DISTINCT FROM pos.subject_company_id
  AND neg.object_company_id IS NOT DISTINCT FROM pos.object_company_id
  AND neg.object_project_id IS NOT DISTINCT FROM pos.object_project_id
  AND coalesce(neg.scope_building, '') = coalesce(pos.scope_building, '')
  AND neg.polarity = 'negative'
WHERE pos.polarity = 'positive' AND pos.predicate IN ('participates_in_project', 'contract', 'corporate_relation')
  AND pos.status <> 'rejected' AND neg.status <> 'rejected'
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = pos.id AND e.status = 'active' AND e.stance = 'supports')
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = neg.id AND e.status = 'active' AND e.stance = 'supports')
UNION ALL
SELECT 2, 'role_period_conflict', a.id, a.id,
       jsonb_build_object('otherAssertionId', b.id, 'role', a.role, 'projectId', a.object_project_id,
                          'building', a.scope_building),
       greatest(a.updated_at, b.updated_at)
FROM assertions a
JOIN assertions b ON b.predicate = 'participates_in_project' AND b.role = a.role
  AND b.object_project_id = a.object_project_id AND coalesce(b.scope_building, '') = coalesce(a.scope_building, '')
  AND b.subject_company_id <> a.subject_company_id AND b.id > a.id
  AND b.polarity = 'positive' AND b.modality IN ('reported_fact', 'unknown')
  -- Периоды пересекаются или неизвестны: два генподрядчика одного корпуса в одно время — вопрос, а не факт.
  AND (a.valid_from IS NULL OR b.valid_to IS NULL OR a.valid_from <= b.valid_to)
  AND (b.valid_from IS NULL OR a.valid_to IS NULL OR b.valid_from <= a.valid_to)
WHERE a.predicate = 'participates_in_project' AND a.role IN ('customer', 'general_contractor')
  AND a.polarity = 'positive' AND a.modality IN ('reported_fact', 'unknown')
  AND a.status <> 'rejected' AND b.status <> 'rejected'
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports')
  AND EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = b.id AND e.status = 'active' AND e.stance = 'supports')
UNION ALL
SELECT 3, 'correction', a.id, a.id, jsonb_build_object('status', a.status), a.updated_at
FROM assertions a
WHERE a.needs_revalidation
UNION ALL
SELECT 4, 'dispute', a.id, a.id,
       jsonb_build_object('status', a.status,
                          'contradicts', (SELECT count(*) FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'contradicts')),
       a.updated_at
FROM assertions a
WHERE NOT a.needs_revalidation
  AND (a.status = 'disputed'
       OR EXISTS (SELECT 1 FROM evidence e WHERE e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'contradicts'));
