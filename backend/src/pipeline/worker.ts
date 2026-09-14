// Воркер извлечения: очередь -> чанкинг -> LLM -> проверка -> канонический слой.
//
// Конкурентность намеренно низкая (EXTRACT_CONCURRENCY, по умолчанию 2).
// Узкое место — GPU, а не БД: больше воркеров дадут очередь на видеокарте
// и таймауты, а не пропускную способность.

import { env } from '../config/env.js';
import { getPool, withTransaction, query, execute } from '../db/pool.js';
import { extractFromText } from '../llm/client.js';
import { SCHEMA_VERSION, emptyExtraction, type IExtraction } from '../llm/schema.js';
import { approvedPolicySql } from '../ingest/policy.js';
import { applyExtraction, clearDocumentContribution, type IApplyStats } from './apply.js';
import { assertCanonWriteAllowed } from './guard.js';
import { verifyExtraction } from './verify.js';

/**
 * Размер чанка — главный рычаг против таймаутов LLM.
 *
 * Телеграм-пост почти всегда влезает целиком; режутся только длинные статьи.
 * Меньший чанк быстрее генерируется и реже упирается в лимит времени, но
 * факт, разорванный границей, модель может не увидеть — отсюда перекрытие.
 *
 * Значения из env: подбирать их надо под конкретную модель и видеокарту,
 * а не править код.
 */
const CHUNK_OVERLAP = 400;

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
       SELECT d.id FROM raw_documents d
       JOIN sources s ON s.id = d.source_id
       WHERE d.status IN ('new', 'queued') AND d.attempts < $2
         -- тексты уходят модели только у источников с допуском к ИИ-обработке
         AND ${approvedPolicySql('s', 'ai_processing')}
       ORDER BY d.published_at DESC NULLS LAST, d.id
       FOR UPDATE OF d SKIP LOCKED
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

export interface IChunkPlan {
  chunks: string[];
  /** Весь текст попал хотя бы в один чанк. */
  complete: boolean;
  /** До какого символа текст покрыт чанками. */
  coveredChars: number;
  totalChars: number;
}

/**
 * Нарезка с честным покрытием. Раньше текст сначала обрезался до
 * chunkSize * maxChunks, а из-за перекрытия чанки не покрывали даже этот
 * предел — хвост статьи терялся молча, и документ всё равно считался
 * разобранным. Теперь нарезка не обрезает, а сообщает, покрыт ли текст.
 */
export const planChunks = (
  body: string,
  chunkSize = env.EXTRACT_CHUNK_SIZE,
  maxChunks = env.EXTRACT_MAX_CHUNKS,
): IChunkPlan => {
  if (body.length <= chunkSize) {
    return { chunks: [body], complete: true, coveredChars: body.length, totalChars: body.length };
  }

  const chunks: string[] = [];
  let start = 0;
  let coveredChars = 0;
  while (start < body.length && chunks.length < maxChunks) {
    const end = Math.min(start + chunkSize, body.length);
    // Стараемся резать по границе абзаца: разорванное предложение ломает цитаты.
    const boundary = end < body.length ? body.lastIndexOf('\n', end) : end;
    const cut = boundary > start + chunkSize / 2 ? boundary : end;
    chunks.push(body.slice(start, cut));
    coveredChars = cut;
    if (cut >= body.length) break;
    // Перекрытие не должно откатывать начало назад дальше текущего чанка.
    start = Math.max(cut - CHUNK_OVERLAP, start + 1);
  }
  return { chunks, complete: coveredChars >= body.length, coveredChars, totalChars: body.length };
};

/** Только чанки — для мест, где покрытие проверяется отдельно. */
export const splitIntoChunks = (
  body: string,
  chunkSize = env.EXTRACT_CHUNK_SIZE,
  maxChunks = env.EXTRACT_MAX_CHUNKS,
): string[] => planChunks(body, chunkSize, maxChunks).chunks;

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

export class ExtractionPayloadMismatchError extends Error {
  constructor(
    readonly documentId: number,
    readonly chunkIndex: number,
  ) {
    super(
      `док ${documentId}, чанк ${chunkIndex}: сохранённый ответ модели отличается от нового ` +
        'при тех же промпте и модели — запись остановлена, чтобы канон не ссылался на чужой ответ',
    );
    this.name = 'ExtractionPayloadMismatchError';
  }
}

/**
 * Запись ответа модели по ключу (документ, чанк, промпт, модель).
 *
 *  - Нет строки — вставляем.
 *  - Есть строка-ошибка — заменяем: иначе успешный повтор после сбоя LLM
 *    никогда не записывался, а документ зависал между queued и extracting.
 *  - Есть успешная строка с тем же ответом — возвращаем её id.
 *  - Есть успешная строка с другим ответом — останавливаемся: сохранённый
 *    успешный ответ не перезаписывается, а применять новый, привязывая его
 *    к старой строке, нельзя — происхождение станет невоспроизводимым.
 */
