// Предпросмотр и публикация набора кандидатов публикации.
//
// Публикация — одна транзакция: указатель item_publications, утверждения,
// доказательства, снятие оснований прежнего набора, статусы наборов и история.
// Читатель видит либо весь старый, либо весь новый набор.
//
// Снимается только вклад этого же набора этой публикации (superseded, строки
// остаются). Решения аналитика и доказательства других документов не
// трогаются; компания не удаляется. reviewed_supported машина не выставляет —
// статус утверждения выводится из доказательств и решений человека.

import type { PoolClient } from 'pg';

import { getPool, withTransaction, type DbExecutor } from '../db/pool.js';
import { eventQuoteDiscriminator, type IAssertionContent } from '../assertions/model.js';
import { addEvidence, refreshAssertionState, upsertAssertion } from '../assertions/repository.js';
import { sliceByCodePoints } from '../assertions/span.js';
import { resolveCompany } from '../resolve/company.js';
import { normalizeName } from '../resolve/normalize.js';
import { resolveProject, type ProjectKind, type ProjectStage } from '../resolve/project.js';
import type { ICandidateContent, IEvidenceCandidate } from './candidates.js';
import { loadRevisionPolicy } from './runs.js';
import type { PartyDescriptor } from './runs.js';

export class PublicationConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Публикация изменилась после предпросмотра (другой запуск или оператор). Обновите предпросмотр.');
    this.name = 'PublicationConflictError';
  }
}

export class NotPublishableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'NotPublishableError';
  }
}

type StoredContent = ICandidateContent & { parties: Record<string, PartyDescriptor> };

interface ICandidateRow {
  id: number;
  content: StoredContent;
  evidence: IEvidenceCandidate[];
  grounded: boolean;
  confidence: number | null;
}

interface ISetRow {
  id: number;
  run_id: number;
  revision_id: number;
  source_item_id: number;
  relevant: boolean;
  status: string;
  revision_no: number;
}

const loadSet = async (exec: DbExecutor, setId: number, lock: boolean): Promise<ISetRow | null> =>
  (
    await exec.query<ISetRow>(
      `SELECT cs.id, cs.run_id, cs.revision_id, cs.source_item_id, cs.relevant, cs.status, r.revision_no
       FROM candidate_sets cs JOIN document_revisions r ON r.id = cs.revision_id
       WHERE cs.id = $1 ${lock ? 'FOR UPDATE OF cs' : ''}`,
      [setId],
    )
  ).rows[0] ?? null;

const loadCandidates = async (exec: DbExecutor, setId: number): Promise<ICandidateRow[]> =>
  (
    await exec.query<ICandidateRow>(
      'SELECT id, content, evidence, grounded, confidence FROM candidate_assertions WHERE set_id = $1 ORDER BY id',
      [setId],
    )
  ).rows;

const partyLabel = (content: StoredContent, ref: string | null): string => {
  if (!ref) return '';
  const party = content.parties[ref];
  return party ? `${party.kind}:${party.name}${party.taxId ? `#${party.taxId}` : ''}` : ref;
};

/** Смысловая подпись кандидата для сравнения наборов (без внутренних ref запуска). */
export const candidateSignature = ({ content, evidence }: Pick<ICandidateRow, 'content' | 'evidence'>): string =>
  [
    content.predicate,
    content.role ?? '',
    content.eventType ?? '',
    partyLabel(content, content.subjectRef),
    partyLabel(content, content.objectRef),
    partyLabel(content, content.counterpartyRef),
    content.validFrom ?? '',
    content.validTo ?? '',
    content.valueNumeric ?? '',
    // тот же различитель, что у утверждения: недоопределённые события сравниваются по цитате
    content.predicate === 'event' && !content.validFrom && !content.valueNumeric && !content.counterpartyRef && evidence[0]
      ? `#${eventQuoteDiscriminator(evidence[0].quote).slice(0, 8)}`
      : '',
  ].join('|');

/** Подпись без периода, значения и второй стороны: одна «линия» факта, у которой поменялись детали. */
const lineSignature = (content: StoredContent): string =>
  [content.predicate, content.role ?? '', content.eventType ?? '', partyLabel(content, content.subjectRef)].join('|');

export interface IStaleCheck {
  stale: boolean;
  reason: string | null;
}

interface IPublicationRow {
  active_set_id: number | null;
  version: number;
}

