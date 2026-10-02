// «На контроле» (ADR-016, миграция 042): компании, о которых оператор хочет знать первым.
//
// Отметка поднимает компанию в очередях Контур.Фокуса и реестра застройщиков ДОМ.РФ и даёт фильтр
// каталога. Снятие — отметкой removed_*, строка не удаляется. Повтор безопасен в обе стороны.

import type { DbExecutor } from '../db/pool.js';

export interface ICompanyWatch {
  addedBy: string;
  addedAt: string;
}

/** Поставить на контроль. true — поставили сейчас, false — уже стояла. */
export const watchCompany = async (db: DbExecutor, companyId: number, actor: string): Promise<boolean> => {
  const res = await db.query(
    `INSERT INTO company_watch (company_id, added_by) VALUES ($1, $2)
     ON CONFLICT (company_id) WHERE removed_at IS NULL DO NOTHING`,
    [companyId, actor],
  );
  return (res.rowCount ?? 0) > 0;
};

/** Снять с контроля. true — сняли сейчас, false — не стояла. */
export const unwatchCompany = async (db: DbExecutor, companyId: number, actor: string): Promise<boolean> => {
  const res = await db.query(
    `UPDATE company_watch SET removed_by = $2, removed_at = now() WHERE company_id = $1 AND removed_at IS NULL`,
    [companyId, actor],
  );
  return (res.rowCount ?? 0) > 0;
};

export const loadCompanyWatch = async (db: DbExecutor, companyId: number): Promise<ICompanyWatch | null> => {
  const row = (
    await db.query<{ added_by: string; added_at: Date }>(
      'SELECT added_by, added_at FROM company_watch WHERE company_id = $1 AND removed_at IS NULL',
      [companyId],
    )
  ).rows[0];
  return row ? { addedBy: row.added_by, addedAt: row.added_at.toISOString() } : null;
};
