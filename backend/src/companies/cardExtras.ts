// Что карточка компании берёт от «портала от компании» (ADR-016): отметка «На контроле» и наименование
// со статусом по ЕГРЮЛ — заголовок карточки. Наименование — из последнего ответа Контур.Фокуса по
// реквизиту (снимок вне канона, ADR-015); имя карточки из публикаций остаётся как есть и показывается
// рядом («в публикациях — …»).

import type { DbExecutor } from '../db/pool.js';
import { egrulNamesOf } from '../focus/identity.js';
import { mapReq, summaryOf } from '../focus/map.js';
import { companyFocusTarget } from '../focus/targets.js';
import { loadCompanyWatch, type ICompanyWatch } from './watch.js';

export interface ICompanyEgrul {
  /** Краткое наименование ЮЛ или «ИП ФИО». */
  name: string | null;
  fullName: string | null;
  status: string | null;
  fetchedAt: string;
}

export const loadCompanyEgrul = async (db: DbExecutor, companyId: number): Promise<ICompanyEgrul | null> => {
  const resolved = await companyFocusTarget(db, companyId);
  if (!resolved.ok) return null;
  const row = (
    await db.query<{ payload: Record<string, unknown>; fetched_at: Date }>(
      `SELECT payload, fetched_at FROM focus_records WHERE identifier_type = $1 AND identifier = $2 AND method = 'req'
       ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      [resolved.target.type, resolved.target.value],
    )
  ).rows[0];
  if (!row) return null;
  const names = egrulNamesOf(row.payload);
  return { name: names.short, fullName: names.full, status: summaryOf(mapReq(row.payload)).status, fetchedAt: row.fetched_at.toISOString() };
};

export const loadCardExtras = async (db: DbExecutor, companyId: number): Promise<{ watch: ICompanyWatch | null; egrul: ICompanyEgrul | null }> => ({
  watch: await loadCompanyWatch(db, companyId),
  egrul: await loadCompanyEgrul(db, companyId),
});
