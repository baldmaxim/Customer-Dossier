-- 019: обращения (DossierCase) — рабочий сценарий досье (этап 08A, ADR-010).
--
-- Обращение хранит то, что ввёл оператор: выбранное юрлицо (или «не установлено» с названием со слов),
-- объект и корпус, вид работ, заявленную роль и заявленную сторону договора, условия со слов, заметку.
-- Всё введённое — provenance operator_recorded_claim: это не утверждение и не доказательство, канон
-- не меняется. Установленная роль берётся из опубликованных утверждений при построении досье.
--
-- Версия — оптимистичная блокировка двух вкладок; каждая запись сохраняет неизменяемую версию целиком.

CREATE TABLE dossier_cases (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title                       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  -- identified — выбрано юрлицо из базы; unidentified — юрлицо не установлено, есть только название со слов.
  company_status              TEXT NOT NULL CHECK (company_status IN ('identified', 'unidentified')),
  company_id                  BIGINT REFERENCES companies(id),
  company_name_claimed        TEXT,
  project_id                  BIGINT REFERENCES projects(id),
  project_name_claimed        TEXT,
  scope_building              TEXT,
  work_package                TEXT,
  work_package_label          TEXT,
  claimed_role                TEXT CHECK (claimed_role IS NULL OR claimed_role IN
                              ('customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier', 'designer', 'investor', 'operator')),
  -- Кто, со слов обратившегося, заказывает эти работы.
  claimed_client_company_id   BIGINT REFERENCES companies(id),
  claimed_client_name         TEXT,
  -- Цена, аванс, условия — только как введено оператором со слов, без расчётов.
  claimed_terms               TEXT,
  request_date                DATE NOT NULL,
  operator_note               TEXT,
  status                      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  provenance                  TEXT NOT NULL DEFAULT 'operator_recorded_claim' CHECK (provenance = 'operator_recorded_claim'),
  version                     INT NOT NULL DEFAULT 1,
  created_by                  TEXT NOT NULL,
  idempotency_key             TEXT UNIQUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dossier_cases_company CHECK (
    (company_status = 'identified' AND company_id IS NOT NULL)
    OR (company_status = 'unidentified' AND company_id IS NULL AND company_name_claimed IS NOT NULL)
  )
);

CREATE INDEX dossier_cases_list_idx ON dossier_cases (status, updated_at DESC, id DESC);
CREATE INDEX dossier_cases_company_idx ON dossier_cases (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX dossier_cases_project_idx ON dossier_cases (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX dossier_cases_client_idx ON dossier_cases (claimed_client_company_id) WHERE claimed_client_company_id IS NOT NULL;

CREATE TABLE dossier_case_versions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES dossier_cases(id),
  version     INT NOT NULL,
  snapshot    JSONB NOT NULL,
  actor       TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

CREATE TRIGGER dossier_case_versions_append_only
  BEFORE UPDATE OR DELETE ON dossier_case_versions
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- Обращения не удаляются: закрываются статусом.
CREATE FUNCTION dossier_cases_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dossier_cases: удаление запрещено, закройте обращение' USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER dossier_cases_no_delete_trigger BEFORE DELETE ON dossier_cases
  FOR EACH ROW EXECUTE FUNCTION dossier_cases_no_delete();

-- Очередь проверки (017): отрицание роли без указания корпуса противоречит утверждению с корпусом.
-- Без этого досье показывает противоречие, а очередь проверки его не видит.
CREATE OR REPLACE VIEW review_queue_v AS
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
  -- Отрицание без корпуса относится ко всему объекту и противоречит утверждению о любом его корпусе.
  AND (neg.scope_building IS NULL OR coalesce(neg.scope_building, '') = coalesce(pos.scope_building, ''))
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
