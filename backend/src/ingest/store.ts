// Запись документов — единственная точка входа для шедулера, бота и ручной
// вставки.
//
// Два слоя в одной транзакции:
//  1. публикация/редакция/наблюдение (revisions/store.ts) — личность публикации
//     и история её текста; правка поста — новая неизменяемая редакция;
//  2. legacy raw_documents + document_sightings — то, к чему привязаны текущие
//     цитаты и карточки. Legacy-документ создаётся только для ПЕРВОЙ редакции
//     новой публикации; текст существующего документа никогда не переписывается.
//
// Дедупликация legacy опирается на уникальные индексы БД, а не на SELECT до
// вставки: между проверкой и вставкой параллельный воркер успеет вставить ту же строку.

import type { PoolClient } from 'pg';

import { env } from '../config/env.js';
import { query, queryOne, withTransaction } from '../db/pool.js';
import {
  recordObservation,
  type IAttachment,
  type ILegacyLink,
  type PublishedAtPrecision,
  type TextCompleteness,
} from '../revisions/store.js';
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
  /** Адаптер и версия очистки текста. */
  representation?: string;
  /** Полнота текста по данным адаптера. Длина полноту не доказывает. */
  completeness?: TextCompleteness;
  completenessReason?: string | null;
  attachments?: IAttachment[];
  /** Дата изменения публикации, если источник её надёжно сообщает. */
  sourceModifiedAt?: Date | null;
  /** Когда адаптер получил ответ источника. По умолчанию — момент записи. */
  fetchedAt?: Date;
  publishedAtPrecision?: PublishedAtPrecision | null;
  publishedAtRaw?: string | null;
  parserVersion?: string | null;
}

export type StoreOutcome =
  /** Новая публикация, новый legacy-документ поставлен в очередь на извлечение. */
  | 'inserted'
  /** Новая публикация, но такой текст уже есть в legacy (репост/перепечатка). */
  | 'duplicate'
  /** Пост слишком короткий: реакция, стикер, голая ссылка. */
  | 'too_short'
  /** Текст публикации изменился — сохранена новая редакция; legacy-текст не тронут. */
  | 'new_revision'
  /** Повтор текущей редакции — только наблюдение. */
  | 'unchanged'
  /** Запоздалое наблюдение старого состояния — сохранено, текущим не стало. */
  | 'stale'
  /** Запись версий выключена (REVISION_WRITE_ENABLED=false): правка потеряна, как до этапа 02. */
  | 'edited_skipped';

export interface IStoreResult {
  outcome: StoreOutcome;
  /** Legacy-документ с цитатами, если есть. */
  documentId: number | null;
  sourceItemId: number | null;
  revisionId: number | null;
  revisionNo: number | null;
}

const INSERT_SQL = `
  INSERT INTO raw_documents
    (source_id, source_run_id, external_id, url, title, body, lang,
     published_at, content_hash, lead_hash, body_len, forward_from, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'new')
  ON CONFLICT DO NOTHING
  RETURNING id
`;

type LegacyOutcome = 'inserted' | 'duplicate' | 'edited_skipped';

/**
 * Legacy-запись. ON CONFLICT DO NOTHING без цели — намеренно: на таблице два
 * уникальных индекса (content_hash и source_id+external_id), конфликт возможен
 * по любому, и исход разбирается явно ниже.
 */
