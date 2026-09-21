// Обход реестра по профилю (этап 20A): список → запись → снимок.
//
// Отличия от сайта, из которых всё остальное следует:
//  - записи перезапрашиваются намеренно: смысл реестра в изменениях, а не в новизне;
//  - текст редакции строится рендером, а не вырезается из разметки;
//  - снимок пишется только вместе с новой редакцией — в одной транзакции с ней;
//  - 403 не обходится, 429 уважается, неразобранный JSON — parser_degraded,
//    а не «в реестре ничего нет».

import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { publishRegistryRecord } from '../../registry/publish.js';
import { itemIdentity } from '../../revisions/identity.js';
import { pathAllowed } from '../profileMeta.js';
import { listPageDegraded } from '../sourceHealth.js';
import type { ISource } from '../sources.js';
import { storeDocument, type IIncomingDocument } from '../store.js';
import { fetchSitePage, loadConditional, saveConditional, type SiteFetchResult } from '../sites/fetcher.js';
import { STORE_COUNT, fatalFromFetch, type ICrawlOptions, type ICrawlReport } from '../sites/crawler.js';
import { mapRecord, readPath, type IRegistryRecord, type RegistryRecordType } from './map.js';
import {
  REGISTRY_PARSER_VERSION,
  RegistryProfileError,
  buildUrl,
  parseRegistryProfile,
  policyForRegistryProfile,
  type IRegistryProfile,
} from './profile.js';
import { renderRecord, representationOf } from './render.js';
import { saveRegistryRecord } from './records.js';

interface IRegistryCursor {
  lastListCount?: number;
  lastListOffset?: number;
}

type JsonFetch =
  | { kind: 'ok'; value: unknown; result: Extract<SiteFetchResult, { kind: 'ok' }> }
  | { kind: 'not_modified' }
  | { kind: 'invalid_json'; message: string; length: number }
  | { kind: 'failed'; result: Exclude<SiteFetchResult, { kind: 'ok' } | { kind: 'not_modified' }> };

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

