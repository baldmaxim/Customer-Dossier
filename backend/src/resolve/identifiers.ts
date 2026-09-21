// Типизированные реквизиты компаний (этап 04).
//
// ИНН, ОГРН и ОГРНИП — разные типы: сравниваются только значения одного типа и
// юрисдикции. Корректная контрольная сумма подтверждает формат, а не то, что
// реквизит принадлежит упомянутой компании: принадлежность — из собственной
// цитаты сущности (pipeline/verify.ts) и ссылки на редакцию.

import type { DbExecutor } from '../db/pool.js';
import { isValidInn, isValidOgrn } from './normalize.js';

export type IdentifierType = 'inn' | 'ogrn' | 'ogrnip' | 'kpp' | 'bin' | 'other';

export interface ITypedIdentifier {
  jurisdiction: string;
  identifierType: IdentifierType;
  value: string;
  validationStatus: 'checksum_valid' | 'format_only' | 'unchecked';
}

/**
 * Тип по длине и контрольной сумме. 12 цифр — ИНН физлица/ИП; казахстанский БИН
 * той же длины из текста не отличить, поэтому он хранится как ИНН (решение 009).
 */
export const classifyTaxId = (raw: string): ITypedIdentifier | null => {
  const value = raw.replace(/[\s-]/g, '');
  if (/^[0-9]{10}$|^[0-9]{12}$/.test(value)) {
    return { jurisdiction: 'RU', identifierType: 'inn', value, validationStatus: isValidInn(value) ? 'checksum_valid' : 'format_only' };
  }
  if (/^[0-9]{13}$/.test(value)) {
    return { jurisdiction: 'RU', identifierType: 'ogrn', value, validationStatus: isValidOgrn(value) ? 'checksum_valid' : 'format_only' };
  }
  if (/^[0-9]{15}$/.test(value)) {
    return { jurisdiction: 'RU', identifierType: 'ogrnip', value, validationStatus: isValidOgrn(value) ? 'checksum_valid' : 'format_only' };
  }
  return null;
};

export interface IIdentifierRow {
  id: number;
  company_id: number;
  jurisdiction: string;
  identifier_type: IdentifierType;
  value: string;
}

/** Конфликт — тот же тип и юрисдикция, разные значения. Разные типы не конфликтуют. */
export const findIdentifierConflicts = (
  a: ReadonlyArray<Pick<IIdentifierRow, 'jurisdiction' | 'identifier_type' | 'value'>>,
  b: ReadonlyArray<Pick<IIdentifierRow, 'jurisdiction' | 'identifier_type' | 'value'>>,
): Array<{ type: string; left: string; right: string }> => {
  const conflicts: Array<{ type: string; left: string; right: string }> = [];
  for (const x of a) {
    for (const y of b) {
      if (x.jurisdiction === y.jurisdiction && x.identifier_type === y.identifier_type && x.value !== y.value) {
        conflicts.push({ type: `${x.jurisdiction}:${x.identifier_type}`, left: x.value, right: y.value });
      }
    }
  }
  return conflicts;
};

/** Активные реквизиты компании; legacy companies.tax_id без записи в реестре — тоже. */
export const loadIdentifiers = async (exec: DbExecutor, companyId: number): Promise<IIdentifierRow[]> => {
  const rows = (
    await exec.query<IIdentifierRow>(
      `SELECT id, company_id, jurisdiction, identifier_type, value
       FROM entity_identifiers WHERE company_id = $1 AND status = 'active' ORDER BY id`,
      [companyId],
    )
  ).rows;
  const legacy = (await exec.query<{ tax_id: string | null }>('SELECT tax_id FROM companies WHERE id = $1', [companyId])).rows[0]
    ?.tax_id;
  const typed = legacy ? classifyTaxId(legacy) : null;
  if (typed && !rows.some(r => r.identifier_type === typed.identifierType && r.value === typed.value)) {
    rows.push({ id: 0, company_id: companyId, jurisdiction: typed.jurisdiction, identifier_type: typed.identifierType, value: typed.value });
  }
  return rows;
};

/** Живая компания с этим реквизитом: реестр, затем legacy-проекция companies.tax_id. */
export const findCompanyByIdentifier = async (exec: DbExecutor, id: ITypedIdentifier): Promise<number | null> => {
  const registry = (
    await exec.query<{ company_id: number }>(
      `SELECT i.company_id FROM entity_identifiers i JOIN companies c ON c.id = i.company_id
       WHERE i.jurisdiction = $1 AND i.identifier_type = $2 AND i.value = $3 AND i.status = 'active'
         AND c.merged_into_id IS NULL`,
      [id.jurisdiction, id.identifierType, id.value],
    )
  ).rows[0];
  if (registry) return registry.company_id;
  const legacy = (
    await exec.query<{ id: number }>('SELECT id FROM companies WHERE tax_id = $1 AND merged_into_id IS NULL', [id.value])
  ).rows[0];
  return legacy?.id ?? null;
};

export const addIdentifier = async (
  exec: DbExecutor,
  input: ITypedIdentifier & {
    companyId: number;
    origin: 'extraction' | 'legacy_import' | 'manual' | 'registry';
    sourceRevisionId?: number | null;
    evidenceId?: number | null;
    createdBy?: string;
  },
): Promise<void> => {
  await exec.query(
    `INSERT INTO entity_identifiers
       (company_id, jurisdiction, identifier_type, value, validation_status, origin, source_revision_id, evidence_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (jurisdiction, identifier_type, value) WHERE status = 'active' DO NOTHING`,
    [
      input.companyId,
      input.jurisdiction,
      input.identifierType,
      input.value,
      input.validationStatus,
      input.origin,
      input.sourceRevisionId ?? null,
      input.evidenceId ?? null,
      input.createdBy ?? 'system',
    ],
  );
};
