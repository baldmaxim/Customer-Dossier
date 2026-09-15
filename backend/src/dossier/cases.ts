// Обращения (DossierCase, этап 08A): то, что ввёл оператор со слов обратившегося.
//
// Всё содержимое — provenance operator_recorded_claim: заявленная роль, заявленный заказчик и условия
// не становятся утверждениями и доказательствами. Юрлицо либо выбрано из базы, либо явно «не установлено»
// с названием со слов — одноимённые компании не подставляются. Изменение — с ожидаемой версией;
// каждая версия сохраняется целиком в неизменяемой истории.

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { getPool, withTransaction, type DbExecutor } from '../db/pool.js';
import { groundWorkPackage } from '../reprocess/semantic/values.js';

export const CLAIMED_ROLES = ['customer', 'general_contractor', 'contractor', 'subcontractor', 'supplier', 'designer', 'investor', 'operator'] as const;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform(v => (v ? v : null));

const baseShape = {
  title: z.string().trim().min(1).max(300),
  companyId: z.number().int().positive().nullish().transform(v => v ?? null),
  companyNameClaimed: text(300),
  projectId: z.number().int().positive().nullish().transform(v => v ?? null),
  projectNameClaimed: text(300),
  scopeBuilding: text(120),
  workPackageLabel: text(200),
  claimedRole: z.enum(CLAIMED_ROLES).nullish().transform(v => v ?? null),
  claimedClientCompanyId: z.number().int().positive().nullish().transform(v => v ?? null),
  claimedClientName: text(300),
  claimedTerms: text(2000),
  requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operatorNote: text(4000),
  status: z.enum(['open', 'closed']).default('open'),
};

const companyRule = (v: { companyId: number | null; companyNameClaimed: string | null }): boolean =>
  v.companyId !== null || v.companyNameClaimed !== null;
const COMPANY_MESSAGE = 'Выберите юрлицо из базы или укажите название со слов обратившегося («юрлицо не установлено»)';

export const createCaseSchema = z
  .object({ ...baseShape, idempotencyKey: z.string().min(8).max(200).optional() })
  .refine(companyRule, { message: COMPANY_MESSAGE, path: ['companyId'] });

export const updateCaseSchema = z
  .object({ ...baseShape, expectedVersion: z.number().int().positive() })
  .refine(companyRule, { message: COMPANY_MESSAGE, path: ['companyId'] });

export type ICaseCreate = z.infer<typeof createCaseSchema>;
export type ICaseUpdate = z.infer<typeof updateCaseSchema>;

export class CaseVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super('Обращение изменилось в другой вкладке. Обновите и внесите правки заново.');
    this.name = 'CaseVersionConflictError';
  }
}

export class CaseNotFoundError extends Error {
  constructor(what = 'Обращение') {
    super(`${what} не найдено`);
    this.name = 'CaseNotFoundError';
  }
}

