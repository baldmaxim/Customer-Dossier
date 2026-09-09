// Перенос проверенного извлечения в канонический слой.
//
// Всё содержимое одного документа пишется одной транзакцией: половина
// упоминаний без ролей или события без участников — состояние, из которого
// непонятно, что переизвлекать.
//
// Порядок важен: сначала компании (нужны их id для co-occurrence при резолвинге
// объектов), затем объекты, затем связи, упоминания и события.

import type { PoolClient } from 'pg';

import { resolveCompany } from '../resolve/company.js';
import { resolveProject } from '../resolve/project.js';
import { CONFIDENCE_THRESHOLDS, type IVerificationResult } from './verify.js';

export interface IApplyInput {
  documentId: number;
  extractionId: number;
  publishedAt: Date;
  verified: IVerificationResult;
}

export interface IApplyStats {
  companies: number;
  projects: number;
  mentions: number;
  participants: number;
  events: number;
  queuedMerges: number;
  /** Отброшено порогами уверенности (не путать с отбраковкой в verify). */
  belowThreshold: number;
}

const emptyStats = (): IApplyStats => ({
  companies: 0,
  projects: 0,
  mentions: 0,
  participants: 0,
  events: 0,
  queuedMerges: 0,
  belowThreshold: 0,
});

export const applyExtraction = async (
  client: PoolClient,
  input: IApplyInput,
): Promise<IApplyStats> => {
  const stats = emptyStats();
  const { verified, documentId, extractionId, publishedAt } = input;

  if (!verified.relevant) return stats;

  // --- Компании ---
  const companyIdByName = new Map<string, number>();

  for (const company of verified.companies) {
    if (company.confidenceFinal < CONFIDENCE_THRESHOLDS.mention) {
      stats.belowThreshold += 1;
      continue;
    }

    const resolved = await resolveCompany(client, {
      surface: company.name,
      legalForm: company.legal_form ?? null,
      bin: company.binAccepted,
      city: null,
      documentId,
    });
    if (!resolved) continue;

    companyIdByName.set(company.name, resolved.companyId);
    if (resolved.method === 'created' || resolved.method === 'created_queued') stats.companies += 1;
    if (resolved.queued) stats.queuedMerges += 1;

    await insertMention(client, {
      documentId,
      extractionId,
      entityKind: 'company',
      entityId: resolved.companyId,
      surfaceForm: company.name,
      role: company.role === 'unknown' ? null : company.role,
      quote: company.quote,
      quoteVerified: company.quoteVerified,
      sentiment: company.sentiment,
      confidence: company.confidenceFinal,
      publishedAt,
    });
    stats.mentions += 1;
  }

  // --- Объекты ---
  const projectIdByName = new Map<string, number>();
  const relatedCompanyIds = [...companyIdByName.values()];

  for (const project of verified.projects) {
    if (project.confidenceFinal < CONFIDENCE_THRESHOLDS.mention) {
      stats.belowThreshold += 1;
      continue;
    }

    const resolved = await resolveProject(client, {
      surface: project.name,
      kind: project.kind,
      stage: project.stage,
      city: project.city ?? null,
      address: project.address ?? null,
      relatedCompanyIds,
      documentId,
    });
    if (!resolved) continue;

    projectIdByName.set(project.name, resolved.projectId);
    if (resolved.method === 'created' || resolved.method === 'created_queued') stats.projects += 1;
    if (resolved.queued) stats.queuedMerges += 1;

    // Стадия объекта обновляется только вперёд по жизненному циклу: старая
    // новость не должна вернуть сданный дом обратно в «строится».
    await advanceProjectStage(client, resolved.projectId, project.stage);

    await insertMention(client, {
      documentId,
      extractionId,
      entityKind: 'project',
      entityId: resolved.projectId,
      surfaceForm: project.name,
      role: null,
      quote: project.quote,
      quoteVerified: project.quoteVerified,
      sentiment: 'neutral',
      confidence: project.confidenceFinal,
      publishedAt,
    });
    stats.mentions += 1;
  }

  // --- Роли на объектах ---
  for (const link of verified.links) {
    if (link.confidenceFinal < CONFIDENCE_THRESHOLDS.participant) {
      stats.belowThreshold += 1;
      continue;
    }
    const companyId = companyIdByName.get(link.company);
    const projectId = projectIdByName.get(link.project);
    if (companyId === undefined || projectId === undefined) continue;

    const res = await client.query(
      `INSERT INTO project_participants
         (project_id, company_id, role, confidence, evidence_document_id, is_current)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (project_id, company_id, role) WHERE ended_on IS NULL
       DO UPDATE SET
         -- уверенность только растёт: одно неуверенное упоминание не должно
         -- обесценить связь, подтверждённую раньше твёрдым источником
         confidence = greatest(project_participants.confidence, EXCLUDED.confidence),
         updated_at = now()`,
      [projectId, companyId, link.role, link.confidenceFinal, documentId],
    );
    if ((res.rowCount ?? 0) > 0) stats.participants += 1;
  }

  // --- События ---
  for (const event of verified.events) {
    if (event.confidenceFinal < CONFIDENCE_THRESHOLDS.event) {
      stats.belowThreshold += 1;
      continue;
    }

    const companyId = event.company ? (companyIdByName.get(event.company) ?? null) : null;
    const counterpartyId = event.counterparty
      ? (companyIdByName.get(event.counterparty) ?? null)
      : null;
    const projectId = event.project ? (projectIdByName.get(event.project) ?? null) : null;
    if (companyId === null && projectId === null) continue;

    const res = await client.query(
      `INSERT INTO events
         (type, occurred_on, project_id, company_id, counterparty_id, severity,
          amount_kzt, document_id, extraction_id, quote, confidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'auto')
       ON CONFLICT (document_id, type, coalesce(project_id, 0), coalesce(company_id, 0))
       DO NOTHING`,
      [
        event.type,
        event.occurredOn,
        projectId,
        companyId,
        counterpartyId,
        severityOf(event.type),
        event.amountKzt,
        documentId,
        extractionId,
        event.quote,
        event.confidenceFinal,
      ],
    );
    if ((res.rowCount ?? 0) > 0) stats.events += 1;

    // Ввод в эксплуатацию — единственное событие, которое меняет факт о дате
    // сдачи, а не только ленту.
    if (event.type === 'commissioning' && projectId !== null && event.occurredOn) {
      await client.query(
        `UPDATE projects
         SET actual_completion = coalesce(actual_completion, $2), stage = 'commissioned', updated_at = now()
         WHERE id = $1`,
        [projectId, event.occurredOn],
      );
    }
  }

  await client.query(`UPDATE extractions SET applied_at = now() WHERE id = $1`, [extractionId]);
  await client.query(`UPDATE raw_documents SET status = 'extracted', updated_at = now() WHERE id = $1`, [
    documentId,
  ]);

  return stats;
};

