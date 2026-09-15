// Обход сайта по профилю (этап 05A): discover → fetch → parse → persist/observe.
//
// Правила:
//  - страница списка и её записи сохраняются одной транзакцией вместе с курсором:
//    курсор не уходит за несохранённый диапазон, после сбоя обход продолжается с той же страницы;
//  - полнота — по происхождению: текст ленты полон только по контракту профиля, статья — по
//    совпавшему bodySelector; сбой статьи оставляет честный анонс (excerpt) только для новой публикации,
//    известную полную версию анонсом не заменяет;
//  - пустая страница при ожидаемых записях — parser_degraded, а не «новостей нет»;
//  - 304 — наблюдение без новой редакции; 429 — пауза до Retry-After; 403 не обходится;
//  - лимит страниц/записей виден в покрытии и не выдаётся за полную историю.

import type { PoolClient } from 'pg';

import { getPool, withTransaction } from '../../db/pool.js';
import { hostMatchesPolicy, type ISourceNetworkPolicy } from '../../net/safeFetch.js';
import { itemIdentity } from '../../revisions/identity.js';
import { storeDocument, type IIncomingDocument, type StoreOutcome } from '../store.js';
import type { ISource } from '../sources.js';
import { fetchSitePage, loadConditional, saveConditional, type SiteFetchResult } from './fetcher.js';
import {
  canonicalUrlFor,
  looksLikeFeed,
  parseArticlePage,
  parseFeedPage,
  parseListPage,
  parseProjectCard,
  type IListedItem,
  type IListPage,
} from './parsers.js';
import { SITE_PARSER_VERSION, SiteProfileError, parseSiteProfile, policyForProfile, type ISiteProfile } from './profile.js';

export type SiteRunOutcome =
  | 'ok'
  | 'not_modified'
  | 'partial'
  | 'parser_degraded'
  | 'rate_limited'
  | 'blocked'
  | 'http_error'
  | 'network'
  | 'oversize'
  | 'config_invalid'
  | 'error'
  | 'policy_blocked'
  | 'identity_changed'
  | 'not_found'
  | 'private';

export type SiteHealth = 'ok' | 'parser_degraded' | 'rate_limited' | 'blocked' | 'error' | 'config_invalid' | 'identity_uncertain';

export interface ICrawlCounts {
  found: number;
  saved: number;
  changed: number;
  skipped: number;
  failed: number;
}

export interface ICrawlReport {
  outcome: SiteRunOutcome;
  health: SiteHealth;
  healthReason: string | null;
  httpStatus: number | null;
  retryAfterAt: Date | null;
  counts: ICrawlCounts;
  pagesFetched: number;
  coverage: Record<string, unknown>;
  layoutStats: Record<string, number>;
  parserVersion: string;
  samples: Array<{ url: string; title: string; completeness: string; reason: string; preview: string }>;
  errors: string[];
}

export interface ICrawlOptions {
  /** Проба: ничего не пишет (ни документы, ни курсор, ни кэш), условные заголовки не шлёт. */
  dryRun?: boolean;
  sourceRunId?: number | null;
  maxPages?: number;
  maxItems?: number;
}

interface ISiteCursor {
  backlogNext?: string | null;
  caughtUp?: boolean;
  lastListCount?: number;
}

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

const fatalFromFetch = (result: Exclude<SiteFetchResult, { kind: 'ok' } | { kind: 'not_modified' }>): {
  outcome: SiteRunOutcome;
  health: SiteHealth;
} => {
  if (result.kind === 'http') {
    if (result.status === 429) return { outcome: 'rate_limited', health: 'rate_limited' };
    if (result.status === 401 || result.status === 403 || result.status === 451) return { outcome: 'blocked', health: 'blocked' };
    return { outcome: 'http_error', health: 'error' };
  }
  if (result.kind === 'policy') return { outcome: 'blocked', health: 'blocked' };
  if (result.kind === 'oversize') return { outcome: 'oversize', health: 'error' };
  return { outcome: 'network', health: 'error' };
};

