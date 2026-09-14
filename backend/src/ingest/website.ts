// Чтение сайтов.
//
// Основной путь — RSS/Atom. Он стабильнее любых CSS-селекторов: лента редко
// меняет формат, тогда как вёрстку сайта переделывают ежегодно. Кроме того,
// это явно опубликованный для машин интерфейс, а не обход чужого дизайна.
//
// Если ленты нет, работает запасной путь: список ссылок по селектору. Он
// намеренно вторичен — селекторы придётся чинить.

import * as cheerio from 'cheerio';

import { env } from '../config/env.js';
import {
  DEFAULT_SOURCE_LIMITS,
  NetworkPolicyError,
  hostMatchesPolicy,
  safeFetch,
  type ISafeFetchDeps,
  type ISourceNetworkPolicy,
} from '../net/safeFetch.js';

/** Автообнаружение: где чаще всего лежит лента, если её адрес не указан. */
const COMMON_FEED_PATHS = ['/rss', '/rss.xml', '/feed', '/feed/', '/atom.xml', '/index.xml'];

export interface IWebsiteConfig {
  /** Прямой адрес ленты. Если задан, автообнаружение не выполняется. */
  rss?: string;
  /** Запасной путь: селектор ссылок на статьи на странице раздела. */
  listSelector?: string;
  /** Селектор основного текста статьи. Пусто — берём общий алгоритм. */
  articleSelector?: string;
  /** Раздел сайта, если читаем не с корня. */
  section?: string;
}

export interface IWebsiteArticle {
  externalId: string;
  url: string;
  title: string;
  body: string;
  publishedAt: Date | null;
}

export class WebsiteFetchError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    /** http — ответ не 2xx; network/timeout — сбой связи; остальное — запрет сетевой политики. */
    readonly kind: string = 'http',
  ) {
    super(message);
    this.name = 'WebsiteFetchError';
  }
}

/**
 * Сетевая политика сайта: хост адреса сайта и хост ленты, с поддоменами.
 * Ссылка из ленты на чужой домен не открывается — анонс остаётся анонсом.
 */
export const policyForSite = (baseUrl: string, config: Pick<IWebsiteConfig, 'rss'> = {}): ISourceNetworkPolicy => {
  const hosts = new Set<string>();
  for (const raw of [baseUrl, config.rss]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      // некорректный адрес в настройках не расширяет allowlist
    }
  }
  return { allowedHosts: [...hosts], allowSubdomains: true, ...DEFAULT_SOURCE_LIMITS };
};

/** Для тестов: подмена DNS и проверки адресов. */
let fetchDeps: ISafeFetchDeps = {};
export const setWebsiteFetchDepsForTests = (deps: ISafeFetchDeps): void => {
  fetchDeps = deps;
};

const fetchText = async (
  url: string,
  policy: ISourceNetworkPolicy,
): Promise<{ text: string; httpStatus: number }> => {
  let response;
  try {
    response = await safeFetch(
      url,
      policy,
      { headers: { 'user-agent': env.INGEST_USER_AGENT, 'accept-language': 'ru,en;q=0.8' } },
      fetchDeps,
    );
  } catch (err) {
    if (err instanceof NetworkPolicyError) {
      throw new WebsiteFetchError(`Запрос запрещён или не выполнен (${err.kind}): ${err.message}`, null, err.kind);
    }
    throw new WebsiteFetchError('Сеть недоступна', null, 'network');
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WebsiteFetchError(`HTTP ${response.status}`, response.status, 'http');
  }
  return { text: response.text, httpStatus: response.status };
};

/** Ищем ленту: сначала объявленную в <head>, потом типовые адреса. */
export const discoverFeedUrl = async (baseUrl: string): Promise<string | null> => {
  const policy = policyForSite(baseUrl);
  try {
    const { text } = await fetchText(baseUrl, policy);
    const $ = cheerio.load(text);
    const declared = $(
      'link[type="application/rss+xml"], link[type="application/atom+xml"]',
    ).attr('href');
    // Объявленная лента на чужом домене не принимается автоматически.
    if (declared) {
      const url = new URL(declared, baseUrl);
      if (hostMatchesPolicy(url.hostname, policy)) return url.toString();
    }
  } catch (err) {
    // Главная может не открыться — не повод бросать поиск. Но запрет политики
    // (внутренний адрес, чужой хост) — повод: типовые пути на том же хосте
    // упрутся в тот же запрет.
    if (err instanceof WebsiteFetchError && err.kind !== 'http' && err.kind !== 'network' && err.kind !== 'timeout') {
      throw err;
    }
  }

  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, baseUrl).toString();
    try {
      const { text } = await fetchText(candidate, policy);
      if (looksLikeFeed(text)) return candidate;
    } catch {
      continue;
    }
  }

  return null;
};

export const looksLikeFeed = (text: string): boolean =>
  /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(text.slice(0, 2000));

/**
 * Разбор RSS и Atom одной функцией: различий ровно два — имя элемента записи
 * и способ хранить ссылку. Отдельные ветки на каждый формат себя не окупают.
 */
