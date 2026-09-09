// Воркер извлечения: очередь -> чанкинг -> LLM -> проверка -> канонический слой.
//
// Конкурентность намеренно низкая (EXTRACT_CONCURRENCY, по умолчанию 2).
// Узкое место — GPU, а не БД: больше воркеров дадут очередь на видеокарте
// и таймауты, а не пропускную способность.

import { env } from '../config/env.js';
import { getPool, withTransaction, query, execute } from '../db/pool.js';
import { extractFromText } from '../llm/client.js';
import { SCHEMA_VERSION, emptyExtraction, type IExtraction } from '../llm/schema.js';
import { applyExtraction, type IApplyStats } from './apply.js';
import { verifyExtraction } from './verify.js';

/** Телеграм-пост почти всегда влезает целиком; режем только длинные статьи. */
const CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 400;
const MAX_CHUNKS = 4;
const MAX_BODY = 24_000;

/**
 * Сколько раз пробуем документ, прежде чем признать его провальным.
 *
 * Экспортируется: CLI должен знать этот порог, чтобы отличить документ,
 * который честно ждёт очереди, от того, что исчерпал попытки и застрял
 * в статусе queued навсегда.
 */
export const MAX_ATTEMPTS = 3;

interface IQueuedDocument {
  id: number;
  body: string;
  published_at: Date | null;
}

/**
 * Забор пачки. FOR UPDATE SKIP LOCKED позволяет нескольким воркерам брать
 * разные документы без блокировок друг о друга.
 */
export const claimBatch = async (limit: number): Promise<IQueuedDocument[]> =>
  query<IQueuedDocument>(
    `UPDATE raw_documents SET status = 'extracting', attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM raw_documents
       WHERE status IN ('new', 'queued') AND attempts < $2
       ORDER BY published_at DESC NULLS LAST, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, body, published_at`,
    [limit, MAX_ATTEMPTS],
  );

/**
 * Возврат зависших документов. Воркер мог упасть между claim и записью
 * результата — без сторожа такой документ навсегда останется в 'extracting'.
 */
export const requeueStale = async (): Promise<number> =>
  execute(
    `UPDATE raw_documents SET status = 'queued', updated_at = now()
     WHERE status = 'extracting' AND updated_at < now() - interval '15 minutes'`,
  );

export const splitIntoChunks = (body: string): string[] => {
  const text = body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < MAX_CHUNKS) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    // Стараемся резать по границе абзаца: разорванное предложение ломает цитаты.
    const boundary = end < text.length ? text.lastIndexOf('\n', end) : end;
    const cut = boundary > start + CHUNK_SIZE / 2 ? boundary : end;
    chunks.push(text.slice(start, cut));
    if (cut >= text.length) break;
    start = cut - CHUNK_OVERLAP;
  }
  return chunks;
};

/** Слияние результатов чанков: дубли внутри документа схлопываем по имени. */
export const mergeChunkExtractions = (parts: readonly IExtraction[]): IExtraction => {
  const merged = emptyExtraction();
  merged.doc_relevant = parts.some(p => p.doc_relevant);

  const seenCompany = new Set<string>();
  const seenProject = new Set<string>();
  const seenLink = new Set<string>();
  const seenEvent = new Set<string>();

  for (const part of parts) {
    for (const c of part.companies) {
      const key = c.name.toLowerCase();
      if (seenCompany.has(key)) continue;
      seenCompany.add(key);
      merged.companies.push(c);
    }
    for (const p of part.projects) {
      const key = p.name.toLowerCase();
      if (seenProject.has(key)) continue;
      seenProject.add(key);
      merged.projects.push(p);
    }
    for (const l of part.links) {
      const key = `${l.company}|${l.project}|${l.role}`.toLowerCase();
      if (seenLink.has(key)) continue;
      seenLink.add(key);
      merged.links.push(l);
    }
    for (const e of part.events) {
      const key = `${e.type}|${e.company ?? ''}|${e.project ?? ''}`.toLowerCase();
      if (seenEvent.has(key)) continue;
      seenEvent.add(key);
      merged.events.push(e);
    }
  }

  return merged;
};

export interface IProcessResult {
  documentId: number;
  status: 'extracted' | 'skipped' | 'failed';
  stats: IApplyStats | null;
  error: string | null;
}