export interface ICaseRow {
  id: number;
  title: string;
  companyStatus: 'identified' | 'unidentified';
  companyId: number | null;
  companyName: string | null;
  companyNameClaimed: string | null;
  projectId: number | null;
  projectName: string | null;
  projectNameClaimed: string | null;
  scopeBuilding: string | null;
  workPackage: string | null;
  workPackageLabel: string | null;
  claimedRole: string | null;
  claimedClientCompanyId: number | null;
  claimedClientCompanyName: string | null;
  claimedClientName: string | null;
  claimedTerms: string | null;
  requestDate: string;
  operatorNote: string | null;
  status: 'open' | 'closed';
  provenance: 'operator_recorded_claim';
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const COLUMNS = `
  dc.id, dc.title, dc.company_status AS "companyStatus", dc.company_id AS "companyId", c.name AS "companyName",
  dc.company_name_claimed AS "companyNameClaimed", dc.project_id AS "projectId", p.name AS "projectName",
  dc.project_name_claimed AS "projectNameClaimed", dc.scope_building AS "scopeBuilding", dc.work_package AS "workPackage",
  dc.work_package_label AS "workPackageLabel", dc.claimed_role AS "claimedRole",
  dc.claimed_client_company_id AS "claimedClientCompanyId", cc.name AS "claimedClientCompanyName",
  dc.claimed_client_name AS "claimedClientName", dc.claimed_terms AS "claimedTerms", dc.request_date::text AS "requestDate",
  dc.operator_note AS "operatorNote", dc.status, dc.provenance, dc.version, dc.created_by AS "createdBy",
  dc.created_at AS "createdAt", dc.updated_at AS "updatedAt"`;

const FROM = `
  FROM dossier_cases dc
  LEFT JOIN companies c ON c.id = dc.company_id
  LEFT JOIN projects p ON p.id = dc.project_id
  LEFT JOIN companies cc ON cc.id = dc.claimed_client_company_id`;

export const getCase = async (exec: DbExecutor, id: number): Promise<ICaseRow | null> =>
  (await exec.query<ICaseRow>(`SELECT ${COLUMNS} ${FROM} WHERE dc.id = $1`, [id])).rows[0] ?? null;

/** Юрлицо и объект должны существовать и не быть слитыми; слитые — переадресуются на живую сущность не молча, а отказом. */
const checkRefs = async (client: PoolClient, input: ICaseCreate | ICaseUpdate): Promise<void> => {
  const live = async (table: 'companies' | 'projects', id: number | null, what: string): Promise<void> => {
    if (id === null) return;
    const row = (await client.query<{ merged_into_id: number | null }>(`SELECT merged_into_id FROM ${table} WHERE id = $1`, [id])).rows[0];
    if (!row) throw new CaseNotFoundError(what);
    if (row.merged_into_id !== null) throw new CaseNotFoundError(`${what} (слито в #${row.merged_into_id} — выберите заново)`);
  };
  await live('companies', input.companyId, 'Юрлицо');
  await live('companies', input.claimedClientCompanyId, 'Заявленный заказчик');
  await live('projects', input.projectId, 'Объект');
};

const values = (input: ICaseCreate | ICaseUpdate) => {
  const wp = input.workPackageLabel ? groundWorkPackage(input.workPackageLabel, input.workPackageLabel) : { normalized: null, label: null };
  return [
    input.title,
    input.companyId !== null ? 'identified' : 'unidentified',
    input.companyId,
    input.companyId !== null ? null : input.companyNameClaimed,
    input.projectId,
    input.projectNameClaimed,
    input.scopeBuilding,
    wp.normalized,
    input.workPackageLabel,
    input.claimedRole,
    input.claimedClientCompanyId,
    input.claimedClientName,
    input.claimedTerms,
    input.requestDate,
    input.operatorNote,
    input.status,
  ];
};

const recordVersion = async (client: PoolClient, id: number, actor: string): Promise<ICaseRow> => {
  const row = (await getCase(client, id))!;
  await client.query('INSERT INTO dossier_case_versions (case_id, version, snapshot, actor) VALUES ($1, $2, $3, $4)', [
    id,
    row.version,
    JSON.stringify(row),
    actor,
  ]);
  return row;
};

export const createCase = async (input: ICaseCreate, actor: string): Promise<{ row: ICaseRow; replayed: boolean }> =>
  withTransaction(async client => {
    if (input.idempotencyKey) {
      const prior = (await client.query<{ id: number }>('SELECT id FROM dossier_cases WHERE idempotency_key = $1', [input.idempotencyKey])).rows[0];
      if (prior) return { row: (await getCase(client, prior.id))!, replayed: true };
    }
    await checkRefs(client, input);
    const id = (
      await client.query<{ id: number }>(
        `INSERT INTO dossier_cases
           (title, company_status, company_id, company_name_claimed, project_id, project_name_claimed, scope_building,
            work_package, work_package_label, claimed_role, claimed_client_company_id, claimed_client_name, claimed_terms,
            request_date, operator_note, status, created_by, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING id`,
        [...values(input), actor, input.idempotencyKey ?? null],
      )
    ).rows[0]!.id;
    return { row: await recordVersion(client, id, actor), replayed: false };
  });

export const updateCase = async (id: number, input: ICaseUpdate, actor: string): Promise<ICaseRow> =>
  withTransaction(async client => {
    const current = (await client.query<{ version: number }>('SELECT version FROM dossier_cases WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!current) throw new CaseNotFoundError();
    if (current.version !== input.expectedVersion) throw new CaseVersionConflictError(current.version);
    await checkRefs(client, input);
    await client.query(
      `UPDATE dossier_cases SET
         title = $1, company_status = $2, company_id = $3, company_name_claimed = $4, project_id = $5, project_name_claimed = $6,
         scope_building = $7, work_package = $8, work_package_label = $9, claimed_role = $10, claimed_client_company_id = $11,
         claimed_client_name = $12, claimed_terms = $13, request_date = $14, operator_note = $15, status = $16,
         version = version + 1, updated_at = now()
       WHERE id = $17`,
      [...values(input), id],
    );
    return recordVersion(client, id, actor);
  });

export const listCases = async (options: { status: 'open' | 'closed' | null; before: number | null; limit: number }): Promise<{ items: ICaseRow[]; nextBefore: number | null }> => {
  const items = (
    await getPool().query<ICaseRow>(
      `SELECT ${COLUMNS} ${FROM}
       WHERE ($1::text IS NULL OR dc.status = $1::text) AND ($2::bigint IS NULL OR dc.id < $2::bigint)
       ORDER BY dc.id DESC LIMIT $3`,
      [options.status, options.before, options.limit],
    )
  ).rows;
  return { items, nextBefore: items.length === options.limit ? items[items.length - 1]!.id : null };
};

export const caseHistory = async (id: number): Promise<Array<{ version: number; actor: string; recordedAt: string; snapshot: ICaseRow }>> =>
  (
    await getPool().query<{ version: number; actor: string; recordedAt: string; snapshot: ICaseRow }>(
      'SELECT version, actor, recorded_at AS "recordedAt", snapshot FROM dossier_case_versions WHERE case_id = $1 ORDER BY version DESC LIMIT 100',
      [id],
    )
  ).rows;
