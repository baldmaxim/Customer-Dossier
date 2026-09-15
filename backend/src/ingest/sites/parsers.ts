// Разбор страниц сайта по профилю (этап 05A). Чистые функции: сеть и БД не нужны.
//
// Каждый разбор возвращает счётчики селекторов: пустой результат при большой странице —
// повод заподозрить смену вёрстки (parser_degraded), а не «новостей нет».

import * as cheerio from 'cheerio';

import type { IAttachment, TextCompleteness } from '../../revisions/store.js';
import { canonicalizeUrl } from '../../revisions/identity.js';
import { parseSiteDate, type IParsedDate } from './dates.js';
import type { ISiteProfile } from './profile.js';

export interface IListedItem {
  url: string;
  title: string;
  teaser: string;
  date: IParsedDate;
  /** Для RSS: отметка обновления записи — по ней видно, что статью стоит перечитать. */
  updatedRaw: string | null;
  /** Текст из ленты, если он есть. */
  feedBody: string;
  feedBodyIsFull: boolean;
  externalId: string | null;
}

export interface IListPage {
  items: IListedItem[];
  nextUrl: string | null;
  stats: Record<string, number>;
  htmlLength: number;
}

const clean = (text: string): string =>
  text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const htmlToText = (html: string): string => {
  if (html.trim() === '') return '';
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $('#__root br').replaceWith('\n');
  $('#__root p, #__root li, #__root h2, #__root h3, #__root h4, #__root blockquote').each((_, el) => {
    $(el).append('\n\n');
  });
  return clean($('#__root').text());
};

/** Канонический адрес с правилами профиля: известные трекеры и явно перечисленные параметры убираются. */
export const canonicalUrlFor = (raw: string, base: string, profile: Pick<ISiteProfile, 'canonical'>): string | null => {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  for (const name of profile.canonical.dropQueryParams) url.searchParams.delete(name);
  return canonicalizeUrl(url.toString());
};

export const looksLikeFeed = (text: string): boolean => /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(text.slice(0, 2000));

/** RSS 2.0 / Atom. content:encoded полным считается только по явному контракту профиля. */
export const parseFeedPage = (xml: string, baseUrl: string, profile: ISiteProfile): IListPage => {
  const $ = cheerio.load(xml, { xmlMode: true });
  const rssItems = $('item');
  const atomItems = $('entry');
  const nodes = rssItems.length > 0 ? rssItems : atomItems;
  const items: IListedItem[] = [];
  let withoutLink = 0;

  nodes.each((_, el) => {
    const node = $(el);
    const linkText = node.find('link').first().text().trim();
    const linkHref = node.find('link').first().attr('href') ?? '';
    const url = canonicalUrlFor(linkText || linkHref, baseUrl, profile);
    if (!url) {
      withoutLink += 1;
      return;
    }
    const content = node.find('content\\:encoded').first().text() || node.find('content').first().text();
    const summary = node.find('description').first().text() || node.find('summary').first().text();
    const dateRaw = node.find('pubDate').first().text() || node.find('published').first().text() || node.find('dc\\:date').first().text();
    const updatedRaw = node.find('updated').first().text().trim() || null;
    const guid = node.find('guid').first().text().trim() || node.find('id').first().text().trim();
    items.push({
      url,
      title: clean(node.find('title').first().text()),
      teaser: htmlToText(summary),
      date: parseSiteDate(dateRaw || updatedRaw, profile.dates.timezone),
      updatedRaw,
      feedBody: htmlToText(content),
      feedBodyIsFull: Boolean(content) && profile.rssContentIsFull,
      externalId: guid && !/^https?:\/\//i.test(guid) ? guid : null,
    });
  });

  return {
    items,
    nextUrl: null,
    htmlLength: xml.length,
    stats: { rss_item: rssItems.length, atom_entry: atomItems.length, parsed: items.length, without_link: withoutLink },
  };
};

/** Страница HTML-списка: записи по селектору и ссылка на следующую страницу. */
export const parseListPage = (html: string, pageUrl: string, profile: ISiteProfile): IListPage => {
  const list = profile.list;
  if (!list) throw new Error('профиль без list');
  const $ = cheerio.load(html);
  const nodes = $(list.itemSelector);
  const items: IListedItem[] = [];
  let withoutLink = 0;
  const seen = new Set<string>();

  nodes.each((_, el) => {
    const node = $(el);
    const linkNode = list.linkSelector ? node.find(list.linkSelector).first() : node.is('a') ? node : node.find('a').first();
    const href = linkNode.attr('href');
    const url = href ? canonicalUrlFor(href, pageUrl, profile) : null;
    if (!url || seen.has(url)) {
      withoutLink += url ? 0 : 1;
      return;
    }
    seen.add(url);
    const dateNode = list.dateSelector ? node.find(list.dateSelector).first() : null;
    const dateRaw = dateNode ? (list.dateAttribute ? dateNode.attr(list.dateAttribute) : dateNode.text()) : null;
    items.push({
      url,
      title: clean((list.titleSelector ? node.find(list.titleSelector).first() : linkNode).text()),
      teaser: list.teaserSelector ? clean(node.find(list.teaserSelector).first().text()) : '',
      date: parseSiteDate(dateRaw, profile.dates.timezone),
      updatedRaw: null,
      feedBody: '',
      feedBodyIsFull: false,
      externalId: null,
    });
  });

  const nextHref = profile.pagination ? $(profile.pagination.nextSelector).first().attr('href') : undefined;
  const nextUrl = nextHref ? canonicalUrlFor(nextHref, pageUrl, profile) : null;

  return {
    items,
    nextUrl: nextUrl && nextUrl !== canonicalizeUrl(pageUrl) ? nextUrl : null,
    htmlLength: html.length,
    stats: { list_item: nodes.length, parsed: items.length, without_link: withoutLink, next: nextUrl ? 1 : 0 },
  };
};

