// Обход реестра по профилю (этап 20A): список → запись → снимок.
//
// Отличия от сайта, из которых всё остальное следует:
//  - записи перезапрашиваются намеренно: смысл реестра в изменениях, а не в новизне;
//  - текст редакции строится рендером, а не вырезается из разметки;
//  - снимок пишется только вместе с новой редакцией — в одной транзакции с ней;
//  - 403 не обходится, 429 уважается, неразобранный JSON — parser_degraded,
//    а не «в реестре ничего нет».

import { pathAllowed } from '../profileMeta.js';
import type { ISource } from '../sources.js';
import type { IIncomingDocument } from '../store.js';
import { fetchSitePage, loadConditional, saveConditional, type SiteFetchResult } from '../sites/fetcher.js';
import { STORE_COUNT, fatalFromFetch, type ICrawlOptions, type ICrawlReport } from '../sites/crawler.js';
import { availablePaths, mapRecord, type IRegistryRecord, type RegistryRecordType } from './map.js';
import {
  REGISTRY_PARSER_VERSION,
  RegistryProfileError,
  buildUrl,
  parseRegistryProfile,
  policyForRegistryProfile,
  type IRegistryProfile,
} from './profile.js';
import { buildRegistryDocument, persistRegistryRecord } from './store.js';

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
  const prefixes = profile.meta?.allowedPathPrefixes ?? [];
  let requests = 0;
  let publishedAssertions = 0;
  let publishSkipped = 0;
  let publishFailed = 0;

  const fetchJson = async (url: string): Promise<JsonFetch> => {
    if (requests > 0) await sleep(profile.limits.delayMs);
    requests += 1;
    const result = await fetchSitePage(url, policy, dryRun ? null : await loadConditional(source.id, url), { accept: 'application/json' });
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

  /** Запись — общим путём (store.ts); здесь только счётчики запуска и условный кэш. */
  const persist = async (doc: IIncomingDocument, record: IRegistryRecord, url: string, result: SiteFetchResult): Promise<void> => {
    if (dryRun) {
      report.counts.saved += 1;
      return;
    }
    const stored = await persistRegistryRecord({
      source,
      record,
      doc,
      alsoInTransaction: client => saveConditional(client, source.id, url, result),
    });
    report.counts[STORE_COUNT[stored.outcome]] += 1;
    publishedAssertions += stored.assertions;
    for (const skip of stored.skipped) {
      publishSkipped += 1;
      report.errors.push(`канон по записи ${url}: ${skip.what} — ${skip.reason}`);
    }
    if (stored.publishError !== null) {
      publishFailed += 1;
      report.errors.push(`канон по записи ${url}: ${stored.publishError}`);
      report.healthReason = report.healthReason ?? `канон записан не полностью: ${stored.publishError}`;
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
    // Проба показывает, какие пути реально есть в ответе: иначе несовпадение карты
    // полей неотличимо от пустого реестра, и оператору нечего править в профиле.
    if (dryRun && !report.coverage.availablePaths) report.coverage.availablePaths = availablePaths(res.value);
    if (!record) {
      degrade(`запись ${url}: в ответе нет идентификатора или названия — сверьте identity с путями в покрытии`);
      return;
    }
    report.counts.found += 1;
    report.layoutStats[`${type}_fields`] = (report.layoutStats[`${type}_fields`] ?? 0) + record.fields.length;

    const doc = buildRegistryDocument(source, record, url, options.sourceRunId ?? null);
    addSample(doc);
    await persist(doc, record, url, res.result);
  };

  // Собираются только записи, названные оператором в профиле. Обход каталога цели
  // сбора не назначает: иначе «посмотреть, что есть у застройщика» незаметно
  // превращалось бы в выкачивание каталога, которого никто не разрешал.
  const objectIds = [...new Set(profile.objectIds)];

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

  report.coverage.mode = 'registry_api';
  report.coverage.targets = 'operator_list';
  report.coverage.catalogSearch = 'not_supported';
  report.coverage.objects = objectIds.length;
  report.coverage.developers = profile.developerIds.length;
  report.coverage.requests = requests;
  report.coverage.publishedAssertions = publishedAssertions;
  report.coverage.publishSkipped = publishSkipped;
  report.coverage.publishFailed = publishFailed;
  report.coverage.note =
    'реестр отдаёт текущее состояние записи; полнота каталога и история изменений до первого сбора неизвестны';
  if (report.outcome === 'ok' && report.health === 'ok' && report.counts.failed > 0) {
    report.healthReason = `не удалось получить часть записей: ${report.counts.failed}`;
  }
  return report;
};
