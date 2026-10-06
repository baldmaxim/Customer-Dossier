// Чтение подтверждённого сайта компании (этап 25B, ADR-018): главная → до maxPages-1 страниц проектов → снимки
// текста. Образец — обход реестра (ingest/registry/crawler.ts): тот же отчёт ICrawlReport, исходы запроса — те же
// слова (403 — blocked, 429 — rate_limited, сеть — network), а не «на сайте ничего нет».
//
// Чего здесь нет намеренно: обхода сайта (глубина — одна ссылка от главной), выполнения JS (страница только на JS —
// parser_degraded словами), записи в document_revisions (разбор публикаций extract@3 эти тексты не берёт).

import { env } from '../../config/env.js';
import { pageText } from '../../companySites/verify.js';
import { fetchSitePage, type SiteFetchResult } from '../sites/fetcher.js';
import { fatalFromFetch, type ICrawlOptions, type ICrawlReport } from '../sites/crawler.js';
import type { ISource } from '../sources.js';
import {
  COMPANY_SITE_PARSER_VERSION,
  CompanySiteProfileError,
  companySitePolicy,
  parseCompanySiteProfile,
  type ICompanySiteProfile,
} from './profile.js';
import { projectLinks } from './links.js';
import { NO_RULES, parseRobots, robotsAllows, type IRobotsRules } from './robots.js';
import { SiteCollectRevokedError, saveSitePage, type ISitePage, type SavePageOutcome } from './store.js';

/** Меньше этого текста на главной при скриптах — сайт рисуется в браузере, без него не прочитать. */
const JS_ONLY_TEXT_MIN = 200;

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

export type PageSaver = (sourceId: number, page: ISitePage) => Promise<SavePageOutcome>;

const looksLikeHtml = (text: string): boolean => /<(html|body|head|div|p|a)[\s>]/i.test(text.slice(0, 20_000));

const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

export const crawlCompanySite = async (
  source: ISource,
  options: ICrawlOptions = {},
  save: PageSaver = saveSitePage,
  /** Пауза между запросами; тесты подставляют мгновенную, чтобы не ждать delayMs. */
  pause: (ms: number) => Promise<void> = sleep,
): Promise<ICrawlReport> => {
  const report: ICrawlReport = {
    outcome: 'ok',
    health: 'ok',
    healthReason: null,
    httpStatus: null,
    retryAfterAt: null,
    counts: { found: 0, saved: 0, changed: 0, skipped: 0, failed: 0 },
    pagesFetched: 0,
    coverage: { mode: 'company_site', pages: [] as string[] },
    layoutStats: {},
    parserVersion: COMPANY_SITE_PARSER_VERSION,
    samples: [],
    errors: [],
  };
  const dryRun = options.dryRun ?? false;

  let profile: ICompanySiteProfile;
  try {
    profile = parseCompanySiteProfile(source.config);
  } catch (err) {
    report.outcome = 'config_invalid';
    report.health = 'config_invalid';
    report.healthReason = err instanceof CompanySiteProfileError ? err.message : String(err);
    return report;
  }
  const policy = companySitePolicy(profile);
  const maxPages = Math.min(options.maxPages ?? profile.maxPages, profile.maxPages);
  let requests = 0;

  const fetchPage = async (url: string): Promise<SiteFetchResult> => {
    if (requests > 0) await pause(profile.limits.delayMs);
    requests += 1;
    return fetchSitePage(url, policy, null, { accept: 'text/html,application/xhtml+xml' });
  };

  const fail = (result: Exclude<SiteFetchResult, { kind: 'ok' } | { kind: 'not_modified' }>, where: string): void => {
    const fatal = fatalFromFetch(result);
    report.outcome = fatal.outcome;
    report.health = fatal.health;
    report.httpStatus = result.status;
    report.retryAfterAt = result.kind === 'http' ? result.retryAfterAt : null;
    report.healthReason = `${where}: ${result.message}`;
    report.errors.push(report.healthReason);
  };

  // robots.txt: запрет соблюдается; файла нет или не прочитался — запретов нет.
  let rules: IRobotsRules = NO_RULES;
  const robots = await fetchPage(new URL('/robots.txt', profile.homepage).toString());
  if (robots.kind === 'ok' && !looksLikeHtml(robots.text)) rules = parseRobots(robots.text, env.INGEST_USER_AGENT);
  report.coverage.robots = robots.kind === 'ok' ? 'read' : 'absent';
  if (!robotsAllows(rules, pathOf(profile.homepage))) {
    report.outcome = 'blocked';
    report.health = 'blocked';
    report.healthReason = 'robots.txt сайта запрещает читать главную страницу';
    return report;
  }

  const home = await fetchPage(profile.homepage);
  if (home.kind === 'not_modified') {
    // Условных заголовков не шлём — 304 без них сайт отдавать не должен.
    report.outcome = 'http_error';
    report.health = 'error';
    report.healthReason = 'главная: HTTP 304 без условного запроса';
    return report;
  }
  if (home.kind !== 'ok') {
    fail(home, 'главная');
    return report;
  }
  report.pagesFetched += 1;
  report.httpStatus = home.status;
  if (!looksLikeHtml(home.text)) {
    report.outcome = 'parser_degraded';
    report.health = 'parser_degraded';
    report.healthReason = 'главная отдала не HTML';
    return report;
  }
  const main = pageText(home.text);
  if (main.text.length < JS_ONLY_TEXT_MIN && main.scripts > 0) {
    report.outcome = 'parser_degraded';
    report.health = 'parser_degraded';
    report.healthReason = 'сайт показывает содержимое только в браузере (JavaScript) — портал его не прочитает';
    return report;
  }

  const pages: ISitePage[] = [{ url: home.finalUrl, title: main.title, text: main.text }];
  const links = projectLinks(home.text, home.finalUrl, policy, maxPages - 1).filter(l => robotsAllows(rules, pathOf(l.url)));
  report.coverage.links = links.length;
  for (const link of links) {
    const page = await fetchPage(link.url);
    if (page.kind !== 'ok') {
      report.counts.failed += 1;
      report.errors.push(`${link.url}: ${page.kind === 'not_modified' ? 'HTTP 304' : page.message}`);
      continue;
    }
    report.pagesFetched += 1;
    if (!looksLikeHtml(page.text)) {
      report.counts.failed += 1;
      continue;
    }
    const parsed = pageText(page.text);
    pages.push({ url: page.finalUrl, title: parsed.title, text: parsed.text });
  }

  report.counts.found = pages.length;
  const read: string[] = [];
  for (const page of pages) {
    if (read.includes(page.url)) continue;
    read.push(page.url);
    if (report.samples.length < 5) {
      report.samples.push({ url: page.url, title: page.title ?? '', completeness: 'full', reason: 'страница сайта компании', preview: page.text.slice(0, 300) });
    }
    if (dryRun) {
      report.counts.saved += 1;
      continue;
    }
    try {
      const outcome = await save(source.id, page);
      if (outcome === 'saved') report.counts.saved += 1;
      else report.counts.skipped += 1;
    } catch (err) {
      if (err instanceof SiteCollectRevokedError) {
        report.outcome = 'policy_blocked';
        report.health = 'blocked';
        report.healthReason = `допуск отозван во время прохода: ${err.message}`;
        report.coverage.pages = read.slice(0, -1);
        return report;
      }
      throw err;
    }
  }
  report.coverage.pages = read;
  if (report.counts.failed > 0) {
    report.outcome = 'partial';
    report.healthReason = `не прочитано страниц проектов: ${report.counts.failed}`;
  }
  return report;
};
