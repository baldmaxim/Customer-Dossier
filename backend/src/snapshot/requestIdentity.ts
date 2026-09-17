// Идентичность запроса снимка (snapshot-request@1, этап 13). Чистые функции.
//
// Ключ идемпотентности означает «повтор той же операции»: тот же ключ + то же намерение — тот же снимок, даже если
// живое досье с тех пор изменилось. Тот же ключ + другое намерение (другое обращение или период) — конфликт, а не
// чужой снимок. Снимок актуального состояния — новый ключ.

import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical.js';

export const SNAPSHOT_REQUEST_VERSION = 'snapshot-request@1';

export interface ISnapshotRequest {
  caseId: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export const snapshotRequestHash = (request: ISnapshotRequest): string =>
  createHash('sha256')
    .update(canonicalJson({ version: SNAPSHOT_REQUEST_VERSION, caseId: request.caseId, effectiveFrom: request.effectiveFrom, effectiveTo: request.effectiveTo }), 'utf8')
    .digest('hex');

export interface IStoredSnapshotRequest {
  requestHash: string | null;
  caseId: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/**
 * Совпадает ли сохранённый снимок с запросом. Снимок до этапа 13 (requestHash = NULL) сверяется только по действительно
 * сохранённым параметрам: обращение и период. Неизвестное совпадением не считается.
 */
export const sameSnapshotRequest = (stored: IStoredSnapshotRequest, request: ISnapshotRequest): boolean =>
  stored.requestHash !== null
    ? stored.requestHash === snapshotRequestHash(request)
    : stored.caseId === request.caseId && stored.effectiveFrom === request.effectiveFrom && stored.effectiveTo === request.effectiveTo;

export class SnapshotKeyConflictError extends Error {
  constructor() {
    super('Ключ идемпотентности уже использован для другого снимка (другое обращение или период). Для нового снимка нужен новый ключ.');
    this.name = 'SnapshotKeyConflictError';
  }
}
