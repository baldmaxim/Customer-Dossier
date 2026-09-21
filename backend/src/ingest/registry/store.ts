// Запись записи реестра: редакция, снимок, канон (этапы 20A/20B).
//
// Общий путь для двух входов — сетевого обхода и импорта файла. Один код, потому
// что различие между ними только в способе получения ответа: дальше это одна и та
// же запись реестра, и правила у неё одни.
//
// Снимок и редакция — одной транзакцией: снимок без своей редакции не существует.
// Канон — отдельной: отказ публикации не должен уносить собранные данные.

import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { publishRegistryRecord, type IRegistrySkip } from '../../registry/publish.js';
import { itemIdentity } from '../../revisions/identity.js';
import type { ISource } from '../sources.js';
import { storeDocument, type IIncomingDocument, type StoreOutcome } from '../store.js';
import type { IRegistryRecord } from './map.js';
import { REGISTRY_PARSER_VERSION } from './profile.js';
import { saveRegistryRecord } from './records.js';
import { renderRecord, representationOf } from './render.js';

/**
 * Документ по записи реестра. Ключ публикации — сама запись (`ext:object:<id>`),
 * а не адрес: смена шаблона адреса не должна раздваивать историю записи.
 */
export const buildRegistryDocument = (
  source: ISource,
  record: IRegistryRecord,
  url: string,
  sourceRunId: number | null,
  fetchedAt: Date = new Date(),
): IIncomingDocument => {
  const asOf = record.identity.asOf;
  return {
    sourceId: source.id,
    sourceRunId,
    externalId: `${record.type}:${record.identity.externalRef}`,
    url,
    title: record.identity.name,
    body: renderRecord(record),
    publishedAt: asOf ? new Date(`${asOf}T00:00:00Z`) : null,
    publishedAtPrecision: asOf ? 'date_only' : null,
    publishedAtRaw: asOf,
    forwardFrom: null,
    representation: representationOf(record.type),
    completeness: 'full',
    completenessReason: `registry_fields:${record.fields.length}`,
    attachments: [],
    sourceModifiedAt: null,
    fetchedAt,
    parserVersion: REGISTRY_PARSER_VERSION,
  };
};

export interface IRegistryPersistResult {
  outcome: StoreOutcome;
  revisionId: number | null;
  /** Новая редакция — значит есть и новый снимок, и повод опубликовать канон. */
  newRevision: boolean;
  assertions: number;
  skipped: IRegistrySkip[];
  /** Отказ публикации: собранное сохранено, канон — нет. */
  publishError: string | null;
}

export const persistRegistryRecord = async (input: {
  source: ISource;
  record: IRegistryRecord;
  doc: IIncomingDocument;
  /** Дополнительная запись в той же транзакции (условный кэш сетевого пути). */
  alsoInTransaction?: (client: PoolClient) => Promise<void>;
}): Promise<IRegistryPersistResult> => {
  const { source, record, doc } = input;
  const itemKey = itemIdentity({ externalId: doc.externalId, url: doc.url, body: doc.body }).key;
  const result: IRegistryPersistResult = {
    outcome: 'unchanged',
    revisionId: null,
    newRevision: false,
    assertions: 0,
    skipped: [],
    publishError: null,
  };

  await withTransaction(async (client: PoolClient) => {
    const stored = await storeDocument(doc, client);
    result.outcome = stored.outcome;
    result.revisionId = stored.revisionId;
    result.newRevision =
      (stored.outcome === 'inserted' || stored.outcome === 'duplicate' || stored.outcome === 'new_revision') && stored.revisionId !== null;
    if (result.newRevision && stored.revisionId !== null) {
      await saveRegistryRecord(client, {
        sourceId: source.id,
        itemKey,
        revisionId: stored.revisionId,
        record,
        fetchedAt: doc.fetchedAt ?? new Date(),
      });
    }
    if (input.alsoInTransaction) await input.alsoInTransaction(client);
  });

  if (!result.newRevision || result.revisionId === null || !env.REGISTRY_PUBLISH_ENABLED) return result;
  try {
    const published = await withTransaction(client =>
      publishRegistryRecord(client, { revisionId: result.revisionId!, body: doc.body, record }),
    );
    result.assertions = published.assertions;
    result.skipped = published.skipped;
  } catch (err) {
    // Собранное остаётся в базе; повторная публикация возможна следующим разбором.
    result.publishError = err instanceof Error ? err.message : String(err);
  }
  return result;
};
