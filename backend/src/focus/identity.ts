// Наименование ЕГРЮЛ из ответа Контур.Фокуса — в карточку компании (ADR-016, этап 23A).
//
// Сведения Фокуса остаются снимком вне канона (ADR-015). Отсюда в карточку идут только две вещи:
//  - наименование ЕГРЮЛ (краткое и полное) как написание компании (entity_aliases.source = 'focus'):
//    по нему компанию находит поиск, а резолвер — новые публикации по прежним правилам;
//  - имя карточки, заведённой по реквизиту (name_pending): временное «ИНН …» заменяется наименованием
//    ЕГРЮЛ один раз. Имя из текста публикаций ответ Фокуса не перетирает.

import type { DbExecutor } from '../db/pool.js';
import { isJunkName, normalizeName } from '../resolve/normalize.js';
import type { IFocusIdentifier } from './client.js';
import { mapReq } from './map.js';

export interface IEgrulNames {
  /** Краткое наименование ЮЛ или «ИП Фамилия Имя Отчество». */
  short: string | null;
  full: string | null;
}

/** Наименования из ответа метода req. */
export const egrulNamesOf = (payload: Record<string, unknown>): IEgrulNames => {
  const fields = mapReq(payload);
  const value = (key: string): string | null => fields.find(f => f.key === key)?.value ?? null;
  const fio = value('fio');
  return { short: value('name') ?? (fio ? `ИП ${fio}` : null), full: value('fullName') };
};

/** Временное имя карточки, заведённой по реквизиту: до ответа ЕГРЮЛ другого у неё нет. */
export const placeholderName = (target: IFocusIdentifier): string => `${target.type === 'inn' ? 'ИНН' : 'ОГРН'} ${target.value}`;

export interface IFocusIdentityResult {
  /** Компании с этим реквизитом. */
  companies: number;
  aliasesAdded: number;
  renamed: number;
}

/**
 * Применить наименование из последнего ответа req к компаниям с этим реквизитом. Повтор безопасен:
 * алиас не дублируется и счётчик написаний не растёт, имя меняется только у карточки с name_pending.
 */
export const syncFocusIdentity = async (db: DbExecutor, target: IFocusIdentifier): Promise<IFocusIdentityResult> => {
  const record = (
    await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM focus_records WHERE identifier_type = $1 AND identifier = $2 AND method = 'req'
       ORDER BY fetched_at DESC, id DESC LIMIT 1`,
      [target.type, target.value],
    )
  ).rows[0];
  const result: IFocusIdentityResult = { companies: 0, aliasesAdded: 0, renamed: 0 };
  if (!record) return result;
  const names = egrulNamesOf(record.payload);

  const types = target.type === 'inn' ? ['inn'] : ['ogrn', 'ogrnip'];
  const companies = (
    await db.query<{ id: number; name_pending: boolean; legal_form: string | null }>(
      `SELECT DISTINCT c.id, c.name_pending, c.legal_form FROM entity_identifiers i
       JOIN companies c ON c.id = i.company_id AND c.merged_into_id IS NULL
       WHERE i.identifier_type = ANY($1::text[]) AND i.value = $2 AND i.status = 'active' AND i.validation_status = 'checksum_valid'
       ORDER BY c.id`,
      [types, target.value],
    )
  ).rows;
  result.companies = companies.length;

  const spellings = [names.short, names.full]
    .filter((name): name is string => name !== null)
    .map(name => ({ name, normalized: normalizeName(name, 'company') }))
    .filter(s => !isJunkName(s.normalized));

  for (const company of companies) {
    for (const s of spellings) {
      const inserted = await db.query(
        `INSERT INTO entity_aliases (entity_kind, entity_id, alias, alias_norm, alias_latin, source)
         VALUES ('company', $1, $2, $3, $4, 'focus')
         ON CONFLICT (entity_kind, entity_id, alias_norm) DO NOTHING`,
        [company.id, s.name, s.normalized.norm, s.normalized.latin],
      );
      result.aliasesAdded += inserted.rowCount ?? 0;
    }
    const display = spellings[0];
    if (company.name_pending && display) {
      const renamed = await db.query(
        `UPDATE companies SET name = $2, name_norm = $3, name_latin = $4, legal_form = coalesce($5, legal_form),
                name_pending = false, version = version + 1, updated_at = now()
         WHERE id = $1 AND name_pending`,
        [company.id, display.normalized.display, display.normalized.norm, display.normalized.latin, display.normalized.legalForm],
      );
      result.renamed += renamed.rowCount ?? 0;
    }
  }
  return result;
};
