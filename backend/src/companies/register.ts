// Компания по реквизиту (ADR-016, этап 23A): оператор заводит Заказчика по ИНН или ОГРН, не дожидаясь,
// пока о нём напишут в собранных каналах.
//
//  - реквизит — только с верной контрольной суммой: опечатка в ИНН не должна стать компанией;
//  - карточка с этим реквизитом уже есть — её и возвращаем (дубля нет), ставим на контроль;
//  - иначе новая карточка юрлица с временным именем «ИНН …» (name_pending) и реквизитом origin = 'manual'.
//    Наименование придёт из ЕГРЮЛ первым ответом Контур.Фокуса (focus/identity.ts).
//
// Запрос Фокуса — после транзакции и не в ней: сеть не держит блокировки, а отказ Фокуса не отменяет
// заведённую карточку (её спросит расписание).

import type { PoolClient } from 'pg';

import { lockCanonWrites } from '../resolve/canonLock.js';
import { addIdentifier, classifyTaxId, findCompanyByIdentifier, type ITypedIdentifier } from '../resolve/identifiers.js';
import { NORMALIZER_VERSION, normalizeName } from '../resolve/normalize.js';
import type { IFocusIdentifier } from '../focus/client.js';
import { placeholderName } from '../focus/identity.js';
import { watchCompany } from './watch.js';

export type RegisterRejection = 'bad_format' | 'bad_checksum';

export type RegisterResult =
  | { ok: true; created: boolean; companyId: number; identifier: ITypedIdentifier; focusTarget: IFocusIdentifier }
  | { ok: false; reason: RegisterRejection };

/** Реквизит, по которому можно завести компанию: ИНН, ОГРН или ОГРНИП с верной контрольной суммой. */
export const parseRegistrationIdentifier = (raw: string): { ok: true; identifier: ITypedIdentifier } | { ok: false; reason: RegisterRejection } => {
  const typed = classifyTaxId(raw);
  if (!typed || !['inn', 'ogrn', 'ogrnip'].includes(typed.identifierType)) return { ok: false, reason: 'bad_format' };
  if (typed.validationStatus !== 'checksum_valid') return { ok: false, reason: 'bad_checksum' };
  return { ok: true, identifier: typed };
};

/** Фокус спрашивается по ИНН или ОГРН; ОГРНИП для него — тот же ОГРН. */
export const focusTargetOf = (identifier: ITypedIdentifier): IFocusIdentifier => ({
  type: identifier.identifierType === 'inn' ? 'inn' : 'ogrn',
  value: identifier.value,
});

/** Вызывать в транзакции: между поиском реквизита и вставкой параллельный запрос может завести ту же компанию. */
export const registerCompany = async (client: PoolClient, input: { raw: string; actor: string }): Promise<RegisterResult> => {
  const parsed = parseRegistrationIdentifier(input.raw);
  if (!parsed.ok) return parsed;
  const { identifier } = parsed;
  const focusTarget = focusTargetOf(identifier);
  // Сначала общая блокировка канона (resolve/canonLock.ts), потом реквизита — тот же порядок, что у всех путей.
  await lockCanonWrites(client);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`company-identifier:${identifier.identifierType}:${identifier.value}`]);

  const existing = await findCompanyByIdentifier(client, identifier);
  if (existing !== null) {
    await watchCompany(client, existing, input.actor);
    return { ok: true, created: false, companyId: existing, identifier, focusTarget };
  }

  const normalized = normalizeName(placeholderName(focusTarget), 'company');
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin, entity_type, normalizer_version, name_pending)
     VALUES ($1, $2, $3, 'legal_entity', $4, true) RETURNING id`,
    [placeholderName(focusTarget), normalized.norm, normalized.latin, NORMALIZER_VERSION],
  );
  const companyId = inserted.rows[0]?.id;
  if (companyId === undefined) throw new Error('Не удалось завести компанию');
  await addIdentifier(client, { ...identifier, companyId, origin: 'manual', createdBy: input.actor });
  await watchCompany(client, companyId, input.actor);
  return { ok: true, created: true, companyId, identifier, focusTarget };
};
