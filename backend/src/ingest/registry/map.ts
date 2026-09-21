// Ответ реестра → типизированная запись (этап 20A).
//
// Правила:
//  - отсутствующее поле остаётся отсутствующим: ни «не указано», ни нуля, ни пустой строки;
//  - значения только форматируются, не пересчитываются — ни валют, ни НДС, ни долей;
//  - дата сведений берётся только из самого ответа; временем сбора она не подменяется,
//    иначе каждый сбор давал бы «новую редакцию» при неизменных данных.

import { payloadHash } from '../../snapshot/canonical.js';
import type { IRegistryFieldSpec, IRegistryProfile } from './profile.js';

export type RegistryRecordType = 'object' | 'developer';

export interface IRegistryField {
  label: string;
  /** Готовая к показу строка. */
  value: string;
  /** Значение как его отдал реестр. */
  raw: string | number | boolean | null;
}

export interface IRegistryDeveloper {
  name: string;
  legalForm: string | null;
  inn: string | null;
  ogrn: string | null;
}

export interface IRegistryIdentity {
  externalRef: string;
  name: string;
  city: string | null;
  address: string | null;
  /** ISO-дата сведений по данным реестра; null — реестр её не сообщил. */
  asOf: string | null;
  /** У карточки объекта — его застройщик; у карточки застройщика — она сама. */
  developer: IRegistryDeveloper | null;
  groupName: string | null;
}

export interface IRegistryRecord {
  type: RegistryRecordType;
  /** Вид объекта по профилю источника; у карточки застройщика не задан. */
  projectKind?: 'residential' | 'office' | 'industrial' | 'infrastructure' | 'social' | 'other';
  identity: IRegistryIdentity;
  fields: IRegistryField[];
  payload: Record<string, unknown>;
  payloadHash: string;
}

/** Значение по точечному пути. Индексы массивов — числовые сегменты. */
export const readPath = (root: unknown, path: string): unknown => {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

/**
 * Пути к скалярным значениям в ответе — подсказка оператору при настройке карты полей.
 * Печатается только пробой: имена ключей публичного каталога секретом не являются,
 * значения не выводятся. Без этого несовпадение карты полей выглядит как «пусто».
 */
export const availablePaths = (body: unknown, limit = 120, maxDepth = 4): string[] => {
  const found: string[] = [];
  const walk = (value: unknown, prefix: string, depth: number): void => {
    if (found.length >= limit || depth > maxDepth) return;
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      // Массив описываем по первому элементу: остальные той же формы.
      if (value.length > 0) walk(value[0], `${prefix}.0`, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, prefix === '' ? key : `${prefix}.${key}`, depth + 1);
        if (found.length >= limit) return;
      }
      return;
    }
    if (prefix !== '') found.push(prefix);
  };
  walk(body, '', 0);
  return found;
};

const readScalar = (root: unknown, path: string | undefined): string | number | boolean | null => {
  if (!path) return null;
  const value = readPath(root, path);
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return null;
};

export const readText = (root: unknown, path: string | undefined): string | null => {
  const value = readScalar(root, path);
  return value === null ? null : String(value);
};

