// Текущая доступность содержимого снимка (этап 08B). Payload не меняется: при выдаче цитаты источника, чей допуск
// сейчас не позволяет выдачу, скрываются tombstone с причиной. Снимок не обходит текущие ограничения.

import type { DbExecutor } from '../db/pool.js';
import { evaluateSourcePolicy, type PermissionStatus } from '../ingest/policy.js';
import type { ISnapshotPayload } from './build.js';

export const REDACTED_QUOTE = '[фрагмент вымаран по решению оператора]';

export interface IAvailability {
  checkedAt: string;
  withheldSources: Array<{ sourceId: number; sourceKey: string; reason: string }>;
  withheldEvidence: number;
}

/** Решение по текущему допуску источников, упомянутых в снимке. */
export const loadAvailability = async (exec: DbExecutor, payload: ISnapshotPayload, now: Date = new Date()): Promise<IAvailability> => {
  const ids = [...new Set(payload.sources.map(s => s.sourceId))];
  const rows = (
    await exec.query<{ id: number; key: string; accessStatus: PermissionStatus; aiProcessingStatus: PermissionStatus; policyExpiresAt: Date | null }>(
      `SELECT id, key, access_status AS "accessStatus", ai_processing_status AS "aiProcessingStatus", policy_expires_at AS "policyExpiresAt"
       FROM sources WHERE id = ANY($1::bigint[])`,
      [ids],
    )
  ).rows;
  const withheldSources = rows
    .map(r => ({ r, d: evaluateSourcePolicy({ key: r.key, accessStatus: r.accessStatus, aiProcessingStatus: r.aiProcessingStatus, policyExpiresAt: r.policyExpiresAt }, 'collect', now) }))
    .filter(x => !x.d.allowed)
    .map(x => ({ sourceId: x.r.id, sourceKey: x.r.key, reason: x.d.reason ?? 'допуск источника не позволяет выдачу' }));
  const denied = new Set(withheldSources.map(s => s.sourceId));
  // Источник, удалённый из реестра, тоже недоступен.
  const known = new Set(rows.map(r => r.id));
  for (const id of ids) {
    if (!known.has(id)) {
      withheldSources.push({ sourceId: id, sourceKey: `#${id}`, reason: 'источник отсутствует в реестре' });
      denied.add(id);
    }
  }
  return {
    checkedAt: now.toISOString(),
    withheldSources,
    withheldEvidence: payload.sources.filter(s => denied.has(s.sourceId) && s.quote !== null).length,
  };
};

/** Копия payload для показа и экспорта: цитаты недоступных источников заменены пометкой. Хранимый payload не трогается. */
export const applyAvailability = (payload: ISnapshotPayload, availability: IAvailability): ISnapshotPayload => {
  const copy = JSON.parse(JSON.stringify(payload)) as ISnapshotPayload;
  const reasons = new Map(availability.withheldSources.map(s => [s.sourceId, s.reason]));
  const hiddenEvidence = new Set<number>();
  for (const s of copy.sources) {
    const reason = reasons.get(s.sourceId);
    if (reason && s.quote !== null) {
      s.quote = null;
      s.withheldReason = `Скрыто при выдаче: ${reason}`;
      hiddenEvidence.add(s.evidenceId);
    }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.quotes)) {
        obj.quotes = (obj.quotes as Array<{ evidenceId: number }>).filter(q => !hiddenEvidence.has(q.evidenceId));
      }
      Object.values(obj).forEach(visit);
    }
  };
  visit(copy.dossier);
  if (hiddenEvidence.size > 0) {
    copy.limitations = [
      ...copy.limitations,
      `При выдаче скрыто цитат: ${hiddenEvidence.size} — допуск источника изменился после создания снимка. Hash относится к хранимому содержанию.`,
    ];
  }
  return copy;
};

/** Вымарывание фрагмента в payload: цитата заменяется пометкой везде, где встречается. Возвращает новую копию. */
export const redactEvidence = (payload: ISnapshotPayload, evidenceId: number): { payload: ISnapshotPayload; found: boolean } => {
  const copy = JSON.parse(JSON.stringify(payload)) as ISnapshotPayload;
  let found = false;
  for (const s of copy.sources) {
    if (s.evidenceId === evidenceId) {
      s.quote = REDACTED_QUOTE;
      s.withheldReason = 'вымарано по решению оператора';
      found = true;
    }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.quotes)) {
        for (const q of obj.quotes as Array<{ evidenceId: number; quote: string }>) {
          if (q.evidenceId === evidenceId) {
            q.quote = REDACTED_QUOTE;
            found = true;
          }
        }
      }
      Object.values(obj).forEach(visit);
    }
  };
  visit(copy.dossier);
  return { payload: copy, found };
};
