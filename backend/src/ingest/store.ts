// Запись сырых документов. Вся дедупликация опирается на уникальные индексы
// БД, а не на предварительную проверку SELECT'ом: между проверкой и вставкой
// параллельный воркер успеет вставить ту же строку.

import type { PoolClient } from 'pg';

import { getPool, query, queryOne, type DbExecutor } from '../db/pool.js';
import { computeHashes, isTooShortToProcess } from './dedup.js';

export interface IIncomingDocument {
  sourceId: number;
  sourceRunId: number | null;
  externalId: string | null;
  url: string | null;
  title: string | null;
  body: string;
  publishedAt: Date | null;
  forwardFrom: string | null;
  lang?: string | null;
}

export type StoreOutcome =
  /** Новый текст, документ создан и поставлен в очередь на извлечение. */
  | 'inserted'
  /** Такой текст уже есть (репост/перепечатка) — записали ещё одно наблюдение. */
  | 'duplicate'
  /** Пост слишком короткий: реакция, стикер, голая ссылка. */
  | 'too_short'
  /** Тот же external_id, но текст изменился — пост отредактировали. */
  | 'edited_skipped';

export interface IStoreResult {
  outcome: StoreOutcome;
  documentId: number | null;
}

const INSERT_SQL = `
  INSERT INTO raw_documents
    (source_id, source_run_id, external_id, url, title, body, lang,
     published_at, content_hash, lead_hash, body_len, forward_from, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new')
  ON CONFLICT DO NOTHING
  RETURNING id
`;

/**
 * ON CONFLICT DO NOTHING без указания цели — намеренно: на таблице два
 * уникальных индекса (content_hash и source_id+external_id), и конфликт может
 * прийти по любому. С указанной целью второй конфликт улетел бы исключением.
 */
export const storeDocument = async (
  doc: IIncomingDocument,
  executor?: DbExecutor,
): Promise<IStoreResult> => {
  if (isTooShortToProcess(doc.body)) {
    return { outcome: 'too_short', documentId: null };
  }

  const exec = executor ?? getPool();
  const { contentHash, leadHash } = computeHashes(doc.body);

  const inserted = await exec.query<{ id: number }>(INSERT_SQL, [
    doc.sourceId,
    doc.sourceRunId,
    doc.externalId,
    doc.url,
    doc.title,
    doc.body,
    doc.lang ?? null,
    doc.publishedAt,
    contentHash,
    leadHash,
    doc.body.length,
    doc.forwardFrom,
  ]);

  const newId = inserted.rows[0]?.id;
  if (newId !== undefined) {
    // Первое наблюдение фиксируем тоже: иначе у документа, увиденного в трёх
    // каналах, в истории будет два источника вместо трёх.
    await recordSighting(exec, newId, doc);
    return { outcome: 'inserted', documentId: newId };
  }

  // Вставка не прошла. Разбираемся, по какому из двух индексов.
  const existing = await exec.query<{ id: number }>(
    'SELECT id FROM raw_documents WHERE content_hash = $1',
    [contentHash],
  );
  const existingId = existing.rows[0]?.id;

  if (existingId !== undefined) {
    await recordSighting(exec, existingId, doc);
    return { outcome: 'duplicate', documentId: existingId };
  }

  // Текста с таким хэшем нет — значит конфликт был по (source_id, external_id):
  // пост с тем же id, но другим содержимым, то есть отредактированный.
  // Перечитывание правок за рамками MVP: молча перезаписать body нельзя,
  // к нему уже могут быть привязаны mentions и events.
  return { outcome: 'edited_skipped', documentId: null };
};

const recordSighting = async (
  exec: DbExecutor,
  documentId: number,
  doc: IIncomingDocument,
): Promise<void> => {
  await exec.query(
    `INSERT INTO document_sightings (document_id, source_id, external_id, url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, source_id, external_id) DO NOTHING`,
    [documentId, doc.sourceId, doc.externalId, doc.url],
  );
};

export interface IBatchStats {
  inserted: number;
  duplicate: number;
  tooShort: number;
  editedSkipped: number;
}

export const emptyBatchStats = (): IBatchStats => ({
  inserted: 0,
  duplicate: 0,
  tooShort: 0,
  editedSkipped: 0,
});

/** Пакетная запись в одной транзакции. Возвращает разбивку по исходам. */
export const storeDocuments = async (
  docs: readonly IIncomingDocument[],
  client: PoolClient,
): Promise<IBatchStats> => {
  const stats = emptyBatchStats();
  for (const doc of docs) {
    const { outcome } = await storeDocument(doc, client);
    if (outcome === 'inserted') stats.inserted += 1;
    else if (outcome === 'duplicate') stats.duplicate += 1;
    else if (outcome === 'too_short') stats.tooShort += 1;
    else stats.editedSkipped += 1;
  }
  return stats;
};

/** Сводка по сырому слою — для CLI и админки. */
export const getIngestSummary = async (): Promise<{
  documents: number;
  pending: number;
  duplicateSightings: number;
}> => {
  const row = await queryOne<{ documents: number; pending: number; sightings: number }>(
    `SELECT
       (SELECT count(*) FROM raw_documents)::int                                  AS documents,
       (SELECT count(*) FROM raw_documents WHERE status IN ('new','queued'))::int AS pending,
       (SELECT count(*) FROM document_sightings)::int                             AS sightings`,
  );
  return {
    documents: row?.documents ?? 0,
    pending: row?.pending ?? 0,
    // Наблюдений всегда >= документов; разница и есть пойманные репосты.
    duplicateSightings: Math.max(0, (row?.sightings ?? 0) - (row?.documents ?? 0)),
  };
};

/** Доля дублей за период — критерий приёмки M1 (< 2 %). */
export const getDuplicateRate = async (days = 1): Promise<number> => {
  const rows = await query<{ docs: number; sightings: number }>(
    `SELECT
       (SELECT count(*) FROM raw_documents WHERE fetched_at > now() - ($1 || ' days')::interval)::int AS docs,
       (SELECT count(*) FROM document_sightings WHERE seen_at > now() - ($1 || ' days')::interval)::int AS sightings`,
    [String(days)],
  );
  const row = rows[0];
  if (!row || row.sightings === 0) return 0;
  return (row.sightings - row.docs) / row.sightings;
};