const loadPublication = async (exec: DbExecutor, sourceItemId: number, lock: boolean): Promise<IPublicationRow> =>
  (
    await exec.query<IPublicationRow>(
      `SELECT active_set_id, version FROM item_publications WHERE source_item_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [sourceItemId],
    )
  ).rows[0] ?? { active_set_id: null, version: 0 };

/**
 * Устаревший набор: опубликован более новый разбор (по номеру редакции, затем
 * по порядку запусков) или у публикации есть более новая редакция текста.
 */
const checkStale = async (exec: DbExecutor, set: ISetRow, activeSetId: number | null): Promise<IStaleCheck> => {
  if (activeSetId !== null && activeSetId !== set.id) {
    const active = await loadSet(exec, activeSetId, false);
    if (active && (active.revision_no > set.revision_no || (active.revision_no === set.revision_no && active.run_id > set.run_id))) {
      return { stale: true, reason: `опубликован более новый разбор (набор #${active.id}, запуск #${active.run_id})` };
    }
  }
  const newer = (
    await exec.query<{ revision_no: number }>(
      'SELECT max(revision_no) AS revision_no FROM document_revisions WHERE source_item_id = $1',
      [set.source_item_id],
    )
  ).rows[0];
  if (newer && newer.revision_no > set.revision_no) {
    return { stale: true, reason: `у публикации есть более новая редакция (№${newer.revision_no}), набор разобран по №${set.revision_no}` };
  }
  return { stale: false, reason: null };
};

export interface IPreviewItem {
  signature: string;
  predicate: string;
  grounded: boolean;
  quotes: string[];
}

export interface IPreview {
  setId: number;
  sourceItemId: number;
  status: string;
  relevant: boolean;
  activeSetId: number | null;
  expectedVersion: number;
  stale: IStaleCheck;
  policy: { allowed: boolean; reason: string | null };
  added: IPreviewItem[];
  removed: IPreviewItem[];
  kept: IPreviewItem[];
  /** Та же линия факта с другой стороной, периодом или суммой. */
  changed: Array<{ before: string; after: string }>;
  ungrounded: IPreviewItem[];
  /** Утверждения прежнего набора с решениями аналитика, которые потеряют это основание. */
  reviewImpact: Array<{ assertionId: number; status: string; decisions: number }>;
  /** Утверждения прежнего набора, у которых есть активные опровержения из других источников. */
  contradictions: Array<{ assertionId: number }>;
}

const toItem = (row: ICandidateRow): IPreviewItem => ({
  signature: candidateSignature(row),
  predicate: row.content.predicate,
  grounded: row.grounded,
  quotes: row.evidence.map(e => e.quote),
});

export const previewCandidateSet = async (setId: number, exec: DbExecutor = getPool()): Promise<IPreview> => {
  const set = await loadSet(exec, setId, false);
  if (!set) throw new NotPublishableError(`набор #${setId} не найден`);
  const publication = await loadPublication(exec, set.source_item_id, false);
  const policy = (await loadRevisionPolicy(exec, set.revision_id)) ?? { allowed: false, reason: 'редакция не найдена' };
  const stale = await checkStale(exec, set, publication.active_set_id);

  const next = await loadCandidates(exec, setId);
  const nextGrounded = next.filter(c => c.grounded);
  const prev =
    publication.active_set_id !== null && publication.active_set_id !== setId
      ? (await loadCandidates(exec, publication.active_set_id)).filter(c => c.grounded)
      : [];

  const prevBySig = new Map(prev.map(c => [candidateSignature(c), c]));
  const nextBySig = new Map(nextGrounded.map(c => [candidateSignature(c), c]));
  const added = nextGrounded.filter(c => !prevBySig.has(candidateSignature(c)));
  const removed = prev.filter(c => !nextBySig.has(candidateSignature(c)));
  const kept = nextGrounded.filter(c => prevBySig.has(candidateSignature(c)));

  const changed: IPreview['changed'] = [];
  for (const r of removed) {
    const line = lineSignature(r.content);
    const a = added.find(x => lineSignature(x.content) === line);
    if (a) changed.push({ before: candidateSignature(r), after: candidateSignature(a) });
  }

  const reviewImpact =
    publication.active_set_id !== null && publication.active_set_id !== setId
      ? (
          await exec.query<{ assertion_id: number; status: string; decisions: number }>(
            `SELECT a.id AS assertion_id, a.status::text AS status, count(rd.id)::int AS decisions
             FROM candidate_set_evidence cse
             JOIN evidence e ON e.id = cse.evidence_id AND e.status = 'active'
             JOIN assertions a ON a.id = e.assertion_id
             JOIN review_decisions rd ON rd.assertion_id = a.id
             WHERE cse.set_id = $1
             GROUP BY a.id, a.status`,
            [publication.active_set_id],
          )
        ).rows.map(r => ({ assertionId: r.assertion_id, status: r.status, decisions: r.decisions }))
      : [];

  const contradictions = (
    await exec.query<{ assertion_id: number }>(
      `SELECT DISTINCT e.assertion_id FROM evidence e
       WHERE e.status = 'active' AND e.stance = 'contradicts'
         AND e.assertion_id IN (
           SELECT e2.assertion_id FROM candidate_set_evidence cse JOIN evidence e2 ON e2.id = cse.evidence_id
           WHERE cse.set_id = $1)`,
      [publication.active_set_id ?? 0],
    )
  ).rows.map(r => ({ assertionId: r.assertion_id }));

  return {
    setId,
    sourceItemId: set.source_item_id,
    status: set.status,
    relevant: set.relevant,
    activeSetId: publication.active_set_id,
    expectedVersion: publication.version,
    stale,
    policy,
    added: added.map(toItem),
    removed: removed.map(toItem),
    kept: kept.map(toItem),
    changed,
    ungrounded: next.filter(c => !c.grounded).map(toItem),
    reviewImpact,
    contradictions,
  };
};

