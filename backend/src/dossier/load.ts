// Сборка входа досье из базы (этап 08A). Только чтение; модель и сеть не нужны.

import type { DbExecutor } from '../db/pool.js';
import { normalizeName } from '../resolve/normalize.js';
import { refreshState } from '../signals/refresh.js';
import { getCase } from './cases.js';
import { buildCaseDossier, type ICaseDossier } from './caseDossier.js';
import { loadCompanyFacts, loadHomonyms, loadOpenQueue, loadProjectFacts } from './facts.js';

export const loadProjectState = async (exec: DbExecutor, projectId: number) =>
  (
    await exec.query<{ building: string | null; state: string; validFrom: string; periodPrecision: string }>(
      `SELECT scope_building AS building, state, valid_from::text AS "validFrom", period_precision AS "periodPrecision"
       FROM project_current_state_v WHERE project_id = $1 ORDER BY coalesce(scope_building, '')`,
      [projectId],
    )
  ).rows;

export const loadIdentityStatus = async (exec: DbExecutor, companyId: number, refreshId: number | null): Promise<string | null> =>
  refreshId === null
    ? null
    : ((
        await exec.query<{ identity_status: string }>(
          'SELECT identity_status FROM company_signal_snapshots WHERE refresh_id = $1 AND company_id = $2',
          [refreshId, companyId],
        )
      ).rows[0]?.identity_status ?? null);

export const loadCaseDossier = async (exec: DbExecutor, caseId: number, now: Date = new Date()): Promise<ICaseDossier | null> => {
  const caseRow = await getCase(exec, caseId);
  if (!caseRow) return null;
  const refresh = await refreshState();

  const nameKey =
    caseRow.companyId !== null
      ? ((await exec.query<{ name_key: string }>('SELECT name_key FROM companies WHERE id = $1', [caseRow.companyId])).rows[0]?.name_key ?? '')
      : normalizeName(caseRow.companyNameClaimed ?? '', 'company').key;
  const homonyms = nameKey ? await loadHomonyms(exec, nameKey, caseRow.companyId) : [];

  const companyFacts = caseRow.companyId !== null ? await loadCompanyFacts(exec, caseRow.companyId) : [];
  const projectFacts = caseRow.projectId !== null ? await loadProjectFacts(exec, caseRow.projectId) : [];
  const projectState = caseRow.projectId !== null ? await loadProjectState(exec, caseRow.projectId) : [];
  const openQueue = await loadOpenQueue(exec, companyFacts.map(f => f.assertionId));
  const identityStatus = caseRow.companyId !== null ? await loadIdentityStatus(exec, caseRow.companyId, refresh.active?.id ?? null) : null;

  return buildCaseDossier({
    caseRow,
    generatedAt: now.toISOString(),
    refresh,
    identityStatus,
    homonyms,
    companyFacts,
    projectFacts,
    projectState,
    openQueue,
  });
};
