// Снимок записи реестра в registry_records (этап 20A).
//
// Одна строка на редакцию: текст редакции — доказательство, снимок — его типизированная
// форма. Повтор без изменений новой редакции не создаёт, значит и снимка не создаёт.

import type { PoolClient } from 'pg';

import type { IRegistryRecord } from './map.js';
import { REGISTRY_RENDER_VERSION } from './render.js';

export interface ISaveRegistryRecordInput {
  sourceId: number;
  itemKey: string;
  revisionId: number;
  record: IRegistryRecord;
  fetchedAt: Date;
}

/**
 * Записывает снимок. Повторный вызов по той же редакции ничего не меняет:
 * снимок принадлежит редакции, а не моменту сбора.
 */
export const saveRegistryRecord = async (client: PoolClient, input: ISaveRegistryRecordInput): Promise<void> => {
  await client.query(
    `INSERT INTO registry_records
       (source_id, item_key, record_type, external_ref, revision_id, as_of, fetched_at, payload, payload_hash, render_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     ON CONFLICT (revision_id) DO NOTHING`,
    [
      input.sourceId,
      input.itemKey,
      input.record.type,
      input.record.identity.externalRef,
      input.revisionId,
      input.record.identity.asOf,
      input.fetchedAt,
      JSON.stringify(input.record.payload),
      input.record.payloadHash,
      REGISTRY_RENDER_VERSION,
    ],
  );
};