export const recordExtraction = async (
  documentId: number,
  chunkIndex: number,
  status: string,
  payload: unknown,
  rawResponse: string | null,
  usage: { tokensIn: number | null; tokensOut: number | null; latencyMs: number },
): Promise<number | null> => {
  const payloadJson = payload === null ? null : JSON.stringify(payload);
  const res = await getPool().query<{ id: number }>(
    `INSERT INTO extractions
       (document_id, chunk_index, prompt_version, model, schema_version, status,
        payload, raw_response, tokens_in, tokens_out, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (document_id, chunk_index, prompt_version, model)
     DO UPDATE SET schema_version = EXCLUDED.schema_version, status = EXCLUDED.status,
                   payload = EXCLUDED.payload, raw_response = EXCLUDED.raw_response,
                   tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out,
                   latency_ms = EXCLUDED.latency_ms, created_at = now(), applied_at = NULL
     WHERE extractions.status <> 'ok'
     RETURNING id`,
    [
      documentId,
      chunkIndex,
      env.PROMPT_VERSION,
      env.LMSTUDIO_MODEL,
      SCHEMA_VERSION,
      status,
      payloadJson,
      rawResponse,
      usage.tokensIn,
      usage.tokensOut,
      usage.latencyMs,
    ],
  );
  const insertedId = res.rows[0]?.id;
  if (insertedId !== undefined) return insertedId;

  // Конфликт с успешной строкой.
  const existing = await getPool().query<{ id: number; same: boolean }>(
    `SELECT id, (payload IS NOT DISTINCT FROM $5::jsonb) AS same
     FROM extractions
     WHERE document_id = $1 AND chunk_index = $2 AND prompt_version = $3 AND model = $4`,
    [documentId, chunkIndex, env.PROMPT_VERSION, env.LMSTUDIO_MODEL, payloadJson],
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (status === 'ok' && !row.same) throw new ExtractionPayloadMismatchError(documentId, chunkIndex);
  return row.id;
};

const markDocumentFailed = async (documentId: number, reason: string): Promise<void> => {
  await execute(
    `UPDATE raw_documents SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
    [documentId, reason],
  );
};

export const processDocument = async (doc: IQueuedDocument): Promise<IProcessResult> => {
  const plan = planChunks(doc.body);
  if (!plan.complete) {
    // Неполный разбор не подменяет полный: прежний вклад документа остаётся,
    // а причина видна в --errors.
    const reason =
      `incomplete: текст длиннее лимита чанков, покрыто ${plan.coveredChars} из ${plan.totalChars} символов ` +
      '(EXTRACT_CHUNK_SIZE / EXTRACT_MAX_CHUNKS)';
    await markDocumentFailed(doc.id, reason);
    return { documentId: doc.id, status: 'failed', stats: null, error: reason };
  }

  const chunks = plan.chunks;
  const parts: IExtraction[] = [];
  let firstExtractionId: number | null = null;
  let lastError: string | null = null;
  let failedChunks = 0;

  for (const [index, chunk] of chunks.entries()) {
    const result = await extractFromText({ body: chunk, publishedAt: doc.published_at });

    if (result.ok && result.truncatedInput) {
      // Повтор после невалидного JSON шёл на укороченном тексте: ответ
      // описывает не весь чанк. Сохраняем как ошибку, в канон не пускаем.
      failedChunks += 1;
      lastError = `incomplete: чанк ${index} разобран только частично (повтор на укороченном тексте)`;
      await recordExtraction(doc.id, index, 'invalid_json', null, lastError, result.usage);
    } else if (result.ok) {
      const id = await recordExtraction(doc.id, index, 'ok', result.data, null, result.usage);
      firstExtractionId ??= id;
      parts.push(result.data);
    } else {
      failedChunks += 1;
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
    await markDocumentFailed(doc.id, lastError ?? 'ни один чанк не разобран');
    return { documentId: doc.id, status: 'failed', stats: null, error: lastError };
  }

  if (failedChunks > 0) {
    // Частично успешный разбор раньше применялся как полный и стирал прежний
    // вклад документа. Теперь документ остаётся с прежним вкладом.
    const reason = `incomplete: разобрано ${parts.length} из ${chunks.length} чанков; последняя ошибка: ${lastError ?? '—'}`;
    await markDocumentFailed(doc.id, reason);
    return { documentId: doc.id, status: 'failed', stats: null, error: reason };
  }

  const merged = mergeChunkExtractions(parts);
  const publishedAt = doc.published_at ?? new Date();
  const verified = verifyExtraction(merged, doc.body, doc.published_at);

  if (!verified.relevant) {
    // Документ мог быть релевантным в прошлой версии промпта и оставить
    // упоминания в карточках. Если снять только статус, они повиснут навсегда:
    // в apply нерелевантный документ больше не заходит. Очистка и смена статуса
    // — одной транзакцией, чтобы не остаться с полуубранным вкладом.
    await withTransaction(async client => {
      await clearDocumentContribution(client, doc.id);
      await client.query(
        `UPDATE raw_documents SET status = 'skipped', updated_at = now() WHERE id = $1`,
        [doc.id],
      );
    });
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
    // Раньше статус не обновлялся, и документ навсегда застревал в extracting.
    await markDocumentFailed(doc.id, 'нет строки extractions');
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
  // До любого запроса к БД: проход меняет статусы и канон.
  assertCanonWriteAllowed();
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
