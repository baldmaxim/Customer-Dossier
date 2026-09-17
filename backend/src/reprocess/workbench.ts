// Рабочее место запусков нового конвейера (этап 15B): список с фильтрами и курсором, карточка запуска, точечные
// действия по id. Всё читается из запусков, чанков, ответов и наборов (не из legacy-счётчиков). Неизвестные время и
// токены не досчитываются: если хоть один ответ их не сообщил — сумма неизвестна (null).
//
// Действия:
//  - enqueue: одна редакция, общий gate допуска (enqueueRun), живой запуск с тем же отпечатком не дублируется;
//  - retry: новый запуск со ссылкой на прежний; повтор той же команды возвращает уже созданный повтор;
//  - cancel: queued/running → cancelled с увеличением fencing-токена. Держатель аренды больше ничего не запишет и не
//    отправит следующий чанк; запрос, уже ушедший в модель, отменить нельзя — это показывается, а не обещается.
// Публикация — publish.ts (токен предпросмотра). Массовых действий здесь нет.

import { withTransaction, getPool, type DbExecutor } from '../db/pool.js';
import { evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';
import { runComplete } from './publish.js';
import { CANDIDATE_BUILD_VERSION, isHistoricalIdentity, type IModelProvider } from './provider.js';
import { enqueueRun, retryRun, type EnqueueResult } from './runs.js';

export const RUN_PAGE_LIMIT = 100;
export const RUN_STATUSES = ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface IRunFilter {
  sourceId?: number;
  sourceItemId?: number;
  revisionId?: number;
  status?: RunStatus;
  schemaVersion?: string;
  /** Префикс отпечатка запуска (hex). */
  fingerprint?: string;
  /** Курсор: id последнего запуска предыдущей страницы. */
  beforeId?: number;
  limit: number;
}

interface IRunListRow {
  id: number;
  revision_id: number;
  source_item_id: number;
  revision_no: number;
  latest_revision_no: number;
  source_id: number;
  source_key: string;
  access_status: PermissionStatus;
  ai_processing_status: PermissionStatus;
  policy_expires_at: Date | null;
  status: RunStatus;
  error: string | null;
  fingerprint: string;
  model: string | null;
  schema_version: string | null;
  prompt_version: string | null;
  previous_run_id: number | null;
  covered_chars: number | null;
  total_chars: number | null;
  relevant: boolean | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  chunks: number;
  chunks_ok: number;
  chunks_failed: number;
  responses: number;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  usage_unknown: number;
  candidate_set_id: number | null;
  candidate_set_status: string | null;
}

export interface IRunListItem {
  id: number;
  revisionId: number;
  revisionNo: number;
  /** Номер последней редакции публикации: больше revisionNo — разобрана не последняя редакция. */
  latestRevisionNo: number;
  sourceItemId: number;
  source: { id: number; key: string };
  status: RunStatus;
  error: string | null;
  fingerprint: string;
  model: string | null;
  schemaVersion: string | null;
  promptVersion: string | null;
  previousRunId: number | null;
  coverage: { coveredChars: number | null; totalChars: number | null; chunks: number; chunksOk: number; chunksFailed: number };
  relevant: boolean | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** null — хотя бы один ответ не сообщил значение; не досчитывается. */
  usage: { responses: number; tokensIn: number | null; tokensOut: number | null; latencyMs: number | null };
  policy: { allowed: boolean; reason: string | null };
  candidateSet: { id: number; status: string } | null;
}

export interface IRunPage {
  items: IRunListItem[];
  total: number;
  nextBeforeId: number | null;
}

const RUN_SELECT = `
  SELECT er.id, er.revision_id, r.source_item_id, r.revision_no,
         (SELECT max(r2.revision_no) FROM document_revisions r2 WHERE r2.source_item_id = r.source_item_id) AS latest_revision_no,
         s.id AS source_id, s.key AS source_key, s.access_status, s.ai_processing_status, s.policy_expires_at,
         er.status, er.error, er.fingerprint,
         er.fingerprint_json->>'model' AS model, er.fingerprint_json->>'schemaVersion' AS schema_version,
         er.fingerprint_json->>'promptVersion' AS prompt_version, er.previous_run_id,
         er.covered_chars, er.total_chars, er.relevant, er.requested_by, er.created_at, er.started_at, er.finished_at,
         (SELECT count(*)::int FROM extraction_chunks c WHERE c.run_id = er.id) AS chunks,
         (SELECT count(*)::int FROM extraction_chunks c WHERE c.run_id = er.id AND c.status = 'ok') AS chunks_ok,
         (SELECT count(*)::int FROM extraction_chunks c WHERE c.run_id = er.id AND c.status = 'failed') AS chunks_failed,
         u.responses, u.tokens_in, u.tokens_out, u.latency_ms, u.usage_unknown,
         cs.id AS candidate_set_id, cs.status AS candidate_set_status
  FROM extraction_runs er
  JOIN document_revisions r ON r.id = er.revision_id
  JOIN source_items si ON si.id = r.source_item_id
  JOIN sources s ON s.id = si.source_id
  LEFT JOIN candidate_sets cs ON cs.run_id = er.id
  LEFT JOIN LATERAL (
    SELECT count(resp.id)::int AS responses,
           sum(resp.tokens_in)::int AS tokens_in, sum(resp.tokens_out)::int AS tokens_out, sum(resp.latency_ms)::int AS latency_ms,
           count(resp.id) FILTER (WHERE resp.tokens_in IS NULL OR resp.tokens_out IS NULL OR resp.latency_ms IS NULL)::int AS usage_unknown
    FROM extraction_chunks c JOIN extraction_chunk_responses resp ON resp.chunk_id = c.id
    WHERE c.run_id = er.id
  ) u ON true`;

const filterSql = (f: IRunFilter): { where: string; params: unknown[] } => {
  const params: unknown[] = [
    f.sourceId ?? null,
    f.sourceItemId ?? null,
    f.revisionId ?? null,
    f.status ?? null,
    f.schemaVersion ?? null,
    f.fingerprint ? `${f.fingerprint}%` : null,
  ];
  const where = `($1::bigint IS NULL OR s.id = $1) AND ($2::bigint IS NULL OR r.source_item_id = $2)
    AND ($3::bigint IS NULL OR er.revision_id = $3) AND ($4::text IS NULL OR er.status = $4)
    AND ($5::text IS NULL OR er.fingerprint_json->>'schemaVersion' = $5) AND ($6::text IS NULL OR er.fingerprint LIKE $6)`;
  return { where, params };
};

const toListItem = (r: IRunListRow): IRunListItem => {
  const unknown = r.usage_unknown > 0 || r.responses === 0;
  return {
    id: Number(r.id),
    revisionId: Number(r.revision_id),
    revisionNo: r.revision_no,
    latestRevisionNo: r.latest_revision_no,
    sourceItemId: Number(r.source_item_id),
    source: { id: Number(r.source_id), key: r.source_key },
    status: r.status,
    error: r.error,
    fingerprint: r.fingerprint,
    model: r.model,
    schemaVersion: r.schema_version,
    promptVersion: r.prompt_version,
    previousRunId: r.previous_run_id === null ? null : Number(r.previous_run_id),
    coverage: { coveredChars: r.covered_chars, totalChars: r.total_chars, chunks: r.chunks, chunksOk: r.chunks_ok, chunksFailed: r.chunks_failed },
    relevant: r.relevant,
    requestedBy: r.requested_by,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    usage: {
      responses: r.responses,
      tokensIn: unknown ? null : r.tokens_in,
      tokensOut: unknown ? null : r.tokens_out,
      latencyMs: unknown ? null : r.latency_ms,
    },
    policy: evaluateSourcePolicy(
      { key: r.source_key, accessStatus: r.access_status, aiProcessingStatus: r.ai_processing_status, policyExpiresAt: r.policy_expires_at },
      'ai_processing',
    ),
    candidateSet: r.candidate_set_id === null ? null : { id: Number(r.candidate_set_id), status: r.candidate_set_status ?? 'unknown' },
  };
};

export const listRuns = async (filter: IRunFilter, exec: DbExecutor = getPool()): Promise<IRunPage> => {
  const limit = Math.max(1, Math.min(RUN_PAGE_LIMIT, filter.limit));
  const { where, params } = filterSql(filter);
  const total =
    (
      await exec.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM extraction_runs er JOIN document_revisions r ON r.id = er.revision_id
         JOIN source_items si ON si.id = r.source_item_id JOIN sources s ON s.id = si.source_id WHERE ${where}`,
        params,
      )
    ).rows[0]?.n ?? 0;
  const rows = (
    await exec.query<IRunListRow>(`${RUN_SELECT} WHERE ${where} AND ($7::bigint IS NULL OR er.id < $7) ORDER BY er.id DESC LIMIT $8`, [
      ...params,
      filter.beforeId ?? null,
      limit + 1,
    ])
  ).rows;
  const page = rows.slice(0, limit);
  return {
    items: page.map(toListItem),
    total,
    nextBeforeId: rows.length > limit && page.length > 0 ? Number(page[page.length - 1]!.id) : null,
  };
};

// ---------------------------------------------------------------------------
// Карточка запуска

export interface IRunDetail extends IRunListItem {
  identity: { historical: boolean; candidateBuildVersion: string | null; candidateBuildCurrent: boolean; provider: string | null };
  /** Цепочка повторов: предшественники (от ближайшего) и прямые повторы этого запуска. */
  lineage: { previous: Array<{ id: number; status: string }>; retries: Array<{ id: number; status: string }> };
  /** Запрос к модели мог уже уйти: запуск выполняется, аренда действует. */
  inFlight: boolean;
  lease: { owner: string | null; expiresAt: string | null; claimCount: number };
  revision: { id: number; no: number; title: string | null; publishedAt: string | null; bodyChars: number };
  latestRevision: { id: number; no: number } | null;
  publication: { activeSetId: number | null; activeRunId: number | null; activeRevisionNo: number | null; version: number };
  chunks: Array<{
    index: number;
    rangeStart: number;
    rangeEnd: number;
    status: string;
    attempts: number;
    lastError: string | null;
    responses: Array<{ attemptNo: number; outcome: string; error: string | null; tokensIn: number | null; tokensOut: number | null; latencyMs: number | null; createdAt: string }>;
  }>;
  candidates: Array<{
    id: number;
    predicate: string;
    role: string | null;
    grounded: boolean;
    /** publishable — пройдёт в канон при публикации; review — найден в тексте, но проверка отправила на проверку; ungrounded — цитата не найдена. */
    verdict: 'publishable' | 'review' | 'ungrounded';
    rejectedReason: string | null;
    confidence: number | null;
    parties: string[];
    evidence: Array<{ quote: string; spanStart: number; spanEnd: number; stance: string; chunkId: number }>;
  }>;
  /** Неоднозначные упоминания этой редакции (этап 15A) — ссылка на разбор, не автоматическое решение. */
  ambiguities: Array<{ id: number; surface: string; status: string; candidates: number }>;
  runComplete: boolean;
}

type Json = Record<string, unknown>;

export class RunNotFoundError extends Error {
  constructor(id: number) {
    super(`Запуск #${id} не найден`);
    this.name = 'RunNotFoundError';
  }
}

export const getRunDetail = async (id: number): Promise<IRunDetail> =>
  withTransaction(async client => {
    // Одно согласованное чтение карточки.
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await client.query<IRunListRow>(`${RUN_SELECT} WHERE er.id = $1`, [id])).rows[0];
    if (!row) throw new RunNotFoundError(id);
    const item = toListItem(row);
    const meta = (
      await client.query<{ fingerprint_json: Json; lease_owner: string | null; lease_expires_at: string | null; claim_count: number; in_flight: boolean }>(
        `SELECT fingerprint_json, lease_owner, lease_expires_at, claim_count,
                (status = 'running' AND lease_expires_at > now()) AS in_flight
         FROM extraction_runs WHERE id = $1`,
        [id],
      )
    ).rows[0]!;

    const previous: Array<{ id: number; status: string }> = [];
    let prevId = item.previousRunId;
    const seen = new Set<number>([id]);
    while (prevId !== null && !seen.has(prevId) && previous.length < 20) {
      seen.add(prevId);
      const p = (await client.query<{ id: number; status: string; previous_run_id: number | null }>('SELECT id, status, previous_run_id FROM extraction_runs WHERE id = $1', [prevId])).rows[0];
      if (!p) break;
      previous.push({ id: Number(p.id), status: p.status });
      prevId = p.previous_run_id === null ? null : Number(p.previous_run_id);
    }
    const retries = (await client.query<{ id: number; status: string }>('SELECT id, status FROM extraction_runs WHERE previous_run_id = $1 ORDER BY id', [id])).rows.map(
      r => ({ id: Number(r.id), status: r.status }),
    );

    const revision = (
      await client.query<{ id: number; revision_no: number; title: string | null; published_at: string | null; chars: number }>(
        `SELECT r.id, r.revision_no, r.title, si.published_at, char_length(r.body) AS chars
         FROM document_revisions r JOIN source_items si ON si.id = r.source_item_id WHERE r.id = $1`,
        [item.revisionId],
      )
    ).rows[0]!;
    const latest = (
      await client.query<{ id: number; revision_no: number }>(
        'SELECT id, revision_no FROM document_revisions WHERE source_item_id = $1 ORDER BY revision_no DESC LIMIT 1',
        [item.sourceItemId],
      )
    ).rows[0];
    const publication = (
      await client.query<{ active_set_id: number | null; version: number; run_id: number | null; revision_no: number | null }>(
        `SELECT p.active_set_id, p.version, cs.run_id, r.revision_no
         FROM item_publications p LEFT JOIN candidate_sets cs ON cs.id = p.active_set_id
         LEFT JOIN document_revisions r ON r.id = cs.revision_id
         WHERE p.source_item_id = $1`,
        [item.sourceItemId],
      )
    ).rows[0];

    const chunkRows = (
      await client.query<{ id: number; chunk_index: number; range_start: number; range_end: number; status: string; attempts: number; last_error: string | null }>(
        'SELECT id, chunk_index, range_start, range_end, status, attempts, last_error FROM extraction_chunks WHERE run_id = $1 ORDER BY chunk_index',
        [id],
      )
    ).rows;
    // raw_response и payload не отдаются: в них текст публикации и ответ модели, для разбора причин достаточно исхода и ошибки.
    const responseRows = (
      await client.query<{ chunk_id: number; attempt_no: number; outcome: string; error: string | null; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; created_at: string }>(
        `SELECT resp.chunk_id, resp.attempt_no, resp.outcome, resp.error, resp.tokens_in, resp.tokens_out, resp.latency_ms, resp.created_at
         FROM extraction_chunk_responses resp JOIN extraction_chunks c ON c.id = resp.chunk_id
         WHERE c.run_id = $1 ORDER BY resp.chunk_id, resp.attempt_no`,
        [id],
      )
    ).rows;

    const candidateRows =
      item.candidateSet === null
        ? []
        : (
            await client.query<{ id: number; content: Json; evidence: Array<Json>; grounded: boolean; confidence: string | null; rejected_reason: string | null }>(
              'SELECT id, content, evidence, grounded, confidence, rejected_reason FROM candidate_assertions WHERE set_id = $1 ORDER BY id',
              [item.candidateSet.id],
            )
          ).rows;

    const ambiguities = (
      await client.query<{ id: number; surface: string; status: string; candidates: number }>(
        `SELECT id, surface, status, cardinality(candidate_ids) AS candidates FROM resolution_ambiguities WHERE revision_id = $1 ORDER BY id`,
        [item.revisionId],
      )
    ).rows.map(a => ({ id: Number(a.id), surface: a.surface, status: a.status, candidates: a.candidates }));

    const fj = meta.fingerprint_json;
    const buildVersion = typeof fj.candidateBuildVersion === 'string' ? fj.candidateBuildVersion : null;
    return {
      ...item,
      identity: {
        historical: isHistoricalIdentity(fj),
        candidateBuildVersion: buildVersion,
        candidateBuildCurrent: buildVersion === CANDIDATE_BUILD_VERSION,
        provider: typeof fj.provider === 'string' ? fj.provider : null,
      },
      lineage: { previous, retries },
      inFlight: meta.in_flight,
      lease: { owner: meta.lease_owner, expiresAt: meta.lease_expires_at, claimCount: meta.claim_count },
      revision: { id: Number(revision.id), no: revision.revision_no, title: revision.title, publishedAt: revision.published_at, bodyChars: revision.chars },
      latestRevision: latest ? { id: Number(latest.id), no: latest.revision_no } : null,
      publication: {
        activeSetId: publication?.active_set_id == null ? null : Number(publication.active_set_id),
        activeRunId: publication?.run_id == null ? null : Number(publication.run_id),
        activeRevisionNo: publication?.revision_no ?? null,
        version: publication?.version ?? 0,
      },
      chunks: chunkRows.map(c => ({
        index: c.chunk_index,
        rangeStart: c.range_start,
        rangeEnd: c.range_end,
        status: c.status,
        attempts: c.attempts,
        lastError: c.last_error,
        responses: responseRows
          .filter(r => Number(r.chunk_id) === Number(c.id))
          .map(r => ({ attemptNo: r.attempt_no, outcome: r.outcome, error: r.error, tokensIn: r.tokens_in, tokensOut: r.tokens_out, latencyMs: r.latency_ms, createdAt: r.created_at })),
      })),
      candidates: candidateRows.map(c => {
        const parties = (c.content.parties ?? {}) as Record<string, { kind?: string; name?: string }>;
        return {
          id: Number(c.id),
          predicate: String(c.content.predicate ?? ''),
          role: typeof c.content.role === 'string' ? c.content.role : null,
          grounded: c.grounded,
          verdict: !c.grounded ? 'ungrounded' : c.rejected_reason === null ? 'publishable' : 'review',
          rejectedReason: c.rejected_reason,
          confidence: c.confidence === null ? null : Number(c.confidence),
          parties: Object.values(parties).map(p => `${p.kind === 'project' ? 'объект' : 'компания'} «${p.name ?? '?'}»`),
          evidence: (c.evidence ?? []).map(e => ({
            quote: String(e.quote ?? ''),
            spanStart: Number(e.spanStart),
            spanEnd: Number(e.spanEnd),
            stance: String(e.stance ?? 'supports'),
            chunkId: Number(e.chunkId),
          })),
        };
      }),
      ambiguities,
      runComplete: runComplete({ status: item.status, covered_chars: item.coverage.coveredChars, total_chars: item.coverage.totalChars }),
    };
  });

