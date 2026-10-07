// Проход нового конвейера: проверка модели, постановка новых редакций, повтор
// упавших, захват запусков, выполнение и (только по отдельному флагу) публикация.
//
// Автопостановка берёт лишь редакции, которые ещё никто не разбирал: последнюю
// редакцию публикации без единого запуска, чей legacy-документ не был разобран
// старым путём. Переразбор уже разобранного — только явной командой с лимитом.
//
// Два правила, без которых поток останавливался молча:
//  - модель не отвечает — проход не делается вовсе. Иначе постановка создаёт запуски,
//    они тут же падают, и редакция выпадает из автопотока навсегда: автопостановка
//    берёт только редакции без единого запуска;
//  - упавший запуск возвращается в поток сам (retryRun, новый запуск со ссылкой на
//    прежний), с паузой и потолком попыток на редакцию. Дальше — решение оператора.

import { randomUUID } from 'node:crypto';

import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import { modelTextPolicySql } from '../ingest/policy.js';
import { NotPublishableError, PublicationConflictError, publishCandidateSet, type IPublishResult } from './publish.js';
import type { IModelProvider } from './provider.js';
import { claimNextRun, enqueueRun, processRun, retryRun, StaleLeaseError, type IRunClaim, type IRunResult } from './runs.js';

/** Пустая постановка с той же подписью не повторяется чаще (страховка на изменение, которого подпись не видит). */
const ENQUEUE_IDLE_RECHECK_MS = 10 * 60_000;
let idleEnqueue: { signature: string; at: number } | null = null;

/**
 * Подпись того, от чего зависит выбор новых редакций (07.10.2026, замер на сервере: ~100 мс каждые 30 с, найдено 0):
 * последняя редакция, допуски и режимы источников, число legacy-документов «разобран/пропущен» (их меняет
 * --retry-skipped). Запуски не входят: выбираются редакции без единого запуска, а запуски не удаляются.
 */
const enqueueSignature = async (): Promise<string> =>
  (
    await getPool().query<{ sig: string }>(
      `SELECT concat_ws('|',
         (SELECT max(id) FROM document_revisions),
         (SELECT string_agg(id || ':' || ai_processing_status || ':' || coalesce(policy_expires_at::text, '') || ':' ||
                            coalesce(config->>'mode', ''), ',' ORDER BY id) FROM sources),
         (SELECT count(*) FROM raw_documents WHERE status IN ('extracted', 'skipped'))) AS sig`,
    )
  ).rows[0]?.sig ?? '';

export const enqueueNewRevisions = async (provider: IModelProvider, limit: number): Promise<number> => {
  // Прошлая проверка ничего не нашла, а подпись та же — новых редакций для постановки нет.
  const signature = await enqueueSignature();
  if (idleEnqueue && idleEnqueue.signature === signature && Date.now() - idleEnqueue.at < ENQUEUE_IDLE_RECHECK_MS) return 0;
  const rows = (
    await getPool().query<{ id: number }>(
      `SELECT r.id
       FROM document_revisions r
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       LEFT JOIN raw_documents d ON d.id = r.legacy_document_id
       WHERE r.revision_no = (SELECT max(r2.revision_no) FROM document_revisions r2 WHERE r2.source_item_id = r.source_item_id)
         AND NOT EXISTS (SELECT 1 FROM extraction_runs er WHERE er.revision_id = r.id)
         AND (d.id IS NULL OR d.status NOT IN ('extracted', 'skipped'))
         AND ${modelTextPolicySql('s')}
       ORDER BY r.first_observed_at DESC, r.id
       LIMIT $1`,
      [limit],
    )
  ).rows;
  idleEnqueue = rows.length === 0 ? { signature, at: Date.now() } : null;
  let queued = 0;
  for (const row of rows) {
    const result = await enqueueRun(getPool(), { revisionId: row.id, provider, requestedBy: 'worker' });
    if (result.outcome === 'queued') queued += 1;
  }
  return queued;
};

export interface IRetryPolicy {
  /** Сколько раз редакцию переставляем сами. Больше — уже не сбой модели, а разбор, который ей не даётся. */
  max: number;
  /** Пауза после падения: LM Studio поднимают руками, долбить его каждые полминуты незачем. */
  backoffMinutes: number;
}

/**
 * Повтор упавших запусков. Берём последний запуск редакции в статусе failed/partial,
 * у которого нет потомка и нет живого или успешного соседа, и ставим новый (retryRun:
 * прежний не меняется, ссылка `previous_run_id` сохраняет цепочку).
 *
 * Потолок считается по числу неудач на редакцию, а не по длине цепочки: запуск,
 * поставленный оператором вручную, тоже расходует попытку — иначе один и тот же текст
 * крутился бы в повторах вечно. `cancelled` не повторяем: это отзыв допуска, решение
 * оператора, а не сбой.
 */
