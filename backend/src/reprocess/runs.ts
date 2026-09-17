// Запуски извлечения: постановка, захват с lease/fencing, ответы по чанкам,
// завершение с покрытием и сборка набора кандидатов.
//
// Правила:
//  - запуск неизменяем по смыслу: повтор провалившегося — новый run_id;
//  - транзакция не держится, пока модель отвечает: каждый ответ пишется своей
//    короткой транзакцией с проверкой fencing-токена;
//  - completed — только когда все чанки ok и объединение диапазонов покрыло весь текст;
//  - канон здесь не пишется: набор кандидатов публикуется отдельно (publish.ts);
//  - этап 11: запуск выполняется только исполнителем с той же идентичностью (provider.ts), иначе ни одного вызова
//    модели и статус blocked; перед каждым вызовом и повтором — действующий ИИ-допуск и своя аренда.
//
// Переходы статуса:
//   queued ─claim─▶ running ─все чанки ok, покрытие, допуск─▶ completed
//                    │ ├─ не все чанки ok ─▶ partial / failed
//                    │ ├─ допуск отозван (перед вызовом, в полёте, перед итогом) ─▶ cancelled (набора нет)
//                    │ ├─ идентичность исполнителя ≠ запуска ─▶ queued (lease снят, error = config_mismatch; вызовов 0)
//                    │ └─ аренда потеряна ─▶ StaleLeaseError, запись отвергнута (продолжает новый держатель)
//   failed/partial/cancelled, устаревшая конфигурация queued ─retryRun─▶ новый запуск (previous_run_id), прежний не меняется