const storeLegacy = async (
  client: PoolClient,
  doc: IIncomingDocument,
): Promise<{ outcome: LegacyOutcome; documentId: number | null }> => {
  const { contentHash, leadHash } = computeHashes(doc.body);

  const inserted = await client.query<{ id: number }>(INSERT_SQL, [
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
    await recordSighting(client, newId, doc);
    return { outcome: 'inserted', documentId: newId };
  }

  const existing = await client.query<{ id: number }>('SELECT id FROM raw_documents WHERE content_hash = $1', [
    contentHash,
  ]);
  const existingId = existing.rows[0]?.id;
  if (existingId !== undefined) {
    await recordSighting(client, existingId, doc);
    return { outcome: 'duplicate', documentId: existingId };
  }

  // Конфликт по (source_id, external_id): legacy знает этот пост с другим текстом.
  // Переписать body нельзя — к нему привязаны цитаты.
  return { outcome: 'edited_skipped', documentId: null };
};

const storeInTransaction = async (client: PoolClient, doc: IIncomingDocument): Promise<IStoreResult> => {
  if (!env.REVISION_WRITE_ENABLED) {
    const legacy = await storeLegacy(client, doc);
    return { outcome: legacy.outcome, documentId: legacy.documentId, sourceItemId: null, revisionId: null, revisionNo: null };
  }

  // Объект, а не let: исход legacy узнаётся внутри колбэка.
  const legacyState: { outcome: LegacyOutcome | null } = { outcome: null };

  const observation = await recordObservation(
    client,
    {
      sourceId: doc.sourceId,
      sourceRunId: doc.sourceRunId,
      externalId: doc.externalId,
      url: doc.url,
      title: doc.title,
      body: doc.body,
      representation: doc.representation ?? 'unspecified@1',
      completeness: doc.completeness ?? 'unknown',
      completenessReason: doc.completenessReason ?? null,
      attachments: doc.attachments ?? [],
      publishedAt: doc.publishedAt,
      sourceModifiedAt: doc.sourceModifiedAt ?? null,
      fetchedAt: doc.fetchedAt ?? new Date(),
      forwardOrigin: doc.forwardFrom,
      publishedAtPrecision: doc.publishedAtPrecision ?? null,
      publishedAtRaw: doc.publishedAtRaw ?? null,
      parserVersion: doc.parserVersion ?? null,
    },
    async (): Promise<ILegacyLink> => {
      const legacy = await storeLegacy(client, doc);
      legacyState.outcome = legacy.outcome;
      return {
        legacyDocumentId: legacy.outcome === 'edited_skipped' ? null : legacy.documentId,
        historyUnknown: legacy.outcome === 'edited_skipped',
      };
    },
  );

  const base = {
    documentId: observation.legacyDocumentId,
    sourceItemId: observation.sourceItemId,
    revisionId: observation.revisionId,
    revisionNo: observation.revisionNo,
  };

  if (observation.outcome === 'new_item') {
    // Публикация новая для модели версий, но legacy уже знал её с другим
    // текстом (данные до миграции 011): это правка, а не новый документ.
    const outcome: StoreOutcome =
      legacyState.outcome === 'inserted'
        ? 'inserted'
        : legacyState.outcome === 'duplicate'
          ? 'duplicate'
          : 'new_revision';
    return { outcome, ...base };
  }
  return { outcome: observation.outcome, ...base };
};

export const storeDocument = async (doc: IIncomingDocument, client?: PoolClient): Promise<IStoreResult> => {
  if (isTooShortToProcess(doc.body)) {
    return { outcome: 'too_short', documentId: null, sourceItemId: null, revisionId: null, revisionNo: null };
  }
  // Публикация и legacy-документ пишутся атомарно: без транзакции блокировка
  // строки публикации не удержится, и параллельные наблюдения размножат редакции.
  return client ? storeInTransaction(client, doc) : withTransaction(tx => storeInTransaction(tx, doc));
};

const recordSighting = async (client: PoolClient, documentId: number, doc: IIncomingDocument): Promise<void> => {
  await client.query(
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
  newRevision: number;
  unchanged: number;
  stale: number;
  editedSkipped: number;
}

export const emptyBatchStats = (): IBatchStats => ({
  inserted: 0,
  duplicate: 0,
  tooShort: 0,
  newRevision: 0,
  unchanged: 0,
  stale: 0,
  editedSkipped: 0,
});

const STAT_KEY: Record<StoreOutcome, keyof IBatchStats> = {
  inserted: 'inserted',
  duplicate: 'duplicate',
  too_short: 'tooShort',
  new_revision: 'newRevision',
  unchanged: 'unchanged',
  stale: 'stale',
  edited_skipped: 'editedSkipped',
};

/** Пакетная запись в одной транзакции. Возвращает разбивку по исходам. */
export const storeDocuments = async (docs: readonly IIncomingDocument[], client: PoolClient): Promise<IBatchStats> => {
  const stats = emptyBatchStats();
  for (const doc of docs) {
    const { outcome } = await storeDocument(doc, client);
    stats[STAT_KEY[outcome]] += 1;
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
