// Картинки страницы сайта компании (08.10.2026): что может быть фото проекта. Чтение сайта запоминает их вместе
// с текстом, а чьё это фото, решает проход фото (companySites/photos.ts) — когда модель уже назвала проекты.
//
// Берётся og:image страницы и картинки с подписью рядом: карточка проекта в каталоге — это фото и название в одном
// небольшом блоке. Подпись — текст ближайшего предка картинки, если в нём одна картинка и текст не длиннее
// CAPTION_MAX: блок шире — уже список карточек или раздел страницы, и название соседней карточки попало бы в подпись
// чужого фото. Только тот же сайт и его поддомены
// (политика чтения сайта); логотипы, значки и SVG — не фото.

import * as cheerio from 'cheerio';

import { hostMatchesPolicy, type ISourceNetworkPolicy } from '../../net/safeFetch.js';

export interface IImageCandidate {
  url: string;
  /** alt или title картинки. */
  alt: string;
  /** Текст небольшого блока вокруг картинки; пусто — блока нет или он слишком велик. */
  caption: string;
}

export interface IPageImages {
  url: string;
  /** Главная сайта: её og:image — картинка всего сайта, а не проекта. */
  home: boolean;
  og: string | null;
  images: IImageCandidate[];
}

/** Картинок со страницы: каталог ЖК — десятки карточек, дальше обычно подвал и баннеры. */
export const PAGE_IMAGES_MAX = 80;
/** Подпись длиннее — уже раздел страницы, а не карточка. */
export const CAPTION_MAX = 300;
/** Сколько предков картинки смотреть в поисках подписи. */
const CAPTION_DEPTH = 5;

/** Не фото проекта: логотипы, значки, заглушки ленивой загрузки, кнопки соцсетей. */
const NOT_PHOTO = /(logo|лого|icon|favicon|sprite|placeholder|blank|pixel|spacer|loader|spinner|avatar|flag|arrow|social|captcha)/i;
const NOT_PHOTO_EXT = /\.(svg|gif|ico)$/i;
/** Атрибуты ленивой загрузки — раньше src: в src у них часто заглушка. */
const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'] as const;
const BG_ATTRS = ['data-bg', 'data-background', 'data-background-image'] as const;

const OG_SELECTORS = [
  'meta[property="og:image"]',
  'meta[property="og:image:url"]',
  'meta[property="og:image:secure_url"]',
  'meta[name="og:image"]',
  'meta[name="twitter:image"]',
] as const;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const decodePath = (url: URL): string => {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
};

/** Адрес картинки того же сайта или null: data:, чужой хост, не http(s), значок по имени файла. */
export const resolveImageUrl = (raw: string | undefined, baseUrl: string, policy: ISourceNetworkPolicy): string | null => {
  const value = (raw ?? '').trim();
  if (value === '' || /^data:/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !hostMatchesPolicy(url.hostname, policy)) return null;
  url.hash = '';
  const path = decodePath(url);
  if (NOT_PHOTO_EXT.test(path) || NOT_PHOTO.test(path)) return null;
  return url.toString();
};

/** Ширина варианта, больше которой из srcset не берём: копия всё равно до 1280 px, а файл крупнее — лишний трафик. */
const SRCSET_CAP = 1600;

/**
 * Вариант из srcset: самый крупный не шире SRCSET_CAP («2x» считается 1600), иначе самый мелкий; без пометок —
 * первый.
 */
export const pickFromSrcset = (srcset: string | undefined): string | undefined => {
  if (!srcset) return undefined;
  const entries = srcset
    .split(',')
    .map(part => part.trim().split(/\s+/))
    .filter((parts): parts is [string, ...string[]] => Boolean(parts[0]))
    .map(([url, descriptor]) => {
      const n = descriptor ? parseFloat(descriptor) : NaN;
      return { url, size: Number.isFinite(n) ? (descriptor?.endsWith('x') ? n * 800 : n) : 0 };
    });
  if (entries.length === 0) return undefined;
  if (entries.every(e => e.size === 0)) return entries[0]!.url;
  const within = entries.filter(e => e.size <= SRCSET_CAP);
  const pick = within.length > 0 ? within.reduce((a, b) => (b.size > a.size ? b : a)) : entries.reduce((a, b) => (b.size < a.size ? b : a));
  return pick.url;
};