export type PublishOutcome = 'published' | 'already_published' | 'rejected_policy' | 'rejected_stale';

export interface IPublishResult {
  outcome: PublishOutcome;
  setId: number;
  version: number;
  reason: string | null;
  assertions: number;
  evidenceAdded: number;
  evidenceSuperseded: number;
}

export interface IPublishInput {
  setId: number;
  expectedVersion: number;
  actor: string;
  /** Отдельное решение оператора: опубликовать разбор, который новее не является. */
  allowStale?: boolean;
  /** Точка сбоя для интеграционных тестов: внутри транзакции, перед переключением указателя. */
  beforeCommit?: () => Promise<void>;
}

const writeHistory = async (
  client: PoolClient,
  row: { sourceItemId: number; from: number | null; to: number; action: string; actor: string; note: string | null },
): Promise<void> => {
  await client.query(
    `INSERT INTO publication_history (source_item_id, from_set_id, to_set_id, action, actor, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.sourceItemId, row.from, row.to, row.action, row.actor, row.note],
  );
};

/**
 * Сущность, уже разрешённая прежними публикациями этой же публикации источника.
 * Резолвер намеренно не склеивает одноимённые объекты с неизвестным городом, и
 * без этого каждая повторная публикация того же текста создавала бы новый объект.
 * Переиспользуется только ровно одна живая сущность с тем же ключом имени
 * (и тем же ИНН у компании) — это не слияние разных документов.
 */
const findPriorEntity = async (client: PoolClient, sourceItemId: number, party: PartyDescriptor): Promise<number | null> => {
  const key = normalizeName(party.name, party.kind).key;
  const rows =
    party.kind === 'company'
      ? (
          await client.query<{ id: number }>(
            `SELECT DISTINCT c.id FROM candidate_sets cs
             JOIN candidate_set_evidence cse ON cse.set_id = cs.id
             JOIN evidence e ON e.id = cse.evidence_id
             JOIN assertions a ON a.id = e.assertion_id
             JOIN companies c ON c.id IN (a.subject_company_id, a.object_company_id, a.counterparty_company_id)
             WHERE cs.source_item_id = $1 AND c.merged_into_id IS NULL
               AND c.name_key = $2 AND c.tax_id IS NOT DISTINCT FROM $3`,
            [sourceItemId, key, party.taxId],
          )
        ).rows
      : (
          await client.query<{ id: number }>(
            `SELECT DISTINCT p.id FROM candidate_sets cs
             JOIN candidate_set_evidence cse ON cse.set_id = cs.id
             JOIN evidence e ON e.id = cse.evidence_id
             JOIN assertions a ON a.id = e.assertion_id
             JOIN projects p ON p.id IN (a.subject_project_id, a.object_project_id)
             WHERE cs.source_item_id = $1 AND p.merged_into_id IS NULL
               AND p.name_key = $2 AND p.city IS NOT DISTINCT FROM $3`,
            [sourceItemId, key, party.city],
          )
        ).rows;
  return rows.length === 1 ? rows[0]!.id : null;
};

const PUBLISHABLE_STATUSES = new Set(['built', 'superseded', 'rejected_policy', 'rejected_stale']);

export const publishCandidateSet = async (input: IPublishInput): Promise<IPublishResult> =>
  withTransaction(async client => {
    const set = await loadSet(client, input.setId, true);
    if (!set) throw new NotPublishableError(`набор #${input.setId} не найден`);

    await client.query('INSERT INTO item_publications (source_item_id) VALUES ($1) ON CONFLICT DO NOTHING', [
      set.source_item_id,
    ]);
    const publication = await loadPublication(client, set.source_item_id, true);
    const base = { setId: set.id, assertions: 0, evidenceAdded: 0, evidenceSuperseded: 0 };

    // Повтор того же apply: набор уже активен — прежний результат, без записи.
    if (publication.active_set_id === set.id) {
      return { ...base, outcome: 'already_published', version: publication.version, reason: null };
    }
    if (!PUBLISHABLE_STATUSES.has(set.status)) {
      throw new NotPublishableError(`набор #${set.id} в статусе ${set.status} не публикуется`);
    }
    if (publication.version !== input.expectedVersion) throw new PublicationConflictError(publication.version);

    const policy = (await loadRevisionPolicy(client, set.revision_id)) ?? { allowed: false, reason: 'редакция не найдена' };
    if (!policy.allowed) {
      // Кандидат сохраняется технически, но вопреки политике не публикуется.
      await client.query(`UPDATE candidate_sets SET status = 'rejected_policy', status_reason = $2 WHERE id = $1`, [
        set.id,
        policy.reason,
      ]);
      await writeHistory(client, {
        sourceItemId: set.source_item_id,
        from: publication.active_set_id,
        to: set.id,
        action: 'rejected_policy',
        actor: input.actor,
        note: policy.reason,
      });
      return { ...base, outcome: 'rejected_policy', version: publication.version, reason: policy.reason };
    }

    const stale = await checkStale(client, set, publication.active_set_id);
    if (stale.stale && !input.allowStale) {
      await client.query(`UPDATE candidate_sets SET status = 'rejected_stale', status_reason = $2 WHERE id = $1`, [
        set.id,
        stale.reason,
      ]);
      await writeHistory(client, {
        sourceItemId: set.source_item_id,
        from: publication.active_set_id,
        to: set.id,
        action: 'rejected_stale',
        actor: input.actor,
        note: stale.reason,
      });
      return { ...base, outcome: 'rejected_stale', version: publication.version, reason: stale.reason };
    }

    const revision = (
      await client.query<{ body: string; legacy_document_id: number | null }>(
        'SELECT body, legacy_document_id FROM document_revisions WHERE id = $1',
        [set.revision_id],
      )
    ).rows[0]!;

    const candidates = (await loadCandidates(client, set.id)).filter(c => c.grounded);
    const companyIds = new Map<string, number | null>();
    const projectIds = new Map<string, number | null>();

    const resolveParty = async (content: StoredContent, ref: string | null): Promise<{ kind: string; id: number } | null> => {
      if (!ref) return null;
      const party = content.parties[ref];
      if (!party) return null;
      if (party.kind === 'company') {
        if (!companyIds.has(ref)) {
          const prior = await findPriorEntity(client, set.source_item_id, party);
          if (prior !== null) companyIds.set(ref, prior);
        }
        if (!companyIds.has(ref)) {
          const resolved = await resolveCompany(client, {
            surface: party.name,
            legalForm: party.legalForm,
            taxId: party.taxId,
            city: null,
            documentId: revision.legacy_document_id,
            revisionId: set.revision_id,
          });
          companyIds.set(ref, resolved?.companyId ?? null);
        }
        const id = companyIds.get(ref);
        return id ? { kind: 'company', id } : null;
      }
      if (!projectIds.has(ref)) {
        const prior = await findPriorEntity(client, set.source_item_id, party);
        if (prior !== null) projectIds.set(ref, prior);
      }
      if (!projectIds.has(ref)) {
        const resolved = await resolveProject(client, {
          surface: party.name,
          kind: (party.projectKind ?? undefined) as ProjectKind | undefined,
          stage: (party.projectStage ?? undefined) as ProjectStage | undefined,
          city: party.city,
          address: party.address,
          documentId: revision.legacy_document_id,
          revisionId: set.revision_id,
        });
        projectIds.set(ref, resolved?.projectId ?? null);
      }
      const id = projectIds.get(ref);
      return id ? { kind: 'project', id } : null;
    };

    const newEvidenceIds = new Set<number>();
    const touchedAssertions = new Set<number>();
    let evidenceAdded = 0;
    let assertionCount = 0;

    for (const candidate of candidates) {
      const c = candidate.content;
      const subject = await resolveParty(c, c.subjectRef);
      if (!subject) continue; // сторона не разрешилась (мусорное имя) — утверждение не публикуется
      const object = await resolveParty(c, c.objectRef);
      if (c.objectRef && !object) continue;
      const counterparty = await resolveParty(c, c.counterpartyRef);

      const content: IAssertionContent = {
        predicate: c.predicate,
        role: c.role,
        eventType: c.eventType,
        subjectCompanyId: subject.kind === 'company' ? subject.id : null,
        subjectProjectId: subject.kind === 'project' ? subject.id : null,
        subjectText: null,
        objectCompanyId: object?.kind === 'company' ? object.id : null,
        objectProjectId: object?.kind === 'project' ? object.id : null,
        objectText: null,
        counterpartyCompanyId: counterparty?.kind === 'company' ? counterparty.id : null,
        scopeBuilding: null,
        workPackage: null,
        validFrom: c.validFrom,
        validTo: c.validTo,
        periodPrecision: c.periodPrecision,
        modality: c.modality,
        valueType: c.valueType,
        valueNumeric: c.valueNumeric,
        valueCurrency: c.valueCurrency,
        // Событие без даты, суммы и контрагента различается своей цитатой: два суда — два утверждения.
        eventDiscriminator:
          c.predicate === 'event' && !c.validFrom && !c.valueNumeric && !c.counterpartyRef && candidate.evidence[0]
            ? eventQuoteDiscriminator(candidate.evidence[0].quote)
            : null,
      };
      const assertion = await upsertAssertion(client, content, {
        origin: 'extraction',
        confidenceExtraction: candidate.confidence,
        confidenceIdentity: null,
      });
      assertionCount += 1;
      touchedAssertions.add(assertion.id);

      for (const ev of candidate.evidence) {
        const span = sliceByCodePoints(revision.body, { start: ev.spanStart, end: ev.spanEnd });
        if (!span || span.quote !== ev.quote) continue; // диапазон не совпал с редакцией — не пишем
        const added = await addEvidence(client, {
          assertionId: assertion.id,
          revisionId: set.revision_id,
          stance: ev.stance,
          span,
          origin: 'extraction',
          extractionId: null,
          legacyKind: null,
          legacyId: null,
          extractionChunkId: ev.chunkId,
        });
        if (added.created) evidenceAdded += 1;
        newEvidenceIds.add(added.id);
        await client.query('INSERT INTO candidate_set_evidence (set_id, evidence_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
          set.id,
          added.id,
        ]);
      }
    }

    // Снятие оснований прежнего набора, которых нет в новом. Только свои строки, только статус.
    let evidenceSuperseded = 0;
    if (publication.active_set_id !== null) {
      const dropped = (
        await client.query<{ id: number; assertion_id: number }>(
          `SELECT e.id, e.assertion_id FROM candidate_set_evidence cse
           JOIN evidence e ON e.id = cse.evidence_id
           WHERE cse.set_id = $1 AND e.status = 'active'`,
          [publication.active_set_id],
        )
      ).rows.filter(r => !newEvidenceIds.has(r.id));
      for (const row of dropped) {
        await client.query(
          `UPDATE evidence SET status = 'superseded', status_reason = $2, status_changed_at = now() WHERE id = $1`,
          [row.id, `замещено набором #${set.id}`],
        );
        touchedAssertions.add(row.assertion_id);
        evidenceSuperseded += 1;
      }
      await client.query(`UPDATE candidate_sets SET status = 'superseded', status_reason = $2 WHERE id = $1`, [
        publication.active_set_id,
        `замещён набором #${set.id}`,
      ]);
    }
    for (const id of touchedAssertions) await refreshAssertionState(client, id);

    if (input.beforeCommit) await input.beforeCommit();

    await client.query(
      `UPDATE candidate_sets SET status = 'published', status_reason = $2, published_at = now() WHERE id = $1`,
      [set.id, stale.stale ? `опубликован отдельным решением: ${stale.reason}` : null],
    );
    const version = (
      await client.query<{ version: number }>(
        `UPDATE item_publications SET active_set_id = $2, version = version + 1, updated_at = now()
         WHERE source_item_id = $1 RETURNING version`,
        [set.source_item_id, set.id],
      )
    ).rows[0]!.version;
    await writeHistory(client, {
      sourceItemId: set.source_item_id,
      from: publication.active_set_id,
      to: set.id,
      action: 'publish',
      actor: input.actor,
      note: stale.stale ? `allowStale: ${stale.reason}` : null,
    });

    return {
      setId: set.id,
      outcome: 'published',
      version,
      reason: null,
      assertions: assertionCount,
      evidenceAdded,
      evidenceSuperseded,
    };
  });