import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { getPool, withTransaction, type DbExecutor } from '../db/pool.js';
import { approvedPolicySql, evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';
import type { IExtraction } from '../llm/schema.js';
import type { ISemanticExtraction } from '../llm/semantic/schema.js';
import { buildCandidates, type IAssertionCandidate, type IEntityCandidate } from './candidates.js';
import { computeCoverage, planCodePointChunks } from './chunking.js';
import { classifyExtractError, classifyExtractResult, type ChunkOutcome } from './extractOutcome.js';
import { buildFingerprint, defaultChunkerParams, type IChunkerParams, type IModelProvider } from './provider.js';

/** Новая попытка вызова модели запрещена текущим ИИ-допуском источника. */
export class PolicyRevokedError extends Error {
  constructor(readonly runId: number, readonly reason: string) {
    super(`запуск ${runId}: ИИ-допуск источника не действует — ${reason}`);
    this.name = 'PolicyRevokedError';
  }
}

/** Сколько раз запуск можно захватить (падения worker'а), прежде чем признать его провальным. */
export const MAX_CLAIMS = 3;
export const DEFAULT_LEASE_MS = 10 * 60_000;

export class StaleLeaseError extends Error {
  constructor(readonly runId: number) {
    super(`запуск ${runId}: lease потерян (запуск захвачен другим worker'ом или завершён) — запись отвергнута`);
    this.name = 'StaleLeaseError';
  }
}

export interface IRunClaim {
  runId: number;
  revisionId: number;
  fencingToken: number;
  owner: string;
  chunker: IChunkerParams;
  /** Отпечаток, с которым запуск поставлен. Исполнитель обязан совпасть с ним полностью. */
  fingerprint: string;
}

export type EnqueueResult =
  | { outcome: 'queued'; runId: number }
  | { outcome: 'already_live'; runId: number }
  | { outcome: 'refused_policy'; reason: string }
  | { outcome: 'not_found' };

interface ISourcePolicyRow {
  key: string;
  access_status: PermissionStatus;
  ai_processing_status: PermissionStatus;
  policy_expires_at: Date | null;
}

const POLICY_COLUMNS = 's.key, s.access_status, s.ai_processing_status, s.policy_expires_at';

export const loadRevisionPolicy = async (
  exec: DbExecutor,
  revisionId: number,
): Promise<{ allowed: boolean; reason: string | null } | null> => {
  const row = (
    await exec.query<ISourcePolicyRow>(
      `SELECT ${POLICY_COLUMNS}
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE r.id = $1`,
      [revisionId],
    )
  ).rows[0];
  if (!row) return null;
  return evaluateSourcePolicy(
    {
      key: row.key,
      accessStatus: row.access_status,
      aiProcessingStatus: row.ai_processing_status,
      policyExpiresAt: row.policy_expires_at,
    },
    'ai_processing',
  );
};

/** Постановка запуска. Живой запуск с тем же отпечатком не дублируется. */
export const enqueueRun = async (
  exec: DbExecutor,
  input: { revisionId: number; provider: IModelProvider; chunker?: IChunkerParams; requestedBy: string; previousRunId?: number | null },
): Promise<EnqueueResult> => {
  const policy = await loadRevisionPolicy(exec, input.revisionId);
  if (!policy) return { outcome: 'not_found' };
  if (!policy.allowed) return { outcome: 'refused_policy', reason: policy.reason ?? 'ИИ-обработка запрещена' };

  const fp = buildFingerprint(input.provider, input.chunker ?? defaultChunkerParams());
  const inserted = (
    await exec.query<{ id: number }>(
      `INSERT INTO extraction_runs (revision_id, fingerprint, fingerprint_json, requested_by, previous_run_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (revision_id, fingerprint) WHERE status IN ('queued', 'running') DO NOTHING
       RETURNING id`,
      [input.revisionId, fp.fingerprint, JSON.stringify(fp.json), input.requestedBy, input.previousRunId ?? null],
    )
  ).rows[0];
  if (inserted) return { outcome: 'queued', runId: inserted.id };

  const live = (
    await exec.query<{ id: number }>(
      `SELECT id FROM extraction_runs WHERE revision_id = $1 AND fingerprint = $2 AND status IN ('queued', 'running')`,
      [input.revisionId, fp.fingerprint],
    )
  ).rows[0];
  // Живой запуск мог завершиться между INSERT и SELECT — тогда просто ставим снова.
  if (!live) return enqueueRun(exec, input);
  return { outcome: 'already_live', runId: live.id };
};

/**
 * Захват следующего запуска. Истёкший lease освобождает запуск для другого
 * worker'а; fencing_token растёт при каждом захвате, и прежний держатель
 * больше не может ничего записать.
 */
export const claimNextRun = async (
  owner: string,
  options: { leaseMs?: number; runId?: number; provider?: IModelProvider } = {},
): Promise<IRunClaim | null> => {
  // Исполнитель с моделью берёт только запуски своей идентичности модели; чужие и historical остаются в очереди.
  const modelIdentityHash = options.provider ? buildFingerprint(options.provider, defaultChunkerParams()).modelIdentityHash : null;
  const pool = getPool();
  // Исчерпавшие попытки запуски с истёкшим lease — провал, а не вечная очередь.
  await pool.query(
    `UPDATE extraction_runs
     SET status = 'failed', error = coalesce(error, 'исчерпаны попытки захвата (worker падал)'),
         lease_owner = NULL, lease_expires_at = NULL, finished_at = now()
     WHERE status = 'running' AND lease_expires_at < now() AND claim_count >= $1`,
    [MAX_CLAIMS],
  );

  const row = (
    await pool.query<{ id: number; revision_id: number; fencing_token: string; fingerprint: string; fingerprint_json: { chunker: IChunkerParams } }>(
      `UPDATE extraction_runs r
       SET status = 'running', lease_owner = $1, lease_expires_at = now() + ($2::int * interval '1 millisecond'),
           fencing_token = r.fencing_token + 1, claim_count = r.claim_count + 1,
           started_at = coalesce(r.started_at, now())
       WHERE r.id = (
         SELECT r2.id FROM extraction_runs r2
         JOIN document_revisions dr ON dr.id = r2.revision_id
         JOIN source_items si ON si.id = dr.source_item_id
         JOIN sources s ON s.id = si.source_id
         WHERE (r2.status = 'queued' OR (r2.status = 'running' AND r2.lease_expires_at < now()))
           AND r2.claim_count < $3
           AND ($4::bigint IS NULL OR r2.id = $4)
           AND ($5::text IS NULL OR r2.fingerprint_json->>'modelIdentityHash' = $5)
           AND ${approvedPolicySql('s', 'ai_processing')}
         ORDER BY r2.created_at, r2.id
         FOR UPDATE OF r2 SKIP LOCKED
         LIMIT 1
       )
       RETURNING r.id, r.revision_id, r.fencing_token, r.fingerprint, r.fingerprint_json`,
      [owner, options.leaseMs ?? DEFAULT_LEASE_MS, MAX_CLAIMS, options.runId ?? null, modelIdentityHash],
    )
  ).rows[0];
  if (!row) return null;
  return {
    runId: row.id,
    revisionId: row.revision_id,
    fencingToken: Number(row.fencing_token),
    owner,
    chunker: row.fingerprint_json.chunker,
    fingerprint: row.fingerprint,
  };
};

/**
 * Проверка перед вызовом модели (одна короткая команда, без транзакции и без блокировок на время inference):
 * аренда всё ещё наша — тогда она продлевается (heartbeat), иначе StaleLeaseError; ИИ-допуск источника действует сейчас.
 */
export const assertCanCallModel = async (exec: DbExecutor, claim: IRunClaim, leaseMs: number = DEFAULT_LEASE_MS): Promise<void> => {
  const renewed = await exec.query(
    `UPDATE extraction_runs SET lease_expires_at = now() + ($3::int * interval '1 millisecond')
     WHERE id = $1 AND status = 'running' AND fencing_token = $2`,
    [claim.runId, claim.fencingToken, leaseMs],
  );
  if ((renewed.rowCount ?? 0) === 0) throw new StaleLeaseError(claim.runId);
  const policy = await loadRevisionPolicy(exec, claim.revisionId);
  if (!policy?.allowed) throw new PolicyRevokedError(claim.runId, policy?.reason ?? 'источник не найден');
};

/** Сверка полной идентичности исполнителя с запуском. Несовпадение — ни одного вызова модели. */
export const executionMismatch = (provider: IModelProvider, claim: IRunClaim): string | null => {
  const actual = buildFingerprint(provider, claim.chunker);
  return actual.fingerprint === claim.fingerprint
    ? null
    : `config_mismatch: запуск поставлен отпечатком ${claim.fingerprint.slice(0, 12)}…, исполнитель ${actual.fingerprint.slice(0, 12)}… (${provider.provider}/${provider.model})`;
};

/** Проверка, что lease всё ещё наш. Вызывается под FOR UPDATE внутри транзакции записи. */
const lockOwnedRun = async (client: PoolClient, claim: IRunClaim, leaseMs: number): Promise<void> => {
  const row = (
    await client.query<{ status: string; fencing_token: string }>(
      'SELECT status, fencing_token FROM extraction_runs WHERE id = $1 FOR UPDATE',
      [claim.runId],
    )
  ).rows[0];
  if (!row || row.status !== 'running' || Number(row.fencing_token) !== claim.fencingToken) {
    throw new StaleLeaseError(claim.runId);
  }
  await client.query(
    `UPDATE extraction_runs SET lease_expires_at = now() + ($2::int * interval '1 millisecond') WHERE id = $1`,
    [claim.runId, leaseMs],
  );
};

export type { ChunkOutcome } from './extractOutcome.js';

interface IChunkRow {
  id: number;
  chunk_index: number;
  range_start: number;
  range_end: number;
  status: 'pending' | 'ok' | 'failed';
  attempts: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');


export interface IRunResult {
  runId: number;
  /** blocked — исполнитель не той конфигурации, запуск возвращён в очередь; cancelled — ИИ-допуск перестал действовать. */
  status: 'completed' | 'partial' | 'failed' | 'cancelled' | 'blocked';
  candidateSetId: number | null;
  coveredChars: number;
  totalChars: number;
  relevant: boolean | null;
  error: string | null;
}

export interface IProcessOptions {
  leaseMs?: number;
  /** Точка сбоя для интеграционных тестов: вызывается перед записью итога запуска. */
  beforeFinalize?: () => Promise<void>;
  /** Как часто во время ответа модели перепроверять аренду и допуск (best-effort отмена). По умолчанию 5 с. */
  watchMs?: number;
}

const DEFAULT_WATCH_MS = 5000;

/** Выполнение захваченного запуска: чанки → модель → ответы → итог. */
export const processRun = async (
  provider: IModelProvider,
  claim: IRunClaim,
  options: IProcessOptions = {},
): Promise<IRunResult> => {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const pool = getPool();
  const revision = (
    await pool.query<{ body: string; published_at: Date | null; source_item_id: number }>(
      'SELECT body, published_at, source_item_id FROM document_revisions WHERE id = $1',
      [claim.revisionId],
    )
  ).rows[0];
  if (!revision) throw new Error(`редакция ${claim.revisionId} не найдена`);

  // Запуск модели A не выполняется моделью B и не получает её атрибуцию: вызовов нет, запуск возвращается в очередь.
  const mismatch = executionMismatch(provider, claim);
  if (mismatch) {
    const released = await pool.query(
      `UPDATE extraction_runs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, error = $3
       WHERE id = $1 AND status = 'running' AND fencing_token = $2`,
      [claim.runId, claim.fencingToken, mismatch],
    );
    if (released.rowCount === 0) throw new StaleLeaseError(claim.runId);
    return { runId: claim.runId, status: 'blocked', candidateSetId: null, coveredChars: 0, totalChars: Array.from(revision.body).length, relevant: null, error: mismatch };
  }

  const plan = planCodePointChunks(
    revision.body,
    claim.chunker.chunkSize,
    claim.chunker.maxChunks,
    claim.chunker.overlap,
  );
  const totalChars = Array.from(revision.body).length;
  const planCoverage = computeCoverage(plan, totalChars);

  const chunks = await withTransaction(async client => {
    await lockOwnedRun(client, claim, leaseMs);
    await client.query('UPDATE extraction_runs SET total_chars = $2 WHERE id = $1', [claim.runId, totalChars]);
    for (const c of plan) {
      await client.query(
        `INSERT INTO extraction_chunks (run_id, chunk_index, range_start, range_end)
         VALUES ($1, $2, $3, $4) ON CONFLICT (run_id, chunk_index) DO NOTHING`,
        [claim.runId, c.index, c.start, c.end],
      );
    }
    return (
      await client.query<IChunkRow>(
        'SELECT id, chunk_index, range_start, range_end, status, attempts FROM extraction_chunks WHERE run_id = $1 ORDER BY chunk_index',
        [claim.runId],
      )
    ).rows;
  });

  if (!planCoverage.complete) {
    // Хвост не помещается в лимит чанков: модель не вызываем, запуск не завершается «успешно».
    const error =
      `непокрытый хвост: лимит чанков покрывает ${planCoverage.coveredChars} из ${totalChars} символов ` +
      '(EXTRACT_CHUNK_SIZE / EXTRACT_MAX_CHUNKS)';
    return finalizeRun(claim, leaseMs, { forcedStatus: 'failed', error, totalChars, publishedAt: revision.published_at, options });
  }

  let revoked: string | null = null;
  for (const chunk of chunks) {
    if (chunk.status === 'ok') continue; // повторный захват не спрашивает модель заново о готовом
    // Перед каждым новым запросом: своя аренда и действующий ИИ-допуск. Отозван — дальше не отправляем ничего.
    try {
      await assertCanCallModel(pool, claim, leaseMs);
    } catch (err) {
      if (err instanceof PolicyRevokedError) {
        revoked = err.reason;
        break;
      }
      throw err;
    }
    const text = plan[chunk.chunk_index]?.text ?? '';
    let outcome: ChunkOutcome;
    let payload: IExtraction | ISemanticExtraction | null = null;
    let raw: string | null = null;
    let error: string | null = null;
    let usage: { tokensIn: number | null; tokensOut: number | null; latencyMs: number | null } = {
      tokensIn: null,
      tokensOut: null,
      latencyMs: null,
    };

    const startedAt = Date.now();
    // Best-effort отмена ушедшего запроса: пока модель отвечает, аренда и допуск перепроверяются. Отмена не гарантирует,
    // что текст не дошёл до модели, — она лишь прекращает ожидание и повторы.
    const controller = new AbortController();
    let watchFailure: unknown = null;
    const watcher = setInterval(() => {
      assertCanCallModel(pool, claim, leaseMs).catch(err => {
        // Сбой самой проверки (база моргнула) запрос не отменяет; отменяют только потерянная аренда и отзыв допуска.
        if (!(err instanceof StaleLeaseError) && !(err instanceof PolicyRevokedError)) return;
        watchFailure = err;
        controller.abort(err);
      });
    }, options.watchMs ?? DEFAULT_WATCH_MS);
    try {
      const result = await provider.extract(text, revision.published_at, {
        signal: controller.signal,
        beforeAttempt: () => assertCanCallModel(pool, claim, leaseMs),
      });
      usage = result.usage;
      // Общая классификация с оценкой качества (extractOutcome.ts): обрезанный/невалидный ответ не ok нигде.
      ({ outcome, payload, raw, error } = classifyExtractResult(result));
    } catch (err) {
      if (err instanceof StaleLeaseError) throw err;
      if (err instanceof PolicyRevokedError) {
        // Попытка не сделана (повтор внутри клиента остановлен до отправки).
        revoked = err.reason;
        break;
      }
      ({ outcome, payload, raw, error } = classifyExtractError(err));
      usage = { tokensIn: null, tokensOut: null, latencyMs: Date.now() - startedAt };
    } finally {
      clearInterval(watcher);
    }
    if (watchFailure instanceof StaleLeaseError) throw watchFailure;

    // Ответ пришёл после отзыва допуска: сохраняется как ответ этой попытки (история запуска),
    // но запуск не завершается набором кандидатов и дальше не отправляет ничего.
    const after = await loadRevisionPolicy(pool, claim.revisionId);
    if (!after?.allowed) revoked = after?.reason ?? 'источник не найден';

    await withTransaction(async client => {
      await lockOwnedRun(client, claim, leaseMs);
      const attempt = (
        await client.query<{ attempts: number }>(
          'UPDATE extraction_chunks SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
          [chunk.id],
        )
      ).rows[0]!.attempts;
      const payloadJson = payload === null ? null : JSON.stringify(payload);
      await client.query(
        `INSERT INTO extraction_chunk_responses
           (chunk_id, attempt_no, fencing_token, outcome, payload, payload_hash, raw_response, error,
            tokens_in, tokens_out, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          chunk.id,
          attempt,
          claim.fencingToken,
          outcome,
          payloadJson,
          payloadJson === null ? null : sha256(payloadJson),
          raw,
          error,
          usage.tokensIn,
          usage.tokensOut,
          usage.latencyMs,
        ],
      );
      await client.query('UPDATE extraction_chunks SET status = $2, last_error = $3 WHERE id = $1', [
        chunk.id,
        outcome === 'ok' ? 'ok' : 'failed',
        error,
      ]);
    });
    if (revoked) break;
  }

  if (revoked) {
    return finalizeRun(claim, leaseMs, { forcedStatus: 'cancelled', error: `policy_revoked: ${revoked}`, totalChars, publishedAt: revision.published_at, options });
  }
  return finalizeRun(claim, leaseMs, { forcedStatus: null, error: null, totalChars, publishedAt: revision.published_at, options });
};

export type PartyDescriptor = Pick<IEntityCandidate, 'kind' | 'name' | 'legalForm' | 'taxId' | 'city' | 'address' | 'projectKind' | 'projectStage'>;

/** Содержание кандидата вместе с описанием сторон: набор самодостаточен для просмотра и публикации. */
export const serializeCandidate = (
  candidate: IAssertionCandidate,
  entities: ReadonlyMap<string, IEntityCandidate>,
): Record<string, unknown> => {
  const parties: Record<string, PartyDescriptor> = {};
  const c = candidate.content;
  for (const ref of [c.subjectRef, c.objectRef, c.counterpartyRef, c.contextRef ?? null]) {
    const entity = ref ? entities.get(ref) : undefined;
    if (ref && entity) {
      parties[ref] = {
        kind: entity.kind,
        name: entity.name,
        legalForm: entity.legalForm,
        taxId: entity.taxId,
        city: entity.city,
        address: entity.address,
        projectKind: entity.projectKind,
        projectStage: entity.projectStage,
      };
    }
  }
  return { ...candidate.content, parties };
};

const finalizeRun = async (
  claim: IRunClaim,
  leaseMs: number,
  input: {
    forcedStatus: 'failed' | 'cancelled' | null;
    error: string | null;
    totalChars: number;
    publishedAt: Date | null;
    options: IProcessOptions;
  },
): Promise<IRunResult> => {
  if (input.options.beforeFinalize) await input.options.beforeFinalize();

  return withTransaction(async client => {
    await lockOwnedRun(client, claim, leaseMs);

    const chunks = (
      await client.query<IChunkRow & { text_payload: IExtraction | ISemanticExtraction | null }>(
        `SELECT c.id, c.chunk_index, c.range_start, c.range_end, c.status, c.attempts,
                (SELECT resp.payload FROM extraction_chunk_responses resp
                 WHERE resp.chunk_id = c.id AND resp.outcome = 'ok'
                 ORDER BY resp.attempt_no DESC LIMIT 1) AS text_payload
         FROM extraction_chunks c WHERE c.run_id = $1 ORDER BY c.chunk_index`,
        [claim.runId],
      )
    ).rows;
    const okChunks = chunks.filter(c => c.status === 'ok' && c.text_payload !== null);
    const coverage = computeCoverage(
      okChunks.map(c => ({ start: c.range_start, end: c.range_end })),
      input.totalChars,
    );

    let status: IRunResult['status'];
    let error = input.error;
    // Допуск проверяется и в момент итога: отозванный между последним ответом и итогом — не completed, набора нет.
    const policy = input.forcedStatus ? null : await loadRevisionPolicy(client, claim.revisionId);
    if (input.forcedStatus) {
      status = input.forcedStatus;
    } else if (!policy?.allowed) {
      status = 'cancelled';
      error = `policy_revoked: ${policy?.reason ?? 'источник не найден'}`;
    } else if (okChunks.length === chunks.length && coverage.complete) {
      status = 'completed';
    } else {
      status = okChunks.length === 0 ? 'failed' : 'partial';
      const failed = chunks.filter(c => c.status !== 'ok').map(c => c.chunk_index);
      error =
        `разобрано ${okChunks.length} из ${chunks.length} чанков, покрыто ${coverage.coveredChars} из ${input.totalChars}` +
        (failed.length > 0 ? `; не разобраны чанки ${failed.join(', ')}` : '');
    }

    let candidateSetId: number | null = null;
    let relevant: boolean | null = null;
    if (status === 'completed') {
      const revision = (
        await client.query<{ body: string; source_item_id: number }>(
          'SELECT body, source_item_id FROM document_revisions WHERE id = $1',
          [claim.revisionId],
        )
      ).rows[0]!;
      const chars = Array.from(revision.body);
      const build = buildCandidates(
        okChunks.map(c => ({
          chunkId: c.id,
          index: c.chunk_index,
          start: c.range_start,
          text: chars.slice(c.range_start, c.range_end).join(''),
          extraction: c.text_payload!,
        })),
        input.publishedAt,
      );
      relevant = build.relevant;
      candidateSetId = (
        await client.query<{ id: number }>(
          `INSERT INTO candidate_sets (run_id, revision_id, source_item_id, relevant) VALUES ($1, $2, $3, $4) RETURNING id`,
          [claim.runId, claim.revisionId, revision.source_item_id, build.relevant],
        )
      ).rows[0]!.id;
      const entities = new Map(build.entities.map(e => [e.ref, e]));
      for (const candidate of build.assertions) {
        await client.query(
          `INSERT INTO candidate_assertions (set_id, content, evidence, grounded, confidence, rejected_reason)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            candidateSetId,
            JSON.stringify(serializeCandidate(candidate, entities)),
            JSON.stringify(candidate.evidence),
            candidate.grounded,
            Math.min(1, Math.max(0, candidate.confidence)).toFixed(3),
            candidate.rejectedReason,
          ],
        );
      }
    }

    await client.query(
      `UPDATE extraction_runs
       SET status = $2, error = $3, covered_chars = $4, total_chars = $5, relevant = $6,
           lease_owner = NULL, lease_expires_at = NULL, finished_at = now()
       WHERE id = $1`,
      [claim.runId, status, error, coverage.coveredChars, input.totalChars, relevant],
    );

    return {
      runId: claim.runId,
      status,
      candidateSetId,
      coveredChars: coverage.coveredChars,
      totalChars: input.totalChars,
      relevant,
      error,
    };
  });
};