export const retryFailedRuns = async (
  provider: IModelProvider,
  policy: IRetryPolicy,
  limit: number,
): Promise<number> => {
  const rows = (
    await getPool().query<{ id: number }>(
      `SELECT er.id
       FROM extraction_runs er
       JOIN document_revisions r ON r.id = er.revision_id
       JOIN source_items si ON si.id = r.source_item_id
       JOIN sources s ON s.id = si.source_id
       WHERE er.status IN ('failed', 'partial')
         AND er.finished_at IS NOT NULL
         AND er.finished_at < now() - ($1::int * interval '1 minute')
         AND NOT EXISTS (SELECT 1 FROM extraction_runs child WHERE child.previous_run_id = er.id)
         AND NOT EXISTS (SELECT 1 FROM extraction_runs live WHERE live.revision_id = er.revision_id
                           AND live.status IN ('queued', 'running', 'completed'))
         AND (SELECT count(*) FROM extraction_runs a WHERE a.revision_id = er.revision_id
                AND a.status IN ('failed', 'partial')) < $2::int
         AND ${modelTextPolicySql('s')}
       ORDER BY er.finished_at
       LIMIT $3`,
      [policy.backoffMinutes, policy.max, limit],
    )
  ).rows;

  let queued = 0;
  for (const row of rows) {
    const result = await retryRun(row.id, provider, 'worker-retry');
    if (result.outcome === 'queued') {
      queued += 1;
      console.log(`[reprocess] упавший запуск #${row.id} переставлен запуском #${result.runId}`);
    }
  }
  return queued;
};

export interface IPassResult {
  run: IRunResult | null;
  error: string | null;
  publish: IPublishResult | null;
  /** Разбор прошёл, но набор публиковать нельзя: причина словами. */
  publishRefusal: string | null;
}

export interface IPass {
  results: IPassResult[];
  /** Проход не делался: модель не отвечает. Причина словами, иначе null. */
  skipped: string | null;
  /** Сколько запусков поставлено заново после падения. */
  retried: number;
}

export interface IPassOptions {
  maxRuns?: number;
  autoPublish?: boolean;
  owner?: string;
  enqueueLimit?: number;
  /**
   * Доступна ли модель. Недоступна — не ставим и не захватываем ничего: запуск, созданный
   * при выключенной модели, падает и уносит редакцию из автопотока. Не передана — не проверяем
   * (CLI разового прогона, тесты с подставным провайдером).
   */
  probeModel?: () => Promise<{ ok: boolean; error?: string }>;
  /** null — без автоповтора (разовый прогон оператора). */
  retry?: IRetryPolicy | null;
  /**
   * Сколько запусков разбираются одновременно (REPROCESS_CONCURRENCY): каждая полоса сама берёт запуск из очереди
   * (SKIP LOCKED, аренда, fencing) и ждёт модель независимо от соседей. Публикация в карточки — по одной
   * (publish.ts, блокировка в базе). Не передано — 1, как раньше.
   */
  concurrency?: number;
}

/** Сколько повторов за проход: они не должны вытеснять свежие редакции из той же пачки. */
export const RETRY_BATCH = 5;

/** Один захваченный запуск: разбор, затем (при автопубликации) публикация набора. */
const executeClaim = async (provider: IModelProvider, claim: IRunClaim, autoPublish: boolean): Promise<IPassResult> => {
  try {
    const run = await processRun(provider, claim);
    let publish: IPublishResult | null = null;
    let publishRefusal: string | null = null;
    if (autoPublish && run.candidateSetId !== null) {
      // Автопубликация без allowStale: устаревший разбор остаётся кандидатом.
      const version = (
        await getPool().query<{ version: number }>(
          `SELECT coalesce((SELECT p.version FROM item_publications p
                            JOIN candidate_sets cs ON cs.source_item_id = p.source_item_id
                            WHERE cs.id = $1), 0) AS version`,
          [run.candidateSetId],
        )
      ).rows[0]!.version;
      try {
        publish = await publishCandidateSet({ setId: run.candidateSetId, expectedVersion: version, actor: 'auto' });
      } catch (err) {
        // Отказ публикации — исход набора, а не падение запуска. Раньше он летел
        // в общий catch, и успешный разбор попадал в лог как «запуск прерван».
        if (err instanceof NotPublishableError || err instanceof PublicationConflictError) {
          publishRefusal = err.message;
          console.warn(`[reprocess] запуск ${claim.runId}: набор не опубликован — ${err.message}`);
        } else {
          throw err;
        }
      }
    }
    return { run, error: null, publish, publishRefusal };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Потерянный lease — не ошибка данных: запуск продолжит другой worker.
    if (!(err instanceof StaleLeaseError)) console.error(`[reprocess] запуск ${claim.runId}: ${message}`);
    return { run: null, error: message, publish: null, publishRefusal: null };
  }
};

export const runReprocessPass = async (
  provider: IModelProvider,
  options: IPassOptions = {},
): Promise<IPass> => {
  const owner = options.owner ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  if (options.probeModel) {
    const probe = await options.probeModel();
    if (!probe.ok) {
      // Ни постановки, ни захвата: редакции просто ждут. Это состояние, а не поломка данных.
      return { results: [], skipped: `модель не отвечает: ${probe.error ?? 'причина неизвестна'}`, retried: 0 };
    }
  }

  let retried = 0;
  if (options.retry) retried = await retryFailedRuns(provider, options.retry, RETRY_BATCH);
  if (options.enqueueLimit && options.enqueueLimit > 0) await enqueueNewRevisions(provider, options.enqueueLimit);

  const results: IPassResult[] = [];
  const maxRuns = options.maxRuns ?? env.EXTRACT_BATCH_SIZE;
  const lanes = Math.max(1, Math.min(options.concurrency ?? 1, maxRuns));
  let taken = 0;
  // Полоса берёт запуски, пока не исчерпан общий предел прохода или очередь; модель ждёт каждая сама.
  const lane = async (): Promise<void> => {
    while (taken < maxRuns) {
      taken += 1;
      // Только запуски идентичности модели этого исполнителя: чужую конфигурацию не исполняем и не переписываем.
      const claim = await claimNextRun(owner, { provider });
      if (!claim) return;
      results.push(await executeClaim(provider, claim, options.autoPublish === true));
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return { results, skipped: null, retried };
};
