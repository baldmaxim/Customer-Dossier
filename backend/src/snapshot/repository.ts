// Снимки досье: создание, чтение с проверкой целостности и текущей доступности, вымарывание фрагмента.

import { getPool, withTransaction } from '../db/pool.js';
import { applyAvailability, loadAvailability, redactEvidence, type IAvailability } from './availability.js';
import { buildSnapshotPayload, HistoricalCutoffError, SNAPSHOT_SCHEMA_VERSION, type ISnapshotPayload } from './build.js';
import { HASH_ALGORITHM, payloadHash } from './canonical.js';
import type { ISnapshotMeta } from './export.js';

export class SnapshotNotFoundError extends Error {
  constructor(what = 'Снимок') {
    super(`${what} не найден`);
    this.name = 'SnapshotNotFoundError';
  }
}

export interface ISnapshotListItem {
  id: number;
  caseId: number;
  caseVersion: number;
  generatedAt: string;
  knowledgeCutoff: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  rulesVersion: string;
  templateVersion: string;
  payloadHash: string;
  redactions: number;
}

export interface ISnapshotView {
  meta: ISnapshotMeta & { schemaVersion: string; knowledgeCutoff: string; effectiveFrom: string | null; effectiveTo: string | null; caseVersion: number };
  integrity: { algorithm: string; storedHash: string; computedHash: string; verified: boolean };
  availability: IAvailability;
  redactions: Array<{ evidenceId: number; reason: string; actor: string; redactedAt: string }>;
  payload: ISnapshotPayload;
}

