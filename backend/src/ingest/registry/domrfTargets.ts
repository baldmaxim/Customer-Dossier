// Очередь адресов ДОМ.РФ для браузерного чтения агентом.
// Добавление URL не делает HTTP-запросов и не включает сетевой адаптер реестра.

import type { PoolClient } from 'pg';

import { query, withTransaction } from '../../db/pool.js';

export interface IDomRfTarget {
  id: number;
  externalRef: string;
  url: string;
  projectId: number | null;
  projectName: string | null;
  requestedAt: string;
  capturedAt: string | null;
  revisionId: number | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
  status: 'pending' | 'captured';
}

export class DomRfTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomRfTargetError';
  }
}

export const parseDomRfObjectUrl = (raw: string): { url: string; externalRef: string } => {
  let parsed: URL;
  try { parsed = new URL(raw.trim()); }
  catch { throw new DomRfTargetError('Укажите полную ссылку на карточку объекта ДОМ.РФ'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'xn--80az8a.xn--d1aqf.xn--p1ai' || parsed.port || parsed.username || parsed.password) {
    throw new DomRfTargetError('Допустимы только HTTPS-ссылки на наш.дом.рф');
  }
  let path: string;
  try { path = decodeURIComponent(parsed.pathname); }
  catch { throw new DomRfTargetError('Некорректный адрес карточки объекта'); }
  const match = /^\/сервисы\/каталог-новостроек\/объект\/(\d{1,18})\/?$/.exec(path);
  if (!match) throw new DomRfTargetError('Нужна ссылка вида наш.дом.рф/сервисы/каталог-новостроек/объект/62087');
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `/сервисы/каталог-новостроек/объект/${match[1]}`;
  return { url: parsed.toString(), externalRef: match[1]! };
};

const columns = `t.id, t.external_ref AS "externalRef", t.url, t.project_id AS "projectId",
  p.name AS "projectName", t.requested_at AS "requestedAt", t.captured_at AS "capturedAt",
  t.last_revision_id AS "revisionId",
  t.attempt_count AS "attemptCount", t.last_attempt_at AS "lastAttemptAt",
  t.next_attempt_at AS "nextAttemptAt", t.last_error AS "lastError",
  CASE WHEN t.captured_at IS NULL OR t.captured_at < t.requested_at THEN 'pending' ELSE 'captured' END AS status`;

export const listDomRfTargets = async (pendingOnly = false): Promise<IDomRfTarget[]> =>
  query<IDomRfTarget>(
    `SELECT ${columns} FROM domrf_targets t LEFT JOIN projects p ON p.id = t.project_id
     ${pendingOnly ? 'WHERE t.captured_at IS NULL OR t.captured_at < t.requested_at' : ''}
     ORDER BY (t.captured_at IS NULL OR t.captured_at < t.requested_at) DESC, t.requested_at DESC, t.id DESC`,
  );

export const findDomRfTarget = async (client: PoolClient, externalRef: string): Promise<{ projectId: number | null } | null> =>
  (await client.query<{ projectId: number | null }>(
    'SELECT project_id AS "projectId" FROM domrf_targets WHERE external_ref = $1', [externalRef],
  )).rows[0] ?? null;

export const registerDomRfTarget = async (input: { url: string; projectId?: number | null }): Promise<IDomRfTarget> => {
  const parsed = parseDomRfObjectUrl(input.url);
  return withTransaction(async client => {
    const projectId = input.projectId ?? null;
    if (projectId !== null) {
      if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new DomRfTargetError('ID объекта портала должен быть положительным числом');
      const project = (await client.query<{ merged_into_id: number | null }>(
        'SELECT merged_into_id FROM projects WHERE id = $1', [projectId],
      )).rows[0];
      if (!project) throw new DomRfTargetError(`Объект портала №${projectId} не найден`);
      if (project.merged_into_id !== null) throw new DomRfTargetError(`Объект портала №${projectId} объединён с №${project.merged_into_id}`);
    }
    const existing = (await client.query<{ id: number; project_id: number | null }>(
      'SELECT id, project_id FROM domrf_targets WHERE external_ref = $1 FOR UPDATE', [parsed.externalRef],
    )).rows[0];
    if (existing) {
      if (projectId !== null && existing.project_id !== null && projectId !== existing.project_id) {
        throw new DomRfTargetError(`Ссылка уже привязана к объекту портала №${existing.project_id}`);
      }
      await client.query(
        `UPDATE domrf_targets SET project_id = coalesce(project_id, $2), url = $3, updated_at = now() WHERE id = $1`,
        [existing.id, projectId, parsed.url],
      );
    } else {
      await client.query(
        'INSERT INTO domrf_targets (external_ref, url, project_id) VALUES ($1, $2, $3)',
        [parsed.externalRef, parsed.url, projectId],
      );
    }
    const row = (await client.query<IDomRfTarget>(
      `SELECT ${columns} FROM domrf_targets t LEFT JOIN projects p ON p.id = t.project_id WHERE t.external_ref = $1`,
      [parsed.externalRef],
    )).rows[0];
    return row!;
  });
};

export const requestDomRfRescan = async (id: number): Promise<boolean> =>
  withTransaction(async client => {
    const result = await client.query('UPDATE domrf_targets SET requested_at = now(), next_attempt_at = NULL, last_error = NULL, attempt_count = 0, updated_at = now() WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  });

export const removeDomRfTarget = async (id: number): Promise<boolean> =>
  withTransaction(async client => {
    const result = await client.query('DELETE FROM domrf_targets WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  });

/**
 * Снятая карточка объекта перечитывается раз в неделю (решение владельца 02.10.2026): статус стройки,
 * срок сдачи и распроданность меняются. Повтор без изменений новой редакции не создаёт (store.ts).
 */
export const TARGET_TTL_DAYS = 7;

/**
 * Атомарная аренда одной карточки: второй процесс не возьмёт её до истечения lease. Сначала —
 * поставленные и не снятые (новые и «Повторить»), затем те, чей снимок старше недели, от самых старых.
 */
export const claimDomRfTarget = async (): Promise<IDomRfTarget | null> => withTransaction(async client => {
  const row = (await client.query<IDomRfTarget>(
    `SELECT ${columns} FROM domrf_targets t LEFT JOIN projects p ON p.id = t.project_id
     WHERE (t.captured_at IS NULL OR t.captured_at < t.requested_at OR t.captured_at < now() - make_interval(days => $1))
       AND (t.next_attempt_at IS NULL OR t.next_attempt_at <= now())
     ORDER BY (t.captured_at IS NULL OR t.captured_at < t.requested_at) DESC, t.requested_at, t.captured_at, t.id
     FOR UPDATE OF t SKIP LOCKED LIMIT 1`,
    [TARGET_TTL_DAYS],
  )).rows[0];
  if (!row) return null;
  await client.query(
    `UPDATE domrf_targets SET last_attempt_at = now(), next_attempt_at = now() + interval '5 minutes',
       attempt_count = attempt_count + 1, updated_at = now() WHERE id = $1`, [row.id],
  );
  return row;
});

export const failDomRfTarget = async (id: number, error: string, attempts: number): Promise<void> => {
  const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
  await query(
    `UPDATE domrf_targets SET last_error = $2, next_attempt_at = now() + ($3::int * interval '1 minute'),
       updated_at = now() WHERE id = $1`, [id, error.slice(0, 1000), delayMinutes],
  );
};

/** Ссылки карточки объекта на страницы застройщика и группы (этап 20D). */
export const setDomRfTargetRefs = async (externalRef: string, developerRef: string | null, groupRef: string | null): Promise<void> => {
  await query(
    `UPDATE domrf_targets SET developer_ref = coalesce($2, developer_ref), group_ref = coalesce($3, group_ref), updated_at = now()
     WHERE external_ref = $1`,
    [externalRef, developerRef, groupRef],
  );
};

/**
 * Реквизиты застройщика стали известны после снимка его объектов (страница застройщика не открылась
 * в тот раз) — объекты снимаются ещё раз, теперь со строкой «Застройщик объекта … ИНН …».
 */
export const requestRecaptureForDeveloper = async (developerRef: string): Promise<number> => {
  const result = await query<{ id: number }>(
    `UPDATE domrf_targets t SET requested_at = now(), next_attempt_at = NULL, updated_at = now()
     WHERE t.developer_ref = $1
       AND NOT (t.captured_at IS NULL OR t.captured_at < t.requested_at)
       AND NOT EXISTS (
         SELECT 1 FROM registry_records r
         WHERE r.record_type = 'object' AND r.external_ref = t.external_ref AND r.payload->>'developerCardRef' = $1)
     RETURNING t.id`,
    [developerRef],
  );
  return result.length;
};

export const markDomRfCaptured = async (
  client: PoolClient,
  externalRef: string,
  revisionId: number | null,
  projectId: number | null,
): Promise<void> => {
  await client.query(
    `UPDATE domrf_targets SET captured_at = now(), last_revision_id = coalesce($2, last_revision_id),
       project_id = coalesce(project_id, $3), next_attempt_at = NULL, last_error = NULL,
       attempt_count = 0, updated_at = now()
     WHERE external_ref = $1`,
    [externalRef, revisionId, projectId],
  );
};

/** Снятые карточки объектов, от свежих к старым: из них добор фото выбирает те, у кого снимка нет. */
export const listCapturedDomRfTargets = async (limit = 5000): Promise<Array<{ id: number; externalRef: string; url: string }>> =>
  query<{ id: number; externalRef: string; url: string }>(
    `SELECT id, external_ref AS "externalRef", url FROM domrf_targets
     WHERE captured_at IS NOT NULL ORDER BY captured_at DESC LIMIT $1`,
    [limit],
  );