const backgroundUrl = (style: string | undefined): string | undefined => style?.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2];

const tooSmall = (width: string | undefined, height: string | undefined): boolean => {
  const w = Number(width);
  const h = Number(height);
  return (Number.isFinite(w) && w > 0 && w < 120) || (Number.isFinite(h) && h > 0 && h < 80);
};

/** Пробел перед каждым тегом не склеивает «ЖК Остров» с «Москва» соседнего блока (как pageText). */
const loadPage = (html: string): cheerio.CheerioAPI => cheerio.load(html.replace(/</g, ' <'));

/** Подпись — первый непустой текст по цепочке блоков; блок длиннее CAPTION_MAX или с чужой картинкой (null) — подписи нет. */
export const captionOf = (texts: ReadonlyArray<string | null>): string => {
  for (const text of texts) {
    if (text === null || text.length > CAPTION_MAX) return '';
    if (text.length > 0) return text;
  }
  return '';
};

export const pageImages = (html: string, pageUrl: string, policy: ISourceNetworkPolicy, home: boolean): IPageImages => {
  const $ = loadPage(html);

  let og: string | null = null;
  for (const selector of OG_SELECTORS) {
    og = resolveImageUrl($(selector).first().attr('content'), pageUrl, policy);
    if (og) break;
  }
  og ??= resolveImageUrl($('link[rel="image_src"]').first().attr('href'), pageUrl, policy);

  $('script, style, noscript, template, svg').remove();
  const images: IImageCandidate[] = [];
  const seen = new Set<string>();
  const add = (url: string | null, alt: string, text: string): void => {
    if (!url || seen.has(url) || images.length >= PAGE_IMAGES_MAX) return;
    seen.add(url);
    images.push({ url, alt: collapse(alt).slice(0, CAPTION_MAX), caption: text });
  };

  const pictures = `img, [style*="url("], ${BG_ATTRS.map(a => `[${a}]`).join(', ')}`;
  $(pictures).each((_, el) => {
    if (images.length >= PAGE_IMAGES_MAX) return false;
    const $el = $(el);
    // Блоки вокруг картинки, от ближнего: у фона блока первым идёт сам блок (название поверх фото).
    const caption = (own: boolean): string => {
      const texts: Array<string | null> = [];
      for (const node of [...(own ? [el] : []), ...$el.parents().toArray()].slice(0, CAPTION_DEPTH)) {
        const $node = $(node);
        if ($node.is('body, html, main')) break;
        const count = $node.find(pictures).length + ($node.is(pictures) ? 1 : 0);
        texts.push(count > 1 ? null : collapse($node.text()));
      }
      return captionOf(texts);
    };
    if ($el.is('img')) {
      if (tooSmall($el.attr('width'), $el.attr('height'))) return undefined;
      const raw =
        LAZY_ATTRS.map(a => $el.attr(a)).find(v => v && v.trim() !== '') ??
        pickFromSrcset($el.attr('data-srcset') ?? $el.attr('srcset')) ??
        $el.attr('src') ??
        pickFromSrcset($el.closest('picture').find('source[srcset]').first().attr('srcset'));
      add(resolveImageUrl(raw, pageUrl, policy), $el.attr('alt') ?? $el.attr('title') ?? '', caption(false));
      return undefined;
    }
    const raw = BG_ATTRS.map(a => $el.attr(a)).find(v => v && v.trim() !== '') ?? backgroundUrl($el.attr('style'));
    add(resolveImageUrl(raw, pageUrl, policy), $el.attr('title') ?? '', caption(true));
    return undefined;
  });

  return { url: pageUrl, home, og, images };
};
