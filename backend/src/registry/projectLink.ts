import type { PoolClient } from 'pg';

/** Stable object ID wins over a mutable title on later browser captures. */
export const linkedRegistryProject = async (
  client: PoolClient,
  sourceId: number,
  externalRef: string,
  requestedProjectId?: number,
): Promise<number | null> => {
  const rows = (await client.query<{ project_id: number; merged_into_id: number | null }>(
    `SELECT DISTINCT r.project_id, p.merged_into_id
     FROM registry_records r JOIN projects p ON p.id = r.project_id
     WHERE r.source_id = $1 AND r.record_type = 'object' AND r.external_ref = $2 AND r.project_id IS NOT NULL`,
    [sourceId, externalRef],
  )).rows;
  const linked = [...new Set(rows.map(row => row.merged_into_id ?? row.project_id))];
  if (linked.length > 1) throw new Error(`объект ДОМ.РФ ${externalRef} связан с несколькими карточками портала`);

  if (requestedProjectId !== undefined) {
    if (!Number.isSafeInteger(requestedProjectId) || requestedProjectId <= 0) throw new Error('ID карточки портала должен быть положительным целым числом');
    const project = (await client.query<{ merged_into_id: number | null }>(
      'SELECT merged_into_id FROM projects WHERE id = $1', [requestedProjectId],
    )).rows[0];
    if (!project) throw new Error(`карточка портала #${requestedProjectId} не найдена`);
    if (project.merged_into_id !== null) throw new Error(`карточка портала #${requestedProjectId} объединена с #${project.merged_into_id}`);
    if (linked.length && linked[0] !== requestedProjectId) {
      throw new Error(`объект ДОМ.РФ ${externalRef} уже связан с карточкой #${linked[0]}`);
    }
    return requestedProjectId;
  }
  return linked[0] ?? null;
};

/** Also works when an identical capture produced no new revision. */
export const attachBrowserCaptureToProject = async (
  client: PoolClient,
  sourceId: number,
  externalRef: string,
  projectId: number,
): Promise<void> => {
  await linkedRegistryProject(client, sourceId, externalRef, projectId);
  await client.query(
    `UPDATE registry_records SET project_id = $3
     WHERE source_id = $1 AND record_type = 'object' AND external_ref = $2
       AND payload->>'captureMethod' = 'browser_page' AND project_id IS NULL`,
    [sourceId, externalRef, projectId],
  );
};
