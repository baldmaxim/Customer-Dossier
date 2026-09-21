// Импорт записи реестра из файла (этап 20C).
//
// Зачем. Источник может не отвечать программе, отвечая браузеру: наш.дом.рф
// возвращает 403 на запрос портала и открывается человеку. Тогда единственный
// честный путь — оператор сам сохраняет ответ и передаёт его порталу.
//
// Что это меняет и что нет:
//  - сети здесь нет вообще, файл берётся с диска оператора;
//  - допуск на сбор всё равно обязателен: основание нужно не сети, а данным;
//  - дальше — тот же профиль, тот же рендер, тот же снимок и тот же канон.
//    Импортированная запись ничем не отличается от собранной: она и есть
//    та же запись реестра, полученная другим способом.
//
// Собирается только то, что оператор передал: каталог не обходится, соседние
// записи не подтягиваются.

import fs from 'node:fs';

import type { ISource } from '../sources.js';
import { availablePaths, mapRecord, type RegistryRecordType } from './map.js';
import { RegistryProfileError, buildUrl, parseRegistryProfile } from './profile.js';
import { buildRegistryDocument, persistRegistryRecord, type IRegistryPersistResult } from './store.js';

export type IRegistryImportResult =
  | ({ kind: 'stored'; type: RegistryRecordType; externalRef: string; name: string; url: string; fields: number } & IRegistryPersistResult)
  | { kind: 'invalid_json'; message: string }
  /** Ответ разобран, но карта полей не совпала: оператору нужны реальные пути. */
  | { kind: 'unmapped'; availablePaths: string[] }
  | { kind: 'config_invalid'; message: string }
  | { kind: 'too_large'; bytes: number; limit: number };

export interface IRegistryImportOptions {
  type?: RegistryRecordType;
  /** Адрес записи у источника: для показа в карточке. По умолчанию строится по профилю. */
  url?: string;
  sourceRunId?: number | null;
  fetchedAt?: Date;
}

/** Идентификатор записи из адреса каталога: последний числовой сегмент пути. */
export const objectIdFromUrl = (raw: string): string | null => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(raw).pathname);
  } catch {
    path = raw;
  }
  const segments = path.split('/').filter(s => s !== '');
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (/^\d{1,18}$/.test(segments[i]!)) return segments[i]!;
  }
  return null;
};

export const importRegistryFile = async (
  source: ISource,
  filePath: string,
  options: IRegistryImportOptions = {},
): Promise<IRegistryImportResult> => {
  let profile;
  try {
    profile = parseRegistryProfile(source.config);
  } catch (err) {
    return { kind: 'config_invalid', message: err instanceof RegistryProfileError ? err.message : String(err) };
  }

  const bytes = fs.statSync(filePath).size;
  if (bytes > profile.limits.maxBytes) return { kind: 'too_large', bytes, limit: profile.limits.maxBytes };

  let body: unknown;
  try {
    body = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (err) {
    return { kind: 'invalid_json', message: err instanceof Error ? err.message : String(err) };
  }

  const type: RegistryRecordType = options.type ?? 'object';
  const record = mapRecord(body, profile, type);
  if (!record) return { kind: 'unmapped', availablePaths: availablePaths(body) };

  const template = type === 'object' ? profile.endpoints.object : profile.endpoints.developer;
  const url = options.url ?? (template ? buildUrl(template, { id: record.identity.externalRef }) : `registry:${record.identity.externalRef}`);
  const doc = buildRegistryDocument(source, record, url, options.sourceRunId ?? null, options.fetchedAt);
  const persisted = await persistRegistryRecord({ source, record, doc });

  return {
    kind: 'stored',
    type,
    externalRef: record.identity.externalRef,
    name: record.identity.name,
    url,
    fields: record.fields.length,
    ...persisted,
  };
};