const recordExtraction = async (
  documentId: number,
  chunkIndex: number,
  status: string,
  payload: unknown,
  rawResponse: string | null,
  usage: { tokensIn: number | null; tokensOut: number | null; latencyMs: number },
): Promise<number | null> => {
  const res = await getPool().query<{ id: number }>(
    `INSERT INTO extractions
       (document_id, chunk_index, prompt_version, model, schema_version, status,
        payload, raw_response, tokens_in, tokens_out, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (document_id, chunk_index, prompt_version, model) DO NOTHING
     RETURNING id`,
    [
      documentId,
      chunkIndex,
      env.PROMPT_VERSION,
      env.LMSTUDIO_MODEL,
      SCHEMA_VERSION,
      status,
      payload === null ? null : JSON.stringify(payload),
      rawResponse,
      usage.tokensIn,
      usage.tokensOut,
      usage.latencyMs,
    ],
  );
  return res.rows[0]?.id ?? null;
};

export const processDocument = async (doc: IQueuedDocument): Promise<IProcessResult> => {
  const chunks = splitIntoChunks(doc.body);
  const parts: IExtraction[] = [];
  let firstExtractionId: number | null = null;
  let lastError: string | null = null;

  for (const [index, chunk] of chunks.entries()) {
    const result = await extractFromText({ body: chunk, publishedAt: doc.published_at });

    if (result.ok) {
      const id = await recordExtraction(doc.id, index, 'ok', result.data, null, result.usage);
      firstExtractionId ??= id;
      parts.push(result.data);
    } else {
      lastError = result.message;
      // raw_response пишем только при ошибке: иначе таблица распухнет быстрее,
      // чем сами тексты. При llm_error ответа нет вовсе — тогда кладём сюда
      // текст ошибки, иначе причина сбоя не сохраняется нигде и приходится
      // лезть в raw_documents.last_error руками.
      await recordExtraction(
        doc.id,
        index,
        result.failure,
        null,
        result.rawResponse ?? result.message,
        result.usage,
      );
    }
  }

  if (parts.length === 0) {
    await execute(
      `UPDATE raw_documents SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
      [doc.id, lastError],
    );
    return { documentId: doc.id, status: 'failed', stats: null, error: lastError };
  }

  const merged = mergeChunkExtractions(parts);
  const publishedAt = doc.published_at ?? new Date();
  const verified = verifyExtraction(merged, doc.body, doc.published_at);

  if (!verified.relevant) {
    await execute(`UPDATE raw_documents SET status = 'skipped', updated_at = now() WHERE id = $1`, [
      doc.id,
    ]);
    return { documentId: doc.id, status: 'skipped', stats: null, error: null };
  }

  // Если ни один чанк не дал id (все были записаны раньше), переизвлечение уже
  // применялось — берём существующую строку, чтобы не потерять привязку.
  if (firstExtractionId === null) {
    const existing = await query<{ id: number }>(
      `SELECT id FROM extractions
       WHERE document_id = $1 AND prompt_version = $2 AND model = $3 AND status = 'ok'
       ORDER BY chunk_index LIMIT 1`,
      [doc.id, env.PROMPT_VERSION, env.LMSTUDIO_MODEL],
    );
    firstExtractionId = existing[0]?.id ?? null;
  }
  if (firstExtractionId === null) {
    return { documentId: doc.id, status: 'failed', stats: null, error: 'нет строки extractions' };
  }

  const extractionId = firstExtractionId;
  const stats = await withTransaction(client =>
    applyExtraction(client, { documentId: doc.id, extractionId, publishedAt, verified }),
  );

  if (verified.rejected.length > 0) {
    console.log(
      `[pipeline] док ${doc.id}: отброшено ${verified.rejected.length} — ` +
        verified.rejected.map(r => `${r.kind}/${r.name}: ${r.reason}`).slice(0, 3).join('; '),
    );
  }

  return { documentId: doc.id, status: 'extracted', stats, error: null };
};

/** Один проход по очереди. Возвращает результаты по каждому документу. */
export const runPipelinePass = async (batchSize = env.EXTRACT_BATCH_SIZE): Promise<IProcessResult[]> => {
  await requeueStale();
  const batch = await claimBatch(batchSize);
  if (batch.length === 0) return [];

  const results: IProcessResult[] = [];
  const concurrency = Math.max(1, env.EXTRACT_CONCURRENCY);
  const queue = [...batch];

  // Простой пул воркеров: каждый берёт следующий документ, пока очередь не пуста.
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const doc = queue.shift();
      if (!doc) return;
      try {
        results.push(await processDocument(doc));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[pipeline] док ${doc.id} упал: ${message}`);
        await execute(
          `UPDATE raw_documents SET status = 'queued', last_error = $2, updated_at = now() WHERE id = $1`,
          [doc.id, message],
        );
        results.push({ documentId: doc.id, status: 'failed', stats: null, error: message });
      }
    }
  });

  await Promise.all(workers);
  return results;
};