export const parseFeed = (
  xml: string,
  baseUrl: string,
): { items: IWebsiteArticle[]; layoutStats: Record<string, number> } => {
  const $ = cheerio.load(xml, { xmlMode: true });

  const rssItems = $('item');
  const atomItems = $('entry');
  const nodes = rssItems.length > 0 ? rssItems : atomItems;

  const items: IWebsiteArticle[] = [];

  nodes.each((_, el) => {
    const node = $(el);
    const title = node.find('title').first().text().trim();

    // RSS кладёт ссылку в текст, Atom — в атрибут href.
    const linkText = node.find('link').first().text().trim();
    const linkHref = node.find('link').first().attr('href') ?? '';
    const rawLink = linkText || linkHref;
    if (!rawLink) return;

    const url = new URL(rawLink, baseUrl).toString();

    const dateRaw =
      node.find('pubDate').first().text() ||
      node.find('published').first().text() ||
      node.find('updated').first().text() ||
      node.find('dc\\:date').first().text();
    const parsedDate = dateRaw ? new Date(dateRaw.trim()) : null;

    // description/summary — обычно анонс. Полный текст доберём со страницы,
    // но если он есть прямо в ленте (content:encoded), берём его.
    const contentHtml =
      node.find('content\\:encoded').first().text() ||
      node.find('content').first().text() ||
      node.find('description').first().text() ||
      node.find('summary').first().text();

    items.push({
      externalId: node.find('guid').first().text().trim() || url,
      url,
      title,
      body: stripHtml(contentHtml),
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    });
  });

  return {
    items,
    layoutStats: { rss_item: rssItems.length, atom_entry: atomItems.length, parsed: items.length },
  };
};

const stripHtml = (html: string): string => {
  if (html.trim() === '') return '';
  const $ = cheerio.load(`<div>${html}</div>`);
  return $('div')
    .first()
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Основной текст статьи.
 *
 * Сначала пробуем явный селектор из настроек источника, затем семантические
 * теги. Общий запасной алгоритм — контейнер с наибольшим объёмом текста в <p>:
 * на новостных страницах это почти всегда тело статьи, а меню и подвал
 * набирают мало.
 */
export const extractArticleText = (html: string, selector?: string): string => {
  const $ = cheerio.load(html);

  // Шум, который иначе попадёт в текст и испортит цитаты.
  $('script, style, nav, header, footer, aside, form, noscript').remove();

  if (selector) {
    const explicit = stripHtml($(selector).first().html() ?? '');
    if (explicit.length > 200) return explicit;
  }

  for (const candidate of ['article', '[itemprop="articleBody"]', '.article__text', '.entry-content']) {
    const text = stripHtml($(candidate).first().html() ?? '');
    if (text.length > 200) return text;
  }

  let best = '';
  $('div, section, main').each((_, el) => {
    const node = $(el);
    // Только прямые абзацы: иначе выигрывает <body>, поглощающий всё подряд.
    const text = node
      .children('p')
      .map((__, p) => $(p).text())
      .get()
      .join('\n\n')
      .trim();
    if (text.length > best.length) best = text;
  });

  return best;
};

export interface IFetchSiteResult {
  articles: IWebsiteArticle[];
  feedUrl: string | null;
  layoutStats: Record<string, number>;
  httpStatus: number;
}

/**
 * Один проход по сайту. Полный текст статей добираем только для новых ссылок
 * и не более limit штук: страница статьи — это отдельный запрос, и вежливость
 * тут важнее полноты.
 */
export const fetchSite = async (
  baseUrl: string,
  config: IWebsiteConfig,
  knownUrls: ReadonlySet<string>,
  limit = 10,
): Promise<IFetchSiteResult> => {
  const feedUrl = config.rss ?? (await discoverFeedUrl(baseUrl));

  if (!feedUrl) {
    // listSelector объявлен в IWebsiteConfig, но разбор HTML-раздела ещё не
    // реализован (этап 05A). Предлагать его как рабочий путь нельзя.
    throw new WebsiteFetchError(
      'RSS-лента не найдена. Укажите её адрес в настройках источника (config.rss). ' +
        'Сайты без RSS пока не поддерживаются.',
      null,
    );
  }

  const policy = policyForSite(baseUrl, { rss: feedUrl });
  const { text, httpStatus } = await fetchText(feedUrl, policy);
  if (!looksLikeFeed(text)) {
    throw new WebsiteFetchError(`По адресу ${feedUrl} не лента, а обычная страница`, httpStatus);
  }

  const { items, layoutStats } = parseFeed(text, baseUrl);

  const fresh = items.filter(item => !knownUrls.has(item.url)).slice(0, limit);
  let enriched = 0;
  let blockedLinks = 0;

  for (const item of fresh) {
    // Анонса из ленты часто хватает, и лишний запрос тогда ни к чему.
    if (item.body.length >= 400) continue;
    // Ссылка на чужой домен не открывается: анонс остаётся как есть.
    let linkHost = '';
    try {
      linkHost = new URL(item.url).hostname;
    } catch {
      linkHost = '';
    }
    if (!hostMatchesPolicy(linkHost, policy)) {
      blockedLinks += 1;
      continue;
    }
    try {
      const page = await fetchText(item.url, policy);
      const full = extractArticleText(page.text, config.articleSelector);
      if (full.length > item.body.length) {
        item.body = full;
        enriched += 1;
      }
    } catch {
      // Статья недоступна — оставляем анонс из ленты, он тоже пригоден.
    }
    await new Promise(resolve => setTimeout(resolve, env.TG_FETCH_DELAY_MS));
  }

  return {
    articles: fresh,
    feedUrl,
    layoutStats: { ...layoutStats, fresh: fresh.length, enriched, blocked_links: blockedLinks },
    httpStatus,
  };
};
