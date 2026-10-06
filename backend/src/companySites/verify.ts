// Проверка кандидата в сайты компании до решения оператора (этап 25A, ADR-018 — исключение из правила
// «без допуска живых запросов нет», решение владельца 06.10.2026).
//
// Открываются главная и до трёх страниц того же хоста, похожих на «Контакты / О компании / Раскрытие
// информации». На них ищется реквизит компании — на сайте застройщика ИНН обычно в подвале или в разделе
// документов. Хранятся только признаки и заголовок главной; текст страниц не сохраняется. Сеть — только
// safeFetch с хостом кандидата: перенаправление на другой сайт — отдельный исход, а не «сайт проверен».

import * as cheerio from 'cheerio';

import { fetchSitePage, type SiteFetchResult } from '../ingest/sites/fetcher.js';
import { nameCore } from '../ingest/registry/domrfCompanies.js';
import { DEFAULT_SOURCE_LIMITS, hostMatchesPolicy, type ISourceNetworkPolicy } from '../net/safeFetch.js';
import { classifyTaxId } from '../resolve/identifiers.js';
import { normalizeName } from '../resolve/normalize.js';

export type SiteCheckStatus = 'ok' | 'unreachable' | 'blocked' | 'redirect_other_host' | 'js_only' | 'not_html';

export interface ICompanyIdentity {
  name: string;
  /** ИНН и ОГРН с верной контрольной суммой из entity_identifiers. */
  inn: string | null;
  ogrn: string | null;
}

export interface ISiteCheck {
  status: SiteCheckStatus;
  pageTitle: string | null;
  innOnPage: boolean | null;
  ogrnOnPage: boolean | null;
  nameOnPage: boolean | null;
  otherInns: string[];
  /** Почему не прочитано: код ответа или ошибка сети — оператору. */
  error: string | null;
  pagesRead: number;
}

/** Сколько страниц кроме главной: контакты, о компании, раскрытие информации. */
export const EXTRA_PAGES_MAX = 3;

/** Меньше этого текста на главной при скриптах — сайт рисуется в браузере, без него не прочитать. */
const JS_ONLY_TEXT_MIN = 200;

const OTHER_INNS_MAX = 10;

/** Пауза между страницами одного сайта: проверка не должна выглядеть как обход. */
export const PAGE_PAUSE_MS = 1500;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const INFO_LINK = /контакт|о\s+компании|о\s+нас|о\s+группе|раскрыти|документ|реквизит|contact|about/iu;

export const candidatePolicy = (host: string): ISourceNetworkPolicy => ({
  allowedHosts: [host],
  allowSubdomains: true,
  ...DEFAULT_SOURCE_LIMITS,
  timeoutMs: 20_000,
});

/** Текст страницы целиком, с подвалом: реквизиты обычно там. Пробел перед каждым тегом не склеивает «ИНН» с числом. */
export const pageText = (html: string): { title: string | null; text: string; scripts: number } => {
  const $ = cheerio.load(html.replace(/</g, ' <'));
  const scripts = $('script').length;
  const title = $('title').first().text().replace(/\s+/g, ' ').trim() || null;
  $('script, style, noscript, svg, template').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return { title: title ? title.slice(0, 300) : null, text, scripts };
};

/** Ссылки той же площадки на страницы с реквизитами — по тексту ссылки и адресу. */
export const infoLinks = (html: string, baseUrl: string, policy: ISourceNetworkPolicy): string[] => {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !hostMatchesPolicy(url.hostname, policy)) return;
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Битый адрес — смотрим как есть.
    }
    if (!INFO_LINK.test(label) && !INFO_LINK.test(path)) return;
    url.hash = '';
    const key = url.toString();
    if (key !== baseUrl && !out.includes(key)) out.push(key);
  });
  return out.slice(0, EXTRA_PAGES_MAX);
};

const digitsPresent = (text: string, value: string | null): boolean | null =>
  value === null ? null : new RegExp(`(?<![0-9])${value}(?![0-9])`).test(text);

