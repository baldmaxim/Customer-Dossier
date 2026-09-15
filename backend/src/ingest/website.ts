// Разбор RSS/Atom и текста статьи — чистые функции прежнего адаптера (этап 01–02).
//
// Сетевой обход сайтов с профилями, пагинацией, условными запросами и покрытием —
// ingest/sites/* (этап 05A). Здесь остаются разборщики, на которые опираются тесты
// и которые используются адаптером как запасной путь.

import * as cheerio from 'cheerio';

import type { TextCompleteness } from '../revisions/store.js';

export interface IWebsiteArticle {
  externalId: string;
  url: string;
  title: string;
  body: string;
  publishedAt: Date | null;
  /**
   * Полнота по происхождению текста, а не по длине: description/summary —
   * анонс; content:encoded — может быть урезан лентой (unknown); текст со
   * страницы статьи по явному или семантическому контейнеру — full.
   */
  completeness: TextCompleteness;
  completenessReason: string;
  representation: string;
}

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
    const fullContent = node.find('content\\:encoded').first().text() || node.find('content').first().text();
    const summary = node.find('description').first().text() || node.find('summary').first().text();
    const body = stripHtml(fullContent || summary);

    items.push({
      externalId: node.find('guid').first().text().trim() || url,
      url,
      title,
      body,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      completeness: body === '' ? 'unknown' : fullContent ? 'unknown' : 'excerpt',
      completenessReason: body === '' ? 'feed_no_text' : fullContent ? 'feed_content_unverified' : 'feed_summary',
      representation: 'rss_text@1',
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
export type ArticleTextMethod = 'selector' | 'semantic' | 'heuristic' | 'none';

export const extractArticleText = (html: string, selector?: string): string =>
  extractArticleTextWithMethod(html, selector).text;

/** Текст статьи и способ, которым он найден: от способа зависит, считать ли его полным. */
export const extractArticleTextWithMethod = (
  html: string,
  selector?: string,
): { text: string; method: ArticleTextMethod } => {
  const $ = cheerio.load(html);

  // Шум, который иначе попадёт в текст и испортит цитаты.
  $('script, style, nav, header, footer, aside, form, noscript').remove();

  if (selector) {
    const explicit = stripHtml($(selector).first().html() ?? '');
    if (explicit.length > 200) return { text: explicit, method: 'selector' };
  }

  for (const candidate of ['article', '[itemprop="articleBody"]', '.article__text', '.entry-content']) {
    const text = stripHtml($(candidate).first().html() ?? '');
    if (text.length > 200) return { text, method: 'semantic' };
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

  return { text: best, method: best === '' ? 'none' : 'heuristic' };
};