export const createSnapshot = async (input: {
  caseId: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  knowledgeCutoff: string | null;
  idempotencyKey: string | null;
  actor: string;
  now?: Date;
}): Promise<{ id: number; replayed: boolean; payloadHash: string }> => {
  const now = input.now ?? new Date();
  // Срез знаний на прошлую дату не создаётся: нет полной истории статусов, решений и доказательств.
  if (input.knowledgeCutoff !== null && new Date(input.knowledgeCutoff).getTime() < now.getTime() - 60_000) throw new HistoricalCutoffError();

  return withTransaction(async client => {
    // Снимок строится на согласованном чтении одной транзакции (уровень задаётся первой командой).
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    if (input.idempotencyKey) {
      const prior = (
        await client.query<{ id: number; payload_hash: string }>('SELECT id, payload_hash FROM dossier_snapshots WHERE idempotency_key = $1', [input.idempotencyKey])
      ).rows[0];
      if (prior) return { id: prior.id, replayed: true, payloadHash: prior.payload_hash };
    }
    const payload = await buildSnapshotPayload(client, input.caseId, { effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, now });
    if (!payload) throw new SnapshotNotFoundError('Обращение');
    const hash = payloadHash(payload);
    const id = (
      await client.query<{ id: number }>(
        `INSERT INTO dossier_snapshots
           (case_id, case_version, schema_version, rules_version, template_version, generated_at, knowledge_cutoff,
            effective_from, effective_to, payload, payload_hash, hash_algorithm, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [
          input.caseId,
          payload.case.version,
          SNAPSHOT_SCHEMA_VERSION,
          payload.versions.signalsRules,
          payload.versions.template,
          now,
          input.effectiveFrom,
          input.effectiveTo,
          JSON.stringify(payload),
          hash,
          HASH_ALGORITHM,
          input.actor,
          input.idempotencyKey,
        ],
      )
    ).rows[0]!.id;
    return { id, replayed: false, payloadHash: hash };
  });
};

export const listSnapshots = async (caseId: number): Promise<ISnapshotListItem[]> =>
  (
    await getPool().query<ISnapshotListItem>(
      `SELECT s.id, s.case_id AS "caseId", s.case_version AS "caseVersion", s.generated_at AS "generatedAt",
              s.knowledge_cutoff AS "knowledgeCutoff", s.effective_from::text AS "effectiveFrom", s.effective_to::text AS "effectiveTo",
              s.rules_version AS "rulesVersion", s.template_version AS "templateVersion", s.payload_hash AS "payloadHash",
              (SELECT count(*)::int FROM dossier_snapshot_redactions r WHERE r.snapshot_id = s.id) AS redactions
       FROM dossier_snapshots s WHERE s.case_id = $1 ORDER BY s.id DESC LIMIT 100`,
      [caseId],
    )
  ).rows;

/** Снимок для показа и экспорта: хранимый payload проверен hash, цитаты недоступных сейчас источников скрыты. */
export const readSnapshot = async (id: number, now: Date = new Date()): Promise<ISnapshotView | null> => {
  const pool = getPool();
  const row = (
    await pool.query<{
      id: number;
      case_id: number;
      case_version: number;
      schema_version: string;
      generated_at: Date;
      knowledge_cutoff: Date;
      effective_from: string | null;
      effective_to: string | null;
      payload: ISnapshotPayload;
      payload_hash: string;
      hash_algorithm: string;
    }>(
      `SELECT id, case_id, case_version, schema_version, generated_at, knowledge_cutoff, effective_from::text, effective_to::text,
              payload, payload_hash, hash_algorithm
       FROM dossier_snapshots WHERE id = $1`,
      [id],
    )
  ).rows[0];
  if (!row) return null;
  const computed = payloadHash(row.payload);
  const availability = await loadAvailability(pool, row.payload, now);
  const redactions = (
    await pool.query<{ evidenceId: number; reason: string; actor: string; redactedAt: string }>(
      `SELECT evidence_id AS "evidenceId", reason, actor, redacted_at AS "redactedAt" FROM dossier_snapshot_redactions WHERE snapshot_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;
  return {
    meta: {
      id: row.id,
      caseId: row.case_id,
      caseVersion: row.case_version,
      schemaVersion: row.schema_version,
      generatedAt: row.generated_at.toISOString(),
      knowledgeCutoff: row.knowledge_cutoff.toISOString(),
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      payloadHash: row.payload_hash,
      hashAlgorithm: row.hash_algorithm,
    },
    integrity: { algorithm: row.hash_algorithm, storedHash: row.payload_hash, computedHash: computed, verified: computed === row.payload_hash },
    availability,
    redactions,
    payload: applyAvailability(row.payload, availability),
  };
};

/**
 * Обязательное удаление фрагмента: цитата заменяется пометкой в хранимом payload, hash пересчитывается,
 * старый и новый hash записываются в журнал. Остальное содержание снимка не меняется.
 */
export const redactSnapshotEvidence = async (input: { snapshotId: number; evidenceId: number; reason: string; actor: string }): Promise<{ hashBefore: string; hashAfter: string; replayed: boolean }> =>
  withTransaction(async client => {
    const row = (
      await client.query<{ payload: ISnapshotPayload; payload_hash: string }>('SELECT payload, payload_hash FROM dossier_snapshots WHERE id = $1 FOR UPDATE', [input.snapshotId])
    ).rows[0];
    if (!row) throw new SnapshotNotFoundError();
    const prior = (
      await client.query<{ hash_before: string; hash_after: string }>('SELECT hash_before, hash_after FROM dossier_snapshot_redactions WHERE snapshot_id = $1 AND evidence_id = $2', [input.snapshotId, input.evidenceId])
    ).rows[0];
    if (prior) return { hashBefore: prior.hash_before, hashAfter: prior.hash_after, replayed: true };
    const { payload, found } = redactEvidence(row.payload, input.evidenceId);
    if (!found) throw new SnapshotNotFoundError('Фрагмент в снимке');
    const hashAfter = payloadHash(payload);
    await client.query(`SELECT set_config('tg_info.snapshot_redaction', 'on', true)`);
    await client.query('UPDATE dossier_snapshots SET payload = $2, payload_hash = $3 WHERE id = $1', [input.snapshotId, JSON.stringify(payload), hashAfter]);
    await client.query(`SELECT set_config('tg_info.snapshot_redaction', 'off', true)`);
    await client.query(
      `INSERT INTO dossier_snapshot_redactions (snapshot_id, evidence_id, reason, actor, hash_before, hash_after) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.snapshotId, input.evidenceId, input.reason, input.actor, row.payload_hash, hashAfter],
    );
    return { hashBefore: row.payload_hash, hashAfter, replayed: false };
  });
