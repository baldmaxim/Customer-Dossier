// Какие страницы сайта компании читать кроме главной (этап 25B): ссылки главной на тот же сайт, похожие на
// «Проекты / ЖК / Объекты / Квартиры». Глубина — одна ссылка от главной: обхода сайта нет. Меню остаётся в
// тексте главной намеренно — список ЖК застройщика часто только в нём.

import * as cheerio from 'cheerio';

import { hostMatchesPolicy, type ISourceNetworkPolicy } from '../../net/safeFetch.js';

/** Сильные слова пути и подписи ссылки — страницы проектов и каталога. */
const STRONG = /(жк|жилые?\s+комплекс|проект|объект|новостро|квартир|комплекс|недвижимост|projects?|objects?|residential|realty|catalog|kvartir|zhk)/iu;

/** Что не страница: документы, картинки, архивы. */
const FILE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|jpe?g|png|gif|webp|svg|mp4|mov|avi)$/i;

/** Не про проекты, даже если слово совпало: вакансии, новости СМИ о компании, вход. */
const NOISE = /(vacanc|вакан|career|карьер|login|вход|auth|cart|корзин|privacy|политик|cookie)/iu;

export interface IScoredLink {
  url: string;
  label: string;
  score: number;
}

const decodePath = (url: URL): string => {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
};

/** Ссылки главной на тот же сайт, по убыванию балла; без балла — не берутся. */
export const projectLinks = (html: string, baseUrl: string, policy: ISourceNetworkPolicy, limit: number): IScoredLink[] => {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Map<string, IScoredLink>();
  let order = 0;
  const firstSeen = new Map<string, number>();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (href === '' || /^(mailto|tel|javascript):/i.test(href)) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !hostMatchesPolicy(url.hostname, policy)) return;
    url.hash = '';
    const path = decodePath(url);
    // Главная и сама стартовая страница уже прочитаны.
    if (FILE.test(path) || (path === '/' && url.search === '') || (path === decodePath(base) && url.search === base.search)) return;
    const label = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (NOISE.test(path) || NOISE.test(label)) return;
    const score = (STRONG.test(path) ? 2 : 0) + (STRONG.test(label) ? 2 : 0) - (url.search !== '' ? 1 : 0) - Math.max(0, path.split('/').filter(Boolean).length - 2);
    if (score <= 0) return;
    const key = url.toString();
    const known = seen.get(key);
    if (!known || known.score < score) seen.set(key, { url: key, label: known && known.label.length >= label.length ? known.label : label, score });
    if (!firstSeen.has(key)) firstSeen.set(key, order++);
  });
  return [...seen.values()]
    .sort((a, b) => b.score - a.score || (firstSeen.get(a.url) ?? 0) - (firstSeen.get(b.url) ?? 0))
    .slice(0, Math.max(0, limit));
};
