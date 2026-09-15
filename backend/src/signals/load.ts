// Загрузка входа сигналов на срез. Всё, что записано позже cutoff, не учитывается: одинаковые данные и
// одинаковый срез дают одинаковый снимок. Ограничение: смена статуса доказательства после среза
// (отзыв, замещение) на прошлый срез не восстанавливается — используется текущий статус.

import type { DbExecutor } from '../db/pool.js';
import type { ICompanySignalInput, ISignalAssertion, ISignalPublication } from './types.js';

type IAssertionRow = Omit<ISignalAssertion, 'evidence'>;

export const loadCompanyInputs = async (exec: DbExecutor, companyIds: readonly number[], cutoff: Date): Promise<ICompanySignalInput[]> => {
  if (companyIds.length === 0) return [];
  const ids = [...companyIds];

  const base = (
    await exec.query<{ id: number; entity_type: string | null; aliases: number; ambiguities: number; merges: number; legacy_participations: number; legacy_events: number }>(
      `SELECT c.id, c.entity_type,
              (SELECT count(*)::int FROM entity_aliases a WHERE a.entity_kind = 'company' AND a.entity_id = c.id) AS aliases,
              (SELECT count(*)::int FROM resolution_ambiguities r
                WHERE r.entity_kind = 'company' AND r.status = 'open' AND c.id = ANY(r.candidate_ids) AND r.created_at <= $2) AS ambiguities,
              (SELECT count(*)::int FROM merge_queue q
                WHERE q.entity_kind = 'company' AND q.status = 'pending' AND c.id IN (q.source_entity_id, q.target_entity_id)
                  AND q.created_at <= $2) AS merges,
              (SELECT count(*)::int FROM project_participants pp
                WHERE pp.company_id = c.id
                  AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.legacy_kind = 'project_participant' AND e.legacy_id = pp.id)) AS legacy_participations,
              (SELECT count(*)::int FROM events ev
                WHERE (ev.company_id = c.id OR ev.counterparty_id = c.id)
                  AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.legacy_kind = 'event' AND e.legacy_id = ev.id)) AS legacy_events
       FROM companies c WHERE c.id = ANY($1::bigint[]) ORDER BY c.id`,
      [ids, cutoff],
    )
  ).rows;

  const identifiers = (
    await exec.query<{ company_id: number; type: string; validation_status: string }>(
      `SELECT company_id, identifier_type AS type, validation_status FROM entity_identifiers
       WHERE company_id = ANY($1::bigint[]) AND status = 'active' AND created_at <= $2 ORDER BY id`,
      [ids, cutoff],
    )
  ).rows;

  const assertions = (
    await exec.query<IAssertionRow>(
      `SELECT a.id, a.predicate, a.role, a.event_type AS "eventType", a.status::text AS status, a.origin,
              a.needs_revalidation AS "needsRevalidation", a.polarity, a.modality::text AS modality,
              a.subject_company_id AS "subjectCompanyId", a.subject_project_id AS "subjectProjectId",
              a.object_company_id AS "objectCompanyId", a.object_project_id AS "objectProjectId",
              a.counterparty_company_id AS "counterpartyCompanyId", a.context_project_id AS "contextProjectId",
              a.scope_building AS "scopeBuilding", a.work_package AS "workPackage", a.work_package_label AS "workPackageLabel",
              a.valid_from::text AS "validFrom", a.valid_to::text AS "validTo", a.period_precision AS "periodPrecision",
              a.case_number AS "caseNumber", a.procedural_role AS "proceduralRole", a.counterparty_role AS "counterpartyRole",
              a.event_stage AS "eventStage", a.event_outcome AS "eventOutcome", a.value_type AS "valueType",
              a.value_numeric::text AS "valueNumeric", a.value_currency AS "valueCurrency"
       FROM assertions a
       WHERE (a.subject_company_id = ANY($1::bigint[]) OR a.object_company_id = ANY($1::bigint[]) OR a.counterparty_company_id = ANY($1::bigint[]))
         AND a.created_at <= $2
       ORDER BY a.id`,
      [ids, cutoff],
    )
  ).rows;

  const evidence = (
    await exec.query<{ assertion_id: number; id: number; stance: 'supports' | 'contradicts' | 'mentions'; source_item_id: number }>(
      `SELECT e.assertion_id, e.id, e.stance::text AS stance, r.source_item_id
       FROM evidence e JOIN document_revisions r ON r.id = e.revision_id
       WHERE e.assertion_id = ANY($1::bigint[]) AND e.status = 'active' AND e.created_at <= $2
       ORDER BY e.id`,
      [assertions.map(a => a.id), cutoff],
    )
  ).rows;

  const itemIds = [...new Set(evidence.map(e => e.source_item_id))];
  const publications = (
    await exec.query<ISignalPublication>(
      `SELECT si.id AS "sourceItemId", s.key AS "sourceKey",
              to_char(coalesce(si.published_at, lr.published_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "publishedAt",
              lr.completeness::text AS completeness, encode(lr.dedup_hash, 'hex') AS "dedupHash",
              (SELECT o.forward_origin FROM source_observations o
                WHERE o.source_item_id = si.id AND o.forward_origin IS NOT NULL AND o.observed_at <= $2
                ORDER BY o.id LIMIT 1) AS "forwardOrigin",
              (SELECT count(*)::int FROM source_observations o WHERE o.source_item_id = si.id AND o.observed_at <= $2) AS observations
       FROM source_items si
       JOIN sources s ON s.id = si.source_id
       JOIN LATERAL (
         SELECT r.published_at, r.completeness, r.dedup_hash FROM document_revisions r
         WHERE r.source_item_id = si.id AND r.first_observed_at <= $2
         ORDER BY r.revision_no DESC LIMIT 1
       ) lr ON true
       WHERE si.id = ANY($1::bigint[]) AND si.first_observed_at <= $2
       ORDER BY si.id`,
      [itemIds, cutoff],
    )
  ).rows;
  const pubById = new Map(publications.map(p => [p.sourceItemId, p]));

  const evidenceByAssertion = new Map<number, ISignalAssertion['evidence']>();
  for (const e of evidence) {
    if (!pubById.has(e.source_item_id)) continue;
    evidenceByAssertion.set(e.assertion_id, [...(evidenceByAssertion.get(e.assertion_id) ?? []), { id: e.id, stance: e.stance, sourceItemId: e.source_item_id }]);
  }

  return base.map(c => {
    const own = assertions
      .filter(a => a.subjectCompanyId === c.id || a.objectCompanyId === c.id || a.counterpartyCompanyId === c.id)
      .map(a => ({ ...a, evidence: evidenceByAssertion.get(a.id) ?? [] }));
    const items = new Set(own.flatMap(a => a.evidence.map(e => e.sourceItemId)));
    return {
      companyId: c.id,
      entityType: c.entity_type,
      identifiers: identifiers.filter(i => i.company_id === c.id).map(i => ({ type: i.type, validationStatus: i.validation_status })),
      aliases: c.aliases,
      openAmbiguities: c.ambiguities,
      pendingMerges: c.merges,
      legacyUnimported: { participations: c.legacy_participations, events: c.legacy_events },
      assertions: own,
      publications: [...items].map(i => pubById.get(i)!).filter(Boolean),
    };
  });
};