/** Название на странице: ядро названия (без «СЗ», «Групп» и т. п.) целиком среди слов текста. */
const namePresent = (text: string, name: string): boolean | null => {
  const core = nameCore(name);
  if (core.length === 0) return null;
  const words = new Set(normalizeName(text).latin.split(' '));
  return core.every(word => words.has(word));
};

/** ИНН, написанные после слова «ИНН», с верной контрольной суммой и не равные ИНН компании. */
export const otherInnsIn = (text: string, own: string | null): string[] => {
  const found = new Set<string>();
  for (const match of text.matchAll(/ИНН[\s:№/]*([0-9]{10}|[0-9]{12})(?![0-9])/giu)) {
    const typed = classifyTaxId(match[1]!);
    if (typed?.identifierType === 'inn' && typed.validationStatus === 'checksum_valid' && typed.value !== own) found.add(typed.value);
    if (found.size >= OTHER_INNS_MAX) break;
  }
  return [...found];
};

const failed = (status: SiteCheckStatus, error: string): ISiteCheck => ({
  status,
  pageTitle: null,
  innOnPage: null,
  ogrnOnPage: null,
  nameOnPage: null,
  otherInns: [],
  error: error.slice(0, 300),
  pagesRead: 0,
});

/** Исход запроса главной, который не дал страницы: разные причины — разные слова оператору. */
const unreadable = (result: Exclude<SiteFetchResult, { kind: 'ok' }>): ISiteCheck => {
  if (result.kind === 'http') {
    return failed([401, 403, 429, 451].includes(result.status) ? 'blocked' : 'unreachable', `HTTP ${result.status}`);
  }
  if (result.kind === 'policy' && result.message.startsWith('host_not_allowed')) {
    return failed('redirect_other_host', 'главная перенаправляет на другой сайт');
  }
  if (result.kind === 'not_modified') return failed('unreachable', 'HTTP 304 без условного запроса');
  return failed('unreachable', result.message);
};

const looksLikeHtml = (text: string): boolean => /<(html|body|head|div|p|a)[\s>]/i.test(text.slice(0, 20_000));

export type PageFetcher = (url: string, policy: ISourceNetworkPolicy) => Promise<SiteFetchResult>;

const defaultFetcher: PageFetcher = (url, policy) => fetchSitePage(url, policy, null, { accept: 'text/html,application/xhtml+xml' });

/**
 * Проверка кандидата: главная (обязательно) и до трёх страниц с реквизитами (по возможности — их сбой
 * проверку не валит). Признаки считаются по всем прочитанным страницам вместе.
 */
export const verifyCandidate = async (
  siteUrl: string,
  host: string,
  company: ICompanyIdentity,
  fetchPage: PageFetcher = defaultFetcher,
  pauseMs: number = PAGE_PAUSE_MS,
): Promise<ISiteCheck> => {
  const policy = candidatePolicy(host);
  const home = await fetchPage(siteUrl, policy);
  if (home.kind !== 'ok') return unreadable(home);
  if (!looksLikeHtml(home.text)) return failed('not_html', 'главная отдала не HTML');

  const main = pageText(home.text);
  const texts = [main.text];
  let pagesRead = 1;
  for (const link of infoLinks(home.text, home.finalUrl, policy)) {
    if (pauseMs > 0) await sleep(pauseMs);
    const page = await fetchPage(link, policy);
    if (page.kind !== 'ok' || !looksLikeHtml(page.text)) continue;
    texts.push(pageText(page.text).text);
    pagesRead += 1;
  }
  const all = texts.join(' ');
  const jsOnly = main.text.length < JS_ONLY_TEXT_MIN && main.scripts > 0 && pagesRead === 1;
  return {
    status: jsOnly ? 'js_only' : 'ok',
    pageTitle: main.title,
    innOnPage: digitsPresent(all, company.inn),
    ogrnOnPage: digitsPresent(all, company.ogrn),
    nameOnPage: namePresent(`${main.title ?? ''} ${all}`, company.name),
    otherInns: otherInnsIn(all, company.inn),
    error: null,
    pagesRead,
  };
};
