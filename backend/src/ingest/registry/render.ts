// Текст редакции по записи реестра (registry-render@1, этап 20A).
//
// Текст — не украшение: к нему привязываются цитаты, и база сверяет цитату с точным
// фрагментом редакции. Отсюда два требования:
//
//  1. Детерминированность. Одни и те же данные — побайтово один и тот же текст.
//     Ничего изменчивого извне реестра: ни времени сбора, ни названия источника,
//     иначе каждый повторный сбор выглядел бы как «данные изменились».
//  2. Самодостаточные строки связей. Проверка цитаты требует обе стороны связи
//     в одном предложении, поэтому застройщик и группа компаний называются
//     вместе с объектом в одной строке, а не разными полями таблицы.

import type { IRegistryRecord } from './map.js';

export const REGISTRY_RENDER_VERSION = 'registry-render@1';

export const REGISTRY_OBJECT_REPRESENTATION = 'registry_object@1';
export const REGISTRY_DEVELOPER_REPRESENTATION = 'registry_developer@1';

const quoted = (value: string): string => `«${value}»`;

const isoToRu = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/** Полное имя компании с ОПФ, если реестр её сообщил отдельно от названия. */
export const companyTitle = (name: string, legalForm: string | null): string => {
  if (!legalForm) return name;
  const form = legalForm.trim();
  if (form === '' || name.toLowerCase().startsWith(form.toLowerCase())) return name;
  return `${form} ${name}`;
};

/** Строка «застройщик — объект»: носитель связи участия. */
export const developerLine = (projectName: string, developer: string, inn: string | null, ogrn: string | null): string => {
  const requisites = [inn ? `ИНН ${inn}` : null, ogrn ? `ОГРН ${ogrn}` : null].filter(Boolean).join(', ');
  const tail = requisites === '' ? '' : `, ${requisites}`;
  return `Застройщик объекта ${quoted(projectName)} — ${developer}${tail}.`;
};

/** Строка «компания — группа компаний»: носитель корпоративной связи. */
export const groupLine = (company: string, groupName: string): string =>
  `Застройщик ${company} входит в группу компаний ${quoted(groupName)}.`;

/** Строка реквизитов застройщика в его собственной карточке. */
export const requisitesLine = (company: string, inn: string | null, ogrn: string | null): string | null => {
  const requisites = [inn ? `ИНН ${inn}` : null, ogrn ? `ОГРН ${ogrn}` : null].filter(Boolean).join(', ');
  return requisites === '' ? null : `Реквизиты застройщика ${company}: ${requisites}.`;
};

/**
 * Текст снимка. Порядок строк фиксирован: идентичность, связи, затем поля профиля
 * в порядке профиля. Пустых значений в тексте нет — отсутствие поля не выдаётся
 * за «не указано в реестре».
 */
export const renderRecord = (record: IRegistryRecord): string => {
  const { identity } = record;
  const lines: string[] = [];
  const head = record.type === 'object' ? 'Объект' : 'Застройщик';
  lines.push(`${head}: ${quoted(identity.name)} (ID ${identity.externalRef} в реестре)`);
  if (identity.asOf) lines.push(`Сведения реестра на ${isoToRu(identity.asOf)}`);

  if (record.type === 'object') {
    if (identity.city) lines.push(`Город: ${identity.city}`);
    if (identity.address) lines.push(`Адрес: ${identity.address}`);
    if (identity.developer) {
      const developer = companyTitle(identity.developer.name, identity.developer.legalForm);
      lines.push(developerLine(identity.name, developer, identity.developer.inn, identity.developer.ogrn));
      if (identity.groupName) lines.push(groupLine(developer, identity.groupName));
    }
  } else {
    const company = identity.developer ? companyTitle(identity.developer.name, identity.developer.legalForm) : identity.name;
    const requisites = identity.developer ? requisitesLine(company, identity.developer.inn, identity.developer.ogrn) : null;
    if (requisites) lines.push(requisites);
    if (identity.groupName) lines.push(groupLine(company, identity.groupName));
    if (identity.city) lines.push(`Город: ${identity.city}`);
  }

  for (const field of record.fields) lines.push(`${field.label}: ${field.value}`);
  return lines.join('\n');
};

export const representationOf = (type: IRegistryRecord['type']): string =>
  type === 'object' ? REGISTRY_OBJECT_REPRESENTATION : REGISTRY_DEVELOPER_REPRESENTATION;