// ---------------------------------------------------------------------------
// Действия

export type CancelResult =
  | { outcome: 'cancelled'; runId: number; previousStatus: 'queued' | 'running'; inFlight: boolean }
  | { outcome: 'not_cancellable'; runId: number; status: string }
  | { outcome: 'not_found' };

/**
 * Отмена: запуск больше не будет захвачен, держатель аренды не запишет ответ и не отправит следующий чанк (fencing).
 * Ответы, уже записанные, остаются историей. Запрос, ушедший в модель до отмены, отозвать нельзя — inFlight.
 */
export const cancelRun = async (runId: number, actor: string): Promise<CancelResult> =>
  withTransaction(async client => {
    const run = (
      await client.query<{ status: string; in_flight: boolean }>(
        `SELECT status, (status = 'running' AND lease_expires_at > now()) AS in_flight FROM extraction_runs WHERE id = $1 FOR UPDATE`,
        [runId],
      )
    ).rows[0];
    if (!run) return { outcome: 'not_found' };
    if (run.status !== 'queued' && run.status !== 'running') return { outcome: 'not_cancellable', runId, status: run.status };
    await client.query(
      `UPDATE extraction_runs
       SET status = 'cancelled', error = $2, lease_owner = NULL, lease_expires_at = NULL,
           fencing_token = fencing_token + 1, finished_at = now()
       WHERE id = $1`,
      [runId, `cancelled_by_operator: ${actor}`],
    );
    return { outcome: 'cancelled', runId, previousStatus: run.status, inFlight: run.in_flight };
  });