export const crawlRegistry = async (source: ISource, options: ICrawlOptions = {}): Promise<ICrawlReport> => {
  const report: ICrawlReport = {
    outcome: 'ok',
    health: 'ok',
    healthReason: null,
    httpStatus: null,
    retryAfterAt: null,
    counts: { found: 0, saved: 0, changed: 0, skipped: 0, failed: 0 },
    pagesFetched: 0,
    coverage: {},
    layoutStats: {},
    parserVersion: REGISTRY_PARSER_VERSION,
    samples: [],
    errors: [],
  };
  const dryRun = options.dryRun ?? false;

  let profile: IRegistryProfile;
  try {
    profile = parseRegistryProfile(source.config);
  } catch (err) {
    report.outcome = 'config_invalid';
    report.health = 'config_invalid';
    report.healthReason = err instanceof RegistryProfileError ? err.message : String(err);
    return report;
  }

  const baseUrl = source.baseUrl ?? `https://${source.key}`;
  const policy = policyForRegistryProfile(baseUrl, profile);
  const maxItems = Math.min(options.maxItems ?? profile.limits.maxItemsPerRun, profile.limits.maxItemsPerRun);
  const maxPages = Math.min(options.maxPages ?? profile.list?.maxPages ?? 1, profile.list?.maxPages ?? 1);
  const prefixes = profile.meta?.allowedPathPrefixes ?? [];
  const cursor = (source.cursor.registry ?? {}) as IRegistryCursor;
  let requests = 0;
  let publishedAssertions = 0;
  let publishSkipped = 0;
  let publishFailed = 0;

  const fetchJson = async (url: string): Promise<JsonFetch> => {
    if (requests > 0) await sleep(profile.limits.delayMs);
    requests += 1;
    const result = await fetchSitePage(url, policy, dryRun ? null : await loadConditional(source.id, url));
    if (result.kind === 'not_modified') return { kind: 'not_modified' };
    if (result.kind !== 'ok') return { kind: 'failed', result };
    try {
      return { kind: 'ok', value: JSON.parse(result.text) as unknown, result };
    } catch (err) {
      return { kind: 'invalid_json', message: err instanceof Error ? err.message : String(err), length: result.text.length };
    }
  };

  const fail = (result: Exclude<SiteFetchResult, { kind: 'ok' } | { kind: 'not_modified' }>, where: string): void => {
    const fatal = fatalFromFetch(result);
    report.outcome = report.pagesFetched > 0 && fatal.outcome !== 'rate_limited' ? 'partial' : fatal.outcome;
    report.health = fatal.health;
    report.httpStatus = result.status;
    report.retryAfterAt = result.kind === 'http' ? result.retryAfterAt : null;
    report.healthReason = `${where}: ${result.message}`;
    report.errors.push(report.healthReason);
  };

  const degrade = (reason: string): void => {
    report.counts.failed += 1;
    report.health = 'parser_degraded';
    report.healthReason = reason;
    report.errors.push(reason);
    if (report.outcome === 'ok') report.outcome = 'parser_degraded';
  };

  /**
   * Снимок и редакция — одной транзакцией: снимок без своей редакции не существует.
   * Канон — отдельной: отказ публикации не должен уносить собранные данные,
   * как и у конвейера моделью (отказ — исход набора, а не падение запуска).
   */
  const persist = async (doc: IIncomingDocument, record: IRegistryRecord, url: string, result: SiteFetchResult): Promise<void> => {
    if (dryRun) {
      report.counts.saved += 1;
      return;
    }
    const itemKey = itemIdentity({ externalId: doc.externalId, url: doc.url, body: doc.body }).key;
    let publishable: number | null = null;
    await withTransaction(async (client: PoolClient) => {
      const stored = await storeDocument(doc, client);
      report.counts[STORE_COUNT[stored.outcome]] += 1;
      const isNewRevision = stored.outcome === 'inserted' || stored.outcome === 'duplicate' || stored.outcome === 'new_revision';
      if (isNewRevision && stored.revisionId !== null) {
        await saveRegistryRecord(client, {
          sourceId: source.id,
          itemKey,
          revisionId: stored.revisionId,
          record,
          fetchedAt: doc.fetchedAt ?? new Date(),
        });
        publishable = stored.revisionId;
      }
      await saveConditional(client, source.id, url, result);
    });

    if (publishable === null || !env.REGISTRY_PUBLISH_ENABLED) return;
    try {
      const published = await withTransaction(client => publishRegistryRecord(client, { revisionId: publishable!, body: doc.body, record }));
      publishedAssertions += published.assertions;
      for (const skip of published.skipped) {
        publishSkipped += 1;
        report.errors.push(`канон по записи ${url}: ${skip.what} — ${skip.reason}`);
      }
    } catch (err) {
      // Собранное остаётся в базе; повторная публикация возможна следующим проходом.
      publishFailed += 1;
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`канон по записи ${url}: ${message}`);
      report.healthReason = report.healthReason ?? `канон записан не полностью: ${message}`;
    }
  };

  const addSample = (doc: IIncomingDocument): void => {
    if (report.samples.length >= 5) return;
    report.samples.push({
      url: doc.url ?? '',
      title: doc.title ?? '',
      completeness: doc.completeness ?? 'unknown',
      reason: doc.completenessReason ?? '',
      preview: doc.body.slice(0, 300),
    });
  };

  const processRecord = async (type: RegistryRecordType, id: string): Promise<void> => {
    const template = type === 'object' ? profile.endpoints.object : profile.endpoints.developer;
    if (!template) return;
    const url = buildUrl(template, { id });
    if (!pathAllowed(url, prefixes)) {
      report.layoutStats.outside_path_prefix = (report.layoutStats.outside_path_prefix ?? 0) + 1;
      report.counts.skipped += 1;
      return;
    }
    const res = await fetchJson(url);
    if (res.kind === 'not_modified') {
      report.counts.skipped += 1;
      return;
    }
    if (res.kind === 'failed') {
      report.counts.failed += 1;
      fail(res.result, `запись ${url}`);
      return;
    }
    if (res.kind === 'invalid_json') {
      degrade(`запись ${url}: ответ не разобран как JSON (${res.length} байт): ${res.message}`);
      return;
    }
    report.pagesFetched += 1;
    const record = mapRecord(res.value, profile, type);
    if (!record) {
      degrade(`запись ${url}: в ответе нет идентификатора или названия`);
      return;
    }
    report.counts.found += 1;
    report.layoutStats[`${type}_fields`] = (report.layoutStats[`${type}_fields`] ?? 0) + record.fields.length;

    const asOf = record.identity.asOf;
    const doc: IIncomingDocument = {
      sourceId: source.id,
      sourceRunId: options.sourceRunId ?? null,
      // Ключ публикации — запись реестра, а не адрес: смена шаблона адреса не должна раздваивать историю.
      externalId: `${type}:${record.identity.externalRef}`,
      url,
      title: record.identity.name,
      body: renderRecord(record),
      publishedAt: asOf ? new Date(`${asOf}T00:00:00Z`) : null,
      publishedAtPrecision: asOf ? 'date_only' : null,
      publishedAtRaw: asOf,
      forwardFrom: null,
      representation: representationOf(type),
      completeness: 'full',
      completenessReason: `registry_fields:${record.fields.length}`,
      attachments: [],
      sourceModifiedAt: null,
      fetchedAt: new Date(),
      parserVersion: REGISTRY_PARSER_VERSION,
    };
    addSample(doc);
    await persist(doc, record, url, res.result);
  };

  /** Обход каталога: адреса записей по списку. Полнота каталога не обещается. */
  const discover = async (): Promise<string[]> => {
    const list = profile.list;
    const template = profile.endpoints.list;
    if (!list || !template) return [];
    const ids: string[] = [];
    let pages = 0;
    let stop = 'exhausted';
    for (let offset = 0; pages < maxPages; offset += list.limit) {
      const url = buildUrl(template, { offset, limit: list.limit });
      if (!pathAllowed(url, prefixes)) {
        report.layoutStats.outside_path_prefix = (report.layoutStats.outside_path_prefix ?? 0) + 1;
        stop = 'outside_path_prefix';
        break;
      }
      const res = await fetchJson(url);
      if (res.kind === 'not_modified') {
        stop = 'not_modified';
        break;
      }
      if (res.kind === 'failed') {
        fail(res.result, `список ${url}`);
        stop = 'failed';
        break;
      }
      if (res.kind === 'invalid_json') {
        degrade(`список ${url}: ответ не разобран как JSON (${res.length} байт): ${res.message}`);
        stop = 'parser_degraded';
        break;
      }
      pages += 1;
      report.pagesFetched += 1;
      const items = readPath(res.value, list.itemsPath);
      const rows = Array.isArray(items) ? items : [];
      report.layoutStats.list_items = (report.layoutStats.list_items ?? 0) + rows.length;
      if (listPageDegraded({ items: rows.length, htmlLength: res.result.text.length, minItems: profile.expectations.minItemsOnList, lastListCount: cursor.lastListCount ?? 0 })) {
        degrade(`список ${url}: записей ${rows.length} при ожидаемых ${profile.expectations.minItemsOnList} — похоже на смену формата ответа`);
        stop = 'parser_degraded';
        break;
      }
      for (const row of rows) {
        const id = readPath(row, list.idPath);
        if (id === null || id === undefined) continue;
        const text = String(id).trim();
        if (text !== '' && !ids.includes(text)) ids.push(text);
        if (ids.length >= maxItems) break;
      }
      cursor.lastListCount = rows.length;
      cursor.lastListOffset = offset;
      if (ids.length >= maxItems) {
        stop = 'max_items';
        break;
      }
      if (rows.length < list.limit) {
        stop = 'exhausted';
        break;
      }
      if (pages >= maxPages) {
        stop = 'max_pages';
        break;
      }
    }
    report.coverage.listStopReason = stop;
    report.coverage.listPages = pages;
    return ids;
  };

  const discovered = await discover();
  const objectIds: string[] = [];
  for (const id of [...profile.objectIds, ...discovered]) {
    if (!objectIds.includes(id)) objectIds.push(id);
  }

  for (const id of objectIds) {
    if (report.counts.found >= maxItems) break;
    if (report.outcome === 'rate_limited' || report.outcome === 'blocked') break;
    await processRecord('object', id);
  }
  for (const id of profile.developerIds) {
    if (report.counts.found >= maxItems) break;
    if (report.outcome === 'rate_limited' || report.outcome === 'blocked') break;
    await processRecord('developer', id);
  }

  if (!dryRun && (cursor.lastListCount !== undefined || cursor.lastListOffset !== undefined)) {
    await withTransaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE sources SET cursor = jsonb_set(cursor, '{registry}', coalesce(cursor->'registry', '{}'::jsonb) || $2::jsonb), updated_at = now()
         WHERE id = $1`,
        [source.id, JSON.stringify({ lastListCount: cursor.lastListCount ?? null, lastListOffset: cursor.lastListOffset ?? null })],
      );
    });
  }

  report.coverage.mode = 'registry_api';
  report.coverage.objects = objectIds.length;
  report.coverage.developers = profile.developerIds.length;
  report.coverage.requests = requests;
  report.coverage.publishedAssertions = publishedAssertions;
  report.coverage.publishSkipped = publishSkipped;
  report.coverage.publishFailed = publishFailed;
  report.coverage.publishEnabled = env.REGISTRY_PUBLISH_ENABLED;
  report.coverage.note =
    'реестр отдаёт текущее состояние записи; полнота каталога и история изменений до первого сбора неизвестны';
  if (report.outcome === 'ok' && report.health === 'ok' && report.counts.failed > 0) {
    report.healthReason = `не удалось получить часть записей: ${report.counts.failed}`;
  }
  return report;
};
