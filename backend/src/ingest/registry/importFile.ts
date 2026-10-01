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
// записи не подтягиваются. Страница застройщика (этап 20D) — такой же снимок
// со своим адресом: работник читает её по ссылке подтверждённой карточки объекта.

import fs from 'node:fs';

import { withTransaction } from '../../db/pool.js';
import { attachBrowserCaptureToProject, linkedRegistryProject } from '../../registry/projectLink.js';
import { findDomRfTarget, markDomRfCaptured } from './domrfTargets.js';
import type { ISource } from '../sources.js';
import { isDomRfBrowserCapture, mapDomRfBrowserCapture } from './browserCapture.js';
import { isDomRfCardCapture, mapDomRfDeveloperCapture, type IDomRfDeveloperIdentity } from './domrfCards.js';
import { availablePaths, mapRecord, type RegistryRecordType } from './map.js';
import { RegistryProfileError, buildUrl, parseRegistryProfile } from './profile.js';
import { buildRegistryDocument, persistRegistryRecord, type IRegistryPersistResult } from './store.js';

export type IRegistryImportResult =
  | ({ kind: 'stored'; type: RegistryRecordType; externalRef: string; name: string; url: string; fields: number } & IRegistryPersistResult)
  | { kind: 'invalid_json'; message: string }
  | { kind: 'invalid_page'; message: string }
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
  /** Existing portal card for a browser capture. Never creates a card from this ID. */
  projectId?: number;
  /** Застройщик со своей страницы реестра — для снимка объекта, который на неё ссылается. */
  developerCard?: IDomRfDeveloperIdentity | null;
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
  return importRegistryPayload(source, body, options, bytes);
};

/** Тот же импорт для снимка, полученного фоновым браузером без промежуточного файла. */
export const importRegistryPayload = async (
  source: ISource,
  body: unknown,
  options: IRegistryImportOptions = {},
  bytes = Buffer.byteLength(JSON.stringify(body), 'utf8'),
): Promise<IRegistryImportResult> => {
  let profile;
  try {
    profile = parseRegistryProfile(source.config);
  } catch (err) {
    return { kind: 'config_invalid', message: err instanceof RegistryProfileError ? err.message : String(err) };
  }

  if (bytes > profile.limits.maxBytes) return { kind: 'too_large', bytes, limit: profile.limits.maxBytes };

  const browserPage = isDomRfBrowserCapture(body);
  const developerPage = isDomRfCardCapture(body);
  if (browserPage && options.type === 'developer') return { kind: 'invalid_page', message: 'снимок страницы описывает объект, а не застройщика' };
  let record;
  try {
    record = browserPage
      ? mapDomRfBrowserCapture(body, options.developerCard ?? null)
      : developerPage
        ? mapDomRfDeveloperCapture(body)
        : mapRecord(body, profile, options.type ?? 'object');
  } catch (err) {
    return { kind: 'invalid_page', message: err instanceof Error ? err.message : String(err) };
  }
  if (!record) return { kind: 'unmapped', availablePaths: availablePaths(body) };
  if (options.projectId !== undefined && !browserPage) {
    return { kind: 'invalid_page', message: '--project-id применяется только к снимку страницы объекта' };
  }
  const target = browserPage ? await withTransaction(client => findDomRfTarget(client, record.identity.externalRef)) : null;
  if (target?.projectId !== null && target?.projectId !== undefined && options.projectId !== undefined && target.projectId !== options.projectId) {
    return { kind: 'invalid_page', message: `ссылка в админке привязана к объекту портала №${target.projectId}` };
  }
  const projectId = options.projectId ?? target?.projectId ?? undefined;
  if (projectId !== undefined) {
    try {
      await withTransaction(client => linkedRegistryProject(client, source.id, record.identity.externalRef, projectId));
    } catch (err) {
      return { kind: 'invalid_page', message: err instanceof Error ? err.message : String(err) };
    }
  }

  const type = record.type;
  const template = type === 'object' ? profile.endpoints.object : profile.endpoints.developer;
  const url = options.url ?? (browserPage || developerPage ? (body as { url: string }).url : template ? buildUrl(template, { id: record.identity.externalRef }) : `registry:${record.identity.externalRef}`);
  const doc = buildRegistryDocument(source, record, url, options.sourceRunId ?? null, options.fetchedAt);
  const persisted = await persistRegistryRecord({ source, record, doc, requestedProjectId: projectId });
  if (browserPage && !persisted.publishError) {
    await withTransaction(async client => {
      if (projectId !== undefined) await attachBrowserCaptureToProject(client, source.id, record.identity.externalRef, projectId);
      const linked = await linkedRegistryProject(client, source.id, record.identity.externalRef);
      await markDomRfCaptured(client, record.identity.externalRef, persisted.revisionId, linked);
    });
  }

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