export interface IParsedArticle {
  title: string;
  body: string;
  date: IParsedDate | null;
  completeness: TextCompleteness;
  completenessReason: string;
  attachments: IAttachment[];
  stats: Record<string, number>;
}

/** Нечитаемые вложения: отмечаются, не скачиваются и не объявляются разобранными. */
const collectAttachments = ($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): IAttachment[] => {
  const attachments: IAttachment[] = [];
  const add = (kind: string, count: number): void => {
    for (let i = 0; i < count; i += 1) attachments.push({ kind, status: 'unsupported' });
  };
  add('table', root.find('table').length);
  add('pdf', root.find('a[href$=".pdf"], a[href*=".pdf?"]').length);
  add('image', root.find('img').length);
  add('video', root.find('video, iframe').length);
  return attachments;
};

/** Статья по профилю. Без совпавшего bodySelector текст не объявляется полным. */
export const parseArticlePage = (html: string, profile: ISiteProfile): IParsedArticle => {
  const $ = cheerio.load(html);
  $('script, style, noscript, form').remove();
  const art = profile.article;
  const stats: Record<string, number> = {};

  if (art) {
    for (const sel of art.removeSelectors) $(sel).remove();
    const root = $(art.bodySelector).first();
    stats.body = root.length;
    if (root.length > 0) {
      const truncated = art.truncatedSelector ? $(art.truncatedSelector).length > 0 : false;
      stats.truncated_marker = truncated ? 1 : 0;
      const dateNode = art.dateSelector ? $(art.dateSelector).first() : null;
      const dateRaw = dateNode && dateNode.length > 0 ? (art.dateAttribute ? dateNode.attr(art.dateAttribute) : dateNode.text()) : null;
      const attachments = collectAttachments($, root);
      root.find('table').remove();
      const body = htmlToText(root.html() ?? '');
      return {
        title: clean(art.titleSelector ? $(art.titleSelector).first().text() : $('h1').first().text()),
        body,
        date: dateRaw ? parseSiteDate(dateRaw, profile.dates.timezone) : null,
        completeness: body === '' ? 'failed' : truncated ? 'excerpt' : 'full',
        completenessReason: body === '' ? 'article_body_empty' : truncated ? 'article_truncated_marker' : 'article_body_selector',
        attachments,
        stats,
      };
    }
  }

  // Профиль без статьи или селектор не нашёл узел: семантический контейнер — не полнота, а «неизвестно».
  const semantic = $('article, [itemprop="articleBody"]').first();
  stats.semantic = semantic.length;
  const body = semantic.length > 0 ? htmlToText(semantic.html() ?? '') : '';
  return {
    title: clean($('h1').first().text()),
    body,
    date: null,
    completeness: body === '' ? 'failed' : 'unknown',
    completenessReason: art ? 'article_selector_missing' : 'article_without_profile',
    attachments: semantic.length > 0 ? collectAttachments($, semantic) : [],
    stats,
  };
};

export interface IParsedProjectCard {
  name: string;
  fields: Array<{ label: string; value: string }>;
  /** Текст карточки в стабильном порядке полей: одинаковое содержание — одинаковый текст. */
  body: string;
  stats: Record<string, number>;
}

/** Карточка строительного объекта: имя и пары «поле — значение». */
export const parseProjectCard = (html: string, profile: ISiteProfile): IParsedProjectCard => {
  const card = profile.projectCards;
  if (!card) throw new Error('профиль без projectCards');
  const $ = cheerio.load(html);
  const name = clean($(card.nameSelector).first().text());
  const fields: Array<{ label: string; value: string }> = [];
  $(card.fieldRowSelector).each((_, el) => {
    const row = $(el);
    const label = clean(row.find(card.fieldLabelSelector).first().text()).replace(/:$/, '');
    const value = clean(row.find(card.fieldValueSelector).first().text());
    if (label && value) fields.push({ label, value });
  });
  const body = name ? [`Объект: ${name}`, ...fields.map(f => `${f.label}: ${f.value}`)].join('\n') : '';
  return { name, fields, body, stats: { name: name ? 1 : 0, fields: fields.length } };
};