interface IMentionInput {
  documentId: number;
  extractionId: number;
  entityKind: 'company' | 'project';
  entityId: number;
  surfaceForm: string;
  role: string | null;
  quote: string;
  quoteVerified: boolean;
  sentiment: string;
  confidence: number;
  publishedAt: Date;
}

const insertMention = async (client: PoolClient, m: IMentionInput): Promise<void> => {
  await client.query(
    `INSERT INTO mentions
       (document_id, extraction_id, entity_kind, entity_id, surface_form, role,
        quote, quote_verified, sentiment, confidence, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (document_id, entity_kind, entity_id, md5(quote)) DO NOTHING`,
    [
      m.documentId,
      m.extractionId,
      m.entityKind,
      m.entityId,
      m.surfaceForm,
      m.role,
      m.quote,
      m.quoteVerified,
      m.sentiment,
      m.confidence,
      m.publishedAt,
    ],
  );
};

/** Порядок стадий: назад по нему не откатываемся. */
const STAGE_ORDER: Record<string, number> = {
  unknown: 0,
  announced: 1,
  design: 2,
  construction: 3,
  suspended: 3,
  commissioned: 4,
  cancelled: 4,
};

const advanceProjectStage = async (
  client: PoolClient,
  projectId: number,
  stage: string,
): Promise<void> => {
  if (stage === 'unknown') return;
  const rank = STAGE_ORDER[stage] ?? 0;
  // suspended — исключение: приостановка это движение назад по смыслу, но
  // это свежий факт, и его надо отражать.
  const allowRegression = stage === 'suspended' || stage === 'cancelled';
  await client.query(
    `UPDATE projects SET stage = $2, updated_at = now()
     WHERE id = $1
       AND (
         $3::boolean
         OR coalesce(
              CASE stage
                WHEN 'unknown'      THEN 0
                WHEN 'announced'    THEN 1
                WHEN 'design'       THEN 2
                WHEN 'construction' THEN 3
                WHEN 'suspended'    THEN 3
                WHEN 'commissioned' THEN 4
                WHEN 'cancelled'    THEN 4
              END, 0
            ) < $4::int
       )`,
    [projectId, stage, allowRegression, rank],
  );
};

/** Насколько событие тяжёлое: влияет на сортировку в ленте карточки. */
const severityOf = (type: string): number => {
  if (type === 'bankruptcy' || type === 'license_revoked') return 3;
  if (type === 'court_case' || type === 'deadline_missed') return 2;
  if (type === 'delay' || type === 'contractor_change') return 1;
  return 0;
};