/**
 * Повтор провалившегося, частичного или отменённого запуска — новым запуском со ссылкой на прежний; прежний не меняется.
 * Поставленный, но не начатый запуск другой конфигурации (в т. ч. historical, до этапа 11) заменяется: прежний
 * помечается cancelled с причиной, новый ставится текущей конфигурацией. Ответы прежних чанков в новый запуск не переносятся.
 * Отзыв допуска проверяет enqueueRun: при отозванном допуске повтор не ставится.
 */
export const retryRun = async (runId: number, provider: IModelProvider, requestedBy: string): Promise<EnqueueResult> => {
  const run = (
    await getPool().query<{ revision_id: number; status: string; fingerprint: string; fingerprint_json: { chunker: IChunkerParams } }>(
      'SELECT revision_id, status, fingerprint, fingerprint_json FROM extraction_runs WHERE id = $1',
      [runId],
    )
  ).rows[0];
  if (!run) return { outcome: 'not_found' };
  const chunker = run.fingerprint_json.chunker ?? defaultChunkerParams();
  const staleQueued = run.status === 'queued' && buildFingerprint(provider, chunker).fingerprint !== run.fingerprint;
  if (!['failed', 'partial', 'cancelled'].includes(run.status) && !staleQueued) return { outcome: 'not_found' };

  return withTransaction(async client => {
    const result = await enqueueRun(client, { revisionId: run.revision_id, provider, chunker, requestedBy, previousRunId: runId });
    if (staleQueued && result.outcome === 'queued') {
      await client.query(
        `UPDATE extraction_runs SET status = 'cancelled', finished_at = now(),
                error = 'config_mismatch: заменён запуском #' || $2::text || ' текущей конфигурации'
         WHERE id = $1 AND status = 'queued'`,
        [runId, result.runId],
      );
    }
    return result;
  });
};