const STORE_COUNT: Record<StoreOutcome, keyof ICrawlCounts> = {
  inserted: 'saved',
  duplicate: 'saved',
  new_revision: 'changed',
  unchanged: 'skipped',
  stale: 'skipped',
  too_short: 'skipped',
  edited_skipped: 'skipped',
};

interface IKnownItem {
  completeness: string | null;
}

const loadKnown = async (sourceId: number, items: readonly IListedItem[]): Promise<Map<string, IKnownItem>> => {
  const keys = items.map(i => itemIdentity({ externalId: i.externalId, url: i.url, body: '' }).key);
  const rows = (
    await getPool().query<{ item_key: string; completeness: string | null }>(
      `SELECT i.item_key, r.completeness::text AS completeness
       FROM source_items i LEFT JOIN document_revisions r ON r.id = i.latest_revision_id
       WHERE i.source_id = $1 AND i.item_key = ANY($2::text[])`,
      [sourceId, keys],
    )
  ).rows;
  return new Map(rows.map(r => [r.item_key, { completeness: r.completeness }]));
};

export const crawlSite = async (source: ISource, options: ICrawlOptions = {}): Promise<ICrawlReport> => {
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
    parserVersion: SITE_PARSER_VERSION,
    samples: [],
    errors: [],
  };
  const dryRun = options.dryRun ?? false;

  let profile: ISiteProfile;
  try {
    profile = parseSiteProfile(source.config);
  } catch (err) {
    report.outcome = 'config_invalid';
    report.health = 'config_invalid';
    report.healthReason = err instanceof SiteProfileError ? err.message : String(err);
    return report;
  }

  const baseUrl = source.baseUrl ?? `https://${source.key}`;
  const policy = policyForProfile(baseUrl, profile);
  const maxItems = Math.min(options.maxItems ?? profile.limits.maxItemsPerRun, profile.limits.maxItemsPerRun);
  const cursor = (source.cursor.site ?? {}) as ISiteCursor;
  let requests = 0;

  const fetchPage = async (url: string): Promise<SiteFetchResult> => {
    if (requests > 0) await sleep(profile.limits.delayMs);
    requests += 1;
    return fetchSitePage(url, policy, dryRun ? null : await loadConditional(source.id, url));
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

  /** Документ по записи списка: статья, честный анонс или пропуск. */
  const buildDocument = async (item: IListedItem, known: IKnownItem | undefined): Promise<IIncomingDocument | null> => {
    const base = {
      sourceId: source.id,
      sourceRunId: options.sourceRunId ?? null,
      externalId: item.externalId,
      url: item.url,
      forwardFrom: null,
      sourceModifiedAt: null,
      parserVersion: SITE_PARSER_VERSION,
    };
    const withTitle = (title: string, body: string): string => (title && !body.startsWith(title) ? `${title}\n\n${body}` : body);

    if (item.feedBodyIsFull && item.feedBody) {
      return {
        ...base,
        title: item.title,
        body: withTitle(item.title, item.feedBody),
        publishedAt: item.date.date,
        publishedAtPrecision: item.date.precision,
        publishedAtRaw: item.date.raw || null,
        representation: 'site_feed_content@1+title',
        completeness: 'full',
        completenessReason: 'feed_content_contract',
        attachments: [],
        fetchedAt: new Date(),
      };
    }

    const excerpt = (reason: string): IIncomingDocument | null => {
      // Известную публикацию анонсом не перезаписываем: полная версия важнее.
      if (known) return null;
      const text = item.feedBody || item.teaser;
      if (!text) return null;
      return {
        ...base,
        title: item.title,
        body: withTitle(item.title, text),
        publishedAt: item.date.date,
        publishedAtPrecision: item.date.precision,
        publishedAtRaw: item.date.raw || null,
        representation: 'site_excerpt@1+title',
        completeness: item.feedBody && !profile.rssContentIsFull ? 'unknown' : 'excerpt',
        completenessReason: reason,
        attachments: [],
        fetchedAt: new Date(),
      };
    };

    let host = '';
    try {
      host = new URL(item.url).hostname;
    } catch {
      host = '';
    }
    if (!hostMatchesPolicy(host, policy)) {
      report.counts.failed += 1;
      return excerpt('article_link_outside_source');
    }

    const page = await fetchPage(item.url);
    if (page.kind === 'not_modified') return null;
    if (page.kind !== 'ok') {
      report.counts.failed += 1;
      report.errors.push(`статья ${item.url}: ${page.message}`);
      return excerpt(`article_fetch_failed:${page.kind === 'http' ? page.status : page.kind}`);
    }
    const article = parseArticlePage(page.text, profile);
    if (article.body === '') {
      report.counts.failed += 1;
      return excerpt(article.completenessReason);
    }
    const date = article.date && article.date.date ? article.date : item.date;
    const title = article.title || item.title;
    return {
      ...base,
      title,
      body: withTitle(title, article.body),
      publishedAt: date.date,
      publishedAtPrecision: date.precision,
      publishedAtRaw: date.raw || null,
      representation: 'site_article@1+title',
      completeness: article.completeness,
      completenessReason: article.completenessReason,
      attachments: article.attachments,
      fetchedAt: new Date(),
    };
  };

  /** Записи страницы и курсор — одной транзакцией. */
  const persist = async (docs: IIncomingDocument[], pageUrl: string, pageResult: SiteFetchResult, cursorPatch: ISiteCursor): Promise<void> => {
    if (dryRun) {
      report.counts.saved += docs.length;
      return;
    }
    await withTransaction(async (client: PoolClient) => {
      for (const doc of docs) {
        const stored = await storeDocument(doc, client);
        report.counts[STORE_COUNT[stored.outcome]] += 1;
      }
      await saveConditional(client, source.id, pageUrl, pageResult);
      await client.query(
        `UPDATE sources SET cursor = jsonb_set(cursor, '{site}', coalesce(cursor->'site', '{}'::jsonb) || $2::jsonb), updated_at = now()
         WHERE id = $1`,
        [source.id, JSON.stringify(cursorPatch)],
      );
    });
  };

  const addSamples = (docs: IIncomingDocument[]): void => {
    for (const doc of docs) {
      if (report.samples.length >= 5) break;
      report.samples.push({
        url: doc.url ?? '',
        title: doc.title ?? '',
        completeness: doc.completeness ?? 'unknown',
        reason: doc.completenessReason ?? '',
        preview: doc.body.slice(0, 300),
      });
    }
  };

  /** Записи одной страницы: известные пропускаются (кроме refetchKnown), новые — через статью. */
  const processItems = async (page: IListPage): Promise<{ docs: IIncomingDocument[]; fresh: number }> => {
    const known = await loadKnown(source.id, page.items);
    const docs: IIncomingDocument[] = [];
    let fresh = 0;
    for (const item of page.items) {
      if (report.counts.found >= maxItems) break;
      report.counts.found += 1;
      const key = itemIdentity({ externalId: item.externalId, url: item.url, body: '' }).key;
      const knownItem = known.get(key);
      if (!knownItem) fresh += 1;
      if (knownItem && !profile.refetchKnown && !item.feedBodyIsFull) {
        report.counts.skipped += 1;
        continue;
      }
      const doc = await buildDocument(item, knownItem);
      if (doc) docs.push(doc);
      else if (knownItem) report.counts.skipped += 1;
    }
    return { docs, fresh };
  };

  const isDegraded = (page: IListPage): boolean =>
    page.items.length < profile.expectations.minItemsOnList && (page.htmlLength > 2000 || (cursor.lastListCount ?? 0) > 0);

  // --- RSS -----------------------------------------------------------------
  if (profile.mode === 'rss') {
    let feedUrl = profile.rss ?? (typeof source.cursor.feed_url === 'string' ? source.cursor.feed_url : null);
    if (!feedUrl) {
      // discover: только лента, объявленная в <head> главной страницы на хосте источника.
      const home = await fetchPage(baseUrl);
      if (home.kind === 'ok') {
        const declared = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(home.text)?.[0];
        const href = declared ? /href=["']([^"']+)["']/i.exec(declared)?.[1] : undefined;
        const candidate = href ? canonicalUrlFor(href, baseUrl, profile) : null;
        if (candidate && hostMatchesPolicy(new URL(candidate).hostname, policy)) feedUrl = candidate;
      }
      if (!feedUrl) {
        report.outcome = 'config_invalid';
        report.health = 'config_invalid';
        report.healthReason = 'лента не объявлена на главной странице: укажите rss в профиле или режим html_list';
        return report;
      }
      if (!dryRun) {
        await getPool().query(`UPDATE sources SET cursor = cursor || $2::jsonb WHERE id = $1`, [
          source.id,
          JSON.stringify({ feed_url: feedUrl }),
        ]);
      }
    }
    const result = await fetchPage(feedUrl);
    if (result.kind === 'not_modified') {
      report.outcome = 'not_modified';
      report.httpStatus = 304;
      report.coverage = { mode: 'rss', stopReason: 'not_modified' };
      if (!dryRun) await withTransaction(client => saveConditional(client, source.id, feedUrl, result));
    } else if (result.kind !== 'ok') {
      fail(result, 'лента');
    } else {
      report.pagesFetched = 1;
      report.httpStatus = result.status;
      if (!looksLikeFeed(result.text)) {
        report.outcome = 'parser_degraded';
        report.health = 'parser_degraded';
        report.healthReason = 'по адресу ленты не RSS/Atom — возможно, адрес или формат изменился';
      } else {
        const page = parseFeedPage(result.text, baseUrl, profile);
        report.layoutStats = page.stats;
        if (page.items.length === 0 && (cursor.lastListCount ?? 0) > 0) {
          report.outcome = 'parser_degraded';
          report.health = 'parser_degraded';
          report.healthReason = `лента разобрана в 0 записей, раньше было ${cursor.lastListCount}`;
        } else {
          const { docs } = await processItems(page);
          addSamples(docs);
          await persist(docs, feedUrl, result, { lastListCount: page.items.length });
          report.coverage = {
            mode: 'rss',
            stopReason: page.items.length === 0 ? 'empty_feed' : report.counts.found >= maxItems ? 'max_items' : 'feed_window',
            note: 'лента отдаёт только последние записи; полнота истории не гарантируется',
            itemsInFeed: page.items.length,
          };
        }
      }
    }
  }

  // --- HTML-список с пагинацией -------------------------------------------
  if (profile.mode === 'html_list') {
    const maxPages = Math.min(options.maxPages ?? profile.pagination?.maxPages ?? 1, profile.pagination?.maxPages ?? 1);
    let pageUrl: string | null = canonicalUrlFor(profile.startUrls[0]!, baseUrl, profile);
    let stopReason = 'exhausted';
    const backlogResume = cursor.backlogNext ?? null;
    // Головная фаза: свежие страницы до недочитанного хвоста. Они не переписывают курсор хвоста,
    // а если новых записей на них нет — обход сразу переходит к хвосту.
    let headPhase = backlogResume !== null;
    // Головные страницы не расходуют бюджет страниц: иначе при maxPages=1 хвост не дочитался бы никогда.
    let headPages = 0;

    while (pageUrl) {
      if (report.pagesFetched - headPages >= maxPages) {
        stopReason = 'max_pages';
        break;
      }
      if (report.counts.found >= maxItems) {
        stopReason = 'max_items';
        break;
      }
      const result = await fetchPage(pageUrl);
      if (result.kind === 'not_modified') {
        report.pagesFetched += 1;
        report.httpStatus = 304;
        if (!dryRun) await withTransaction(client => saveConditional(client, source.id, pageUrl!, result));
        if (backlogResume && backlogResume !== pageUrl) {
          pageUrl = backlogResume;
          continue;
        }
        stopReason = 'not_modified';
        if (report.pagesFetched === 1) report.outcome = 'not_modified';
        break;
      }
      if (result.kind !== 'ok') {
        fail(result, `страница ${report.pagesFetched + 1}`);
        stopReason = 'failed';
        break;
      }
      report.pagesFetched += 1;
      if (headPhase) headPages += 1;
      report.httpStatus = result.status;
      const page = parseListPage(result.text, pageUrl, profile);
      for (const [k, v] of Object.entries(page.stats)) report.layoutStats[k] = (report.layoutStats[k] ?? 0) + v;
      if (isDegraded(page)) {
        report.outcome = report.pagesFetched > 1 ? 'partial' : 'parser_degraded';
        report.health = 'parser_degraded';
        report.healthReason = `страница ${report.pagesFetched}: селектор списка нашёл ${page.items.length} записей (ожидалось не меньше ${profile.expectations.minItemsOnList})`;
        stopReason = 'parser_degraded';
        break;
      }
      const { docs, fresh } = await processItems(page);
      addSamples(docs);
      if (pageUrl === backlogResume) headPhase = false;
      await persist(
        docs,
        pageUrl,
        result,
        headPhase
          ? { lastListCount: page.items.length }
          : { backlogNext: page.nextUrl, caughtUp: page.nextUrl === null, lastListCount: page.items.length },
      );
      if (headPhase && (fresh === 0 || page.nextUrl === null || page.nextUrl === backlogResume || headPages >= maxPages)) {
        headPhase = false;
        pageUrl = backlogResume;
        continue;
      }
      if (!page.nextUrl) {
        stopReason = 'exhausted';
        pageUrl = null;
        break;
      }
      // Догнали: новых нет, история уже пройдена, и следующая страница — не недочитанный хвост.
      if (fresh === 0 && cursor.caughtUp === true && page.nextUrl !== backlogResume) {
        stopReason = 'caught_up';
        if (!dryRun) {
          await getPool().query(
            `UPDATE sources SET cursor = jsonb_set(cursor, '{site}', coalesce(cursor->'site', '{}'::jsonb) || $2::jsonb) WHERE id = $1`,
            [source.id, JSON.stringify({ backlogNext: null, caughtUp: true })],
          );
        }
        break;
      }
      pageUrl = page.nextUrl;
    }
    report.coverage = {
      mode: 'html_list',
      stopReason,
      pagesFetched: report.pagesFetched,
      maxPages,
      backlogNext: stopReason === 'max_pages' || stopReason === 'failed' ? pageUrl : null,
      note:
        stopReason === 'exhausted'
          ? 'пройдены все страницы списка, доступные по пагинации'
          : 'лимит, сбой или догон: полнота истории не гарантируется',
    };
  }

  // --- Карточки объектов ----------------------------------------------------
  if (profile.projectCards && (report.outcome === 'ok' || report.outcome === 'not_modified')) {
    let cards = 0;
    for (const raw of profile.projectCards.urls) {
      if (cards >= maxItems) break;
      const url = canonicalUrlFor(raw, baseUrl, profile);
      if (!url) continue;
      cards += 1;
      const result = await fetchPage(url);
      if (result.kind === 'not_modified') {
        report.counts.skipped += 1;
        continue;
      }
      if (result.kind !== 'ok') {
        report.counts.failed += 1;
        report.errors.push(`карточка ${url}: ${result.message}`);
        continue;
      }
      const card = parseProjectCard(result.text, profile);
      report.counts.found += 1;
      if (!card.name) {
        report.counts.failed += 1;
        report.health = 'parser_degraded';
        report.healthReason = `карточка ${url}: не найдено название объекта`;
        continue;
      }
      const doc: IIncomingDocument = {
        sourceId: source.id,
        sourceRunId: options.sourceRunId ?? null,
        externalId: null,
        url,
        title: card.name,
        body: card.body,
        publishedAt: null,
        forwardFrom: null,
        representation: 'project_card@1',
        completeness: 'full',
        completenessReason: `project_card_fields:${card.fields.length}`,
        attachments: [],
        sourceModifiedAt: null,
        fetchedAt: new Date(),
        parserVersion: SITE_PARSER_VERSION,
      };
      addSamples([doc]);
      await persist([doc], url, result, {});
    }
    report.coverage.projectCards = cards;
  }

  if (report.outcome === 'ok' && report.health === 'ok' && report.counts.failed > 0) {
    report.healthReason = `не удалось получить часть статей: ${report.counts.failed}`;
  }
  return report;
};

export const policyOf = (source: ISource): ISourceNetworkPolicy => policyForProfile(source.baseUrl ?? `https://${source.key}`, parseSiteProfile(source.config));