/** ISO-дата из значения реестра: ISO-строка или ДД.ММ.ГГГГ. Иначе — null, без догадок. */
export const toIsoDate = (raw: string | number | boolean | null): string | null => {
  if (typeof raw !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (ru) return `${ru[3]}-${ru[2]}-${ru[1]}`;
  return null;
};

const groupDigits = (value: string): string => {
  const [whole, fraction] = value.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction ? `${grouped},${fraction}` : grouped;
};

/** Значение поля в строку. Формат — только представление, величина не меняется. */
export const formatValue = (raw: string | number | boolean | null, spec: IRegistryFieldSpec): string | null => {
  if (raw === null) return null;
  const unit = spec.unit ? ` ${spec.unit}` : '';
  switch (spec.format) {
    case 'bool':
      return typeof raw === 'boolean' ? (raw ? 'да' : 'нет') : String(raw);
    case 'date': {
      const iso = toIsoDate(raw);
      if (!iso) return `${String(raw)}${unit}`;
      const [y, m, d] = iso.split('-');
      return `${d}.${m}.${y}`;
    }
    case 'money':
      return typeof raw === 'number' ? `${groupDigits(String(raw))}${unit}` : `${String(raw)}${unit}`;
    case 'percent':
      return `${String(raw)}%`;
    case 'number':
    case 'text':
    default:
      return `${String(raw)}${unit}`;
  }
};

const mapFields = (root: unknown, specs: readonly IRegistryFieldSpec[]): IRegistryField[] => {
  const fields: IRegistryField[] = [];
  for (const spec of specs) {
    const raw = readScalar(root, spec.path);
    const value = formatValue(raw, spec);
    if (value === null || value === '') continue;
    fields.push({ label: spec.label, value, raw });
  }
  return fields;
};

const developerOf = (name: string | null, form: string | null, inn: string | null, ogrn: string | null): IRegistryDeveloper | null => {
  if (!name) return null;
  return { name, legalForm: form, inn, ogrn };
};

/**
 * Запись реестра из ответа. null — в ответе нет идентификатора или названия:
 * без них снимок не к чему привязать, и молча придумывать их нельзя.
 */
export const mapRecord = (body: unknown, profile: IRegistryProfile, type: RegistryRecordType): IRegistryRecord | null => {
  const wrapper = type === 'object' ? profile.responsePath.object : profile.responsePath.developer;
  const root = wrapper ? readPath(body, wrapper) : body;
  if (root === null || root === undefined || typeof root !== 'object') return null;

  if (type === 'developer') {
    const ident = profile.identity.developer;
    if (!ident) return null;
    const externalRef = readText(root, ident.idPath);
    const name = readText(root, ident.namePath);
    if (!externalRef || !name) return null;
    const identity: IRegistryIdentity = {
      externalRef,
      name,
      city: readText(root, ident.cityPath),
      address: null,
      asOf: toIsoDate(readScalar(root, ident.asOfPath)),
      developer: developerOf(name, readText(root, ident.formPath), readText(root, ident.innPath), readText(root, ident.ogrnPath)),
      groupName: readText(root, ident.groupNamePath),
    };
    const fields = mapFields(root, profile.fields.developer);
    const payload = toPayload(identity, fields);
    return { type, identity, fields, payload, payloadHash: payloadHash(payload) };
  }

  const ident = profile.identity.object;
  const externalRef = readText(root, ident.idPath);
  const name = readText(root, ident.namePath);
  if (!externalRef || !name) return null;
  const identity: IRegistryIdentity = {
    externalRef,
    name,
    city: readText(root, ident.cityPath),
    address: readText(root, ident.addressPath),
    asOf: toIsoDate(readScalar(root, ident.asOfPath)),
    developer: developerOf(
      readText(root, ident.developerNamePath),
      readText(root, ident.developerFormPath),
      readText(root, ident.developerInnPath),
      readText(root, ident.developerOgrnPath),
    ),
    groupName: readText(root, ident.groupNamePath),
  };
  const fields = mapFields(root, profile.fields.object);
  const payload = toPayload(identity, fields);
  return { type, projectKind: ident.projectKind, identity, fields, payload, payloadHash: payloadHash(payload) };
};

/** Форма хранения снимка: то же, что показывается, и ничего сверх того. */
export const toPayload = (identity: IRegistryIdentity, fields: readonly IRegistryField[]): Record<string, unknown> => ({
  identity: {
    externalRef: identity.externalRef,
    name: identity.name,
    city: identity.city,
    address: identity.address,
    asOf: identity.asOf,
    developer: identity.developer,
    groupName: identity.groupName,
  },
  fields: fields.map(f => ({ label: f.label, value: f.value, raw: f.raw })),
});
