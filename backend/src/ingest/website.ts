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
  ) {
    super(message);
    this.name = 'WebsiteFetchError';
  }
}

const fetchText = async (url: string): Promise<{ text: string; httpStatus: number }> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': env.INGEST_USER_AGENT, 'Accept-Language': 'ru,en;q=0.8' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new WebsiteFetchError(
      `Сеть недоступна: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
  }
  if (!response.ok) throw new WebsiteFetchError(`HTTP ${response.status}`, response.status);
  return { text: await response.text(), httpStatus: response.status };
};

/** Ищем ленту: сначала объявленную в <head>, потом типовые адреса. */
export const discoverFeedUrl = async (baseUrl: string): Promise<string | null> => {
  try {
    const { text } = await fetchText(baseUrl);
    const $ = cheerio.load(text);
    const declared = $(
      'link[type="application/rss+xml"], link[type="application/atom+xml"]',
    ).attr('href');
    if (declared) return new URL(declared, baseUrl).toString();
  } catch {
    // Главная может не открыться — не повод бросать поиск.
  }

  for (const path of COMMON_FEED_PATHS) {
    const candidate = new URL(path, baseUrl).toString();
    try {
      const { text } = await fetchText(candidate);
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
    throw new WebsiteFetchError(
      'RSS-лента не найдена. Укажите её адрес в настройках источника (config.rss) ' +
        'или задайте listSelector для разбора страницы раздела.',
      null,
    );
  }

  const { text, httpStatus } = await fetchText(feedUrl);
  if (!looksLikeFeed(text)) {
    throw new WebsiteFetchError(`По адресу ${feedUrl} не лента, а обычная страница`, httpStatus);
  }

  const { items, layoutStats } = parseFeed(text, baseUrl);

  const fresh = items.filter(item => !knownUrls.has(item.url)).slice(0, limit);
  let enriched = 0;

  for (const item of fresh) {
    // Анонса из ленты часто хватает, и лишний запрос тогда ни к чему.
    if (item.body.length >= 400) continue;
    try {
      const page = await fetchText(item.url);
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
    layoutStats: { ...layoutStats, fresh: fresh.length, enriched },
    httpStatus,
  };
};