export type RetryResult = EnqueueResult | { outcome: 'already_retried'; runId: number } | { outcome: 'not_retryable'; status: string };

/** Повтор одного запуска. Повторная команда по тому же запуску возвращает уже созданный повтор, а не ещё один. */
export const retryRunOnce = async (runId: number, provider: IModelProvider, requestedBy: string): Promise<RetryResult> => {
  const pool = getPool();
  const run = (await pool.query<{ status: string }>('SELECT status FROM extraction_runs WHERE id = $1', [runId])).rows[0];
  if (!run) return { outcome: 'not_found' };
  const child = (await pool.query<{ id: number }>('SELECT id FROM extraction_runs WHERE previous_run_id = $1 ORDER BY id DESC LIMIT 1', [runId])).rows[0];
  if (child) return { outcome: 'already_retried', runId: Number(child.id) };
  const result = await retryRun(runId, provider, requestedBy);
  return result.outcome === 'not_found' ? { outcome: 'not_retryable', status: run.status } : result;
};

/** Постановка одной редакции. Допуск проверяет enqueueRun; живой запуск той же конфигурации возвращается. */
export const enqueueRevision = (revisionId: number, provider: IModelProvider, requestedBy: string): Promise<EnqueueResult> =>
  enqueueRun(getPool(), { revisionId, provider, requestedBy });
