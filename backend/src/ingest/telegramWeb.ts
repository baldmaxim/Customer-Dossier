// Чтение публичной веб-версии Telegram-канала: https://t.me/s/<канал>
//
// Почему так, а не через API: MTProto (api_id/api_hash) пользователю недоступен,
// а Bot API требует прав администратора в канале. Страница t.me/s/ отдаётся
// обычным GET без авторизации — это единственный путь к чужим публичным каналам.
//
// Ограничения, о которых надо помнить: только публичные каналы, нет комментариев,
// нет реакций. Закрытые каналы — через форвард-бота.

import * as cheerio from 'cheerio';

import { env } from '../config/env.js';

/** Селекторы вынесены наружу: при смене вёрстки правится одно место. */
export const TG_SELECTORS = {
  wrap: '.tgme_widget_message_wrap',
  message: '.tgme_widget_message',
  text: '.tgme_widget_message_text',
  date: '.tgme_widget_message_date time',
  forwarded: '.tgme_widget_message_forwarded_from a',
  views: '.tgme_widget_message_views',
} as const;

export interface ITelegramPost {
  /** 'channel/1234' — то же значение, что в data-post. */
  externalId: string;
  /** Номер сообщения внутри канала: курсор пагинации. */
  postId: number;
  url: string;
  body: string;
  publishedAt: Date | null;
  /** Канал-первоисточник, если это репост. */
  forwardFrom: string | null;
}

export interface IParsedChannelPage {
  posts: ITelegramPost[];
  /**
   * Сколько узлов нашёл каждый селектор. Пишется в source_runs.layout_stats.
   * Единственный способ отличить «канал молчал» от «вёрстка изменилась»:
   * в обоих случаях posts пуст, но во втором wrap > 0 либо html велик, а wrap = 0.
   */
  layoutStats: Record<string, number>;
  /** Длина исходного HTML — второй сигнал для детектора слома вёрстки. */
  htmlLength: number;
}

/**
 * Текст поста с сохранением переводов строк: <br> и </div> в разметке Telegram
 * несут смысл (абзацы, списки), а cheerio .text() склеил бы всё в одну строку.
 */
const extractText = (innerHtml: string | null): string => {
  if (!innerHtml) return '';
  const withBreaks = innerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n');
  return cheerio
    .load(`<div>${withBreaks}</div>`)('div')
    .first()
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const parsePostId = (dataPost: string): number => {
  const raw = dataPost.split('/')[1] ?? '';
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Разбор HTML страницы канала. Чистая функция — тестируется на фикстуре,
 * без сети.
 */
export const parseChannelPage = (html: string, channel: string): IParsedChannelPage => {
  const $ = cheerio.load(html);

  const layoutStats: Record<string, number> = {};
  for (const [name, selector] of Object.entries(TG_SELECTORS)) {
    layoutStats[name] = $(selector).length;
  }

  const posts: ITelegramPost[] = [];

  $(TG_SELECTORS.wrap).each((_, wrapEl) => {
    const wrap = $(wrapEl);
    // data-post лежит на внутреннем .tgme_widget_message; fallback на сам wrap —
    // на случай, если Telegram схлопнет обёртку.
    const inner = wrap.find(TG_SELECTORS.message).first();
    const dataPost = inner.attr('data-post') ?? wrap.attr('data-post') ?? '';
    if (!dataPost) return;

    const body = extractText(wrap.find(TG_SELECTORS.text).first().html());
    // Пост без текста — фото/видео/стикер. Извлекать нечего.
    if (body.length === 0) return;

    const datetime = wrap.find(TG_SELECTORS.date).attr('datetime');
    const parsedDate = datetime ? new Date(datetime) : null;

    const forwardHref = wrap.find(TG_SELECTORS.forwarded).attr('href') ?? null;
    // href вида https://t.me/original_channel/567 -> original_channel
    const forwardFrom = forwardHref
      ? (forwardHref.replace(/^https?:\/\/t\.me\//, '').split('/')[0] ?? null)
      : null;

    posts.push({
      externalId: dataPost,
      postId: parsePostId(dataPost),
      url: `https://t.me/${dataPost}`,
      body,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
      forwardFrom,
    });
  });

  // Telegram отдаёт от старых к новым; нам удобнее от новых.
  posts.sort((a, b) => b.postId - a.postId);

  return { posts, layoutStats, htmlLength: html.length };
};

export class TelegramFetchError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly kind: 'not_found' | 'private' | 'rate_limited' | 'network',
  ) {
    super(message);
    this.name = 'TelegramFetchError';
  }
}

export interface IFetchOptions {
  /** Загрузить сообщения СТАРШЕ указанного id (пагинация в прошлое). */
  before?: number;
  signal?: AbortSignal;
}

/**
 * Скачивание страницы канала. Троттлинг вызывающая сторона обеспечивает сама
 * (scheduler): здесь только один запрос.
 */
export const fetchChannelPage = async (
  channel: string,
  options: IFetchOptions = {},
): Promise<{ html: string; httpStatus: number }> => {
  const url = new URL(`https://t.me/s/${encodeURIComponent(channel)}`);
  if (options.before !== undefined) {
    url.searchParams.set('before', String(options.before));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': env.INGEST_USER_AGENT,
        'Accept-Language': 'ru,en;q=0.8',
      },
      signal: options.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TelegramFetchError(`Сеть недоступна: ${message}`, null, 'network');
  }

  if (response.status === 404) {
    throw new TelegramFetchError(`Канал ${channel} не найден`, 404, 'not_found');
  }
  if (response.status === 429) {
    throw new TelegramFetchError('Telegram ограничил частоту запросов', 429, 'rate_limited');
  }
  if (!response.ok) {
    throw new TelegramFetchError(`HTTP ${response.status}`, response.status, 'network');
  }

  const html = await response.text();

  // Закрытый канал отдаёт 200 со страницей-заглушкой «Please open in Telegram».
  // Отличать от пустого канала обязательно: иначе источник вечно висит активным
  // и каждые 15 минут впустую дёргает Telegram.
  if (isPrivateChannelStub(html)) {
    throw new TelegramFetchError(
      `Канал ${channel} закрытый — публичная веб-версия недоступна. Используйте форвард-бота.`,
      response.status,
      'private',
    );
  }

  return { html, httpStatus: response.status };
};

/** Заглушка закрытого/несуществующего канала. */
export const isPrivateChannelStub = (html: string): boolean => {
  if (html.includes('tgme_widget_message_wrap')) return false;
  return (
    html.includes('tgme_page_context_link') ||
    /Please open this link|Preview channel|If you have Telegram, you can/i.test(html)
  );
};

/**
 * Детектор слома вёрстки. Ситуация «200 OK, большой HTML, ноль постов» означает
 * не тишину в канале, а что селекторы перестали совпадать. Без этой проверки
 * парсер молча возвращает ноль, и портал просто перестаёт наполняться —
 * самый частый способ потерять неделю.
 */
export const looksLikeLayoutChange = (parsed: IParsedChannelPage): boolean =>
  parsed.posts.length === 0 && parsed.htmlLength > 10_000 && (parsed.layoutStats.wrap ?? 0) === 0;
