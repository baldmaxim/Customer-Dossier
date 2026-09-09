// Оркестрация ингеста: один проход по просроченным источникам.
//
// Троттлинг здесь, а не в fetchChannelPage: пауза нужна между запросами, а не
// внутри одного. Читаем публичные страницы в человеческом темпе — 1 запрос
// в TG_FETCH_DELAY_MS на канал.

import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import {
  fetchChannelPage,
  parseChannelPage,
  looksLikeLayoutChange,
  TelegramFetchError,
} from './telegramWeb.js';
import { fetchSite, WebsiteFetchError, type IWebsiteConfig } from './website.js';
import { storeDocuments, emptyBatchStats, type IIncomingDocument, type IBatchStats } from './store.js';
import { query } from '../db/pool.js';
import {
  getDueSources,
  startRun,
  finishRun,
  updateCursor,
  markBroken,
  type ISource,
  type IRunOutcome,
} from './sources.js';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface IIngestReport {
  sourceKey: string;
  ok: boolean;
  stats: IBatchStats;
  error: string | null;
}

/**
 * Один проход по Telegram-каналу. Читает только первую страницу — это самые
 * свежие посты. Историю вглубь тянет отдельная разовая команда backfill,
 * ежеминутному опросу она не нужна.
 */
export const ingestTelegramSource = async (source: ISource): Promise<IIngestReport> => {
  const runId = await startRun(source.id);
  const lastPostId = Number(source.cursor.last_post_id ?? 0);

  let outcome: IRunOutcome = {
    itemsSeen: 0,
    itemsNew: 0,
    httpStatus: null,
    error: null,
    layoutStats: {},
  };
  let stats = emptyBatchStats();

  try {
    const { html, httpStatus } = await fetchChannelPage(source.key);
    const parsed = parseChannelPage(html, source.key);

    outcome = {
      ...outcome,
      httpStatus,
      itemsSeen: parsed.posts.length,
      layoutStats: { ...parsed.layoutStats, html_length: parsed.htmlLength },
    };

    // 200 OK, большая страница, ни одного поста — селекторы перестали совпадать.
    // Считать это «каналом без новостей» нельзя: поток тихо остановится.
    if (looksLikeLayoutChange(parsed)) {
      outcome.error = 'layout_changed';
      await finishRun(runId, source.id, outcome);
      return { sourceKey: source.key, ok: false, stats, error: 'layout_changed' };
    }

    // Уже виденные посты пропускаем по курсору; дедупликация по хэшу всё равно
    // сработает, но лишние вставки и SELECT'ы ни к чему.
    const fresh = parsed.posts.filter(p => p.postId > lastPostId);

    const docs: IIncomingDocument[] = fresh.map(post => ({
      sourceId: source.id,
      sourceRunId: runId,
      externalId: post.externalId,
      url: post.url,
      title: null,
      body: post.body,
      publishedAt: post.publishedAt,
      forwardFrom: post.forwardFrom,
    }));

    stats = await withTransaction(client => storeDocuments(docs, client));
    outcome.itemsNew = stats.inserted;

    const maxPostId = parsed.posts.reduce((max, p) => Math.max(max, p.postId), lastPostId);
    if (maxPostId > lastPostId) {
      await updateCursor(source.id, { last_post_id: maxPostId });
    }

    await finishRun(runId, source.id, outcome);
    return { sourceKey: source.key, ok: true, stats, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.error = message;
    if (err instanceof TelegramFetchError) {
      outcome.httpStatus = err.httpStatus;
      // Закрытый или несуществующий канал не починится ретраями — снимаем сразу,
      // не дожидаясь трёх неудач.
      if (err.kind === 'private' || err.kind === 'not_found') {
        await markBroken(source.id, message);
      }
    }
    await finishRun(runId, source.id, outcome);
    return { sourceKey: source.key, ok: false, stats, error: message };
  }
};

/**
 * Один проход по сайту через RSS.
 *
 * Курсор здесь — не номер, а набор уже виденных ссылок: ленты отдают записи
 * без монотонного идентификатора, и «всё, что новее последнего» не вычислить.
 * Ссылки берём из БД, а не из cursor: так работает и после ручной чистки.
 */
export const ingestWebsiteSource = async (source: ISource): Promise<IIngestReport> => {
  const runId = await startRun(source.id);

  let outcome: IRunOutcome = {
    itemsSeen: 0,
    itemsNew: 0,
    httpStatus: null,
    error: null,
    layoutStats: {},
  };
  let stats = emptyBatchStats();

  try {
    const seen = await query<{ url: string }>(
      `SELECT url FROM raw_documents
       WHERE source_id = $1 AND url IS NOT NULL
       ORDER BY fetched_at DESC LIMIT 500`,
      [source.id],
    );
    const knownUrls = new Set(seen.map(r => r.url));

    const result = await fetchSite(
      source.baseUrl ?? `https://${source.key}`,
      source.config as IWebsiteConfig,
      knownUrls,
    );

    outcome = {
      ...outcome,
      httpStatus: result.httpStatus,
      itemsSeen: result.articles.length,
      layoutStats: result.layoutStats,
    };

    const docs: IIncomingDocument[] = result.articles.map(article => ({
      sourceId: source.id,
      sourceRunId: runId,
      externalId: article.externalId,
      url: article.url,
      title: article.title,
      // Заголовок в тело: он часто несёт главный факт, а извлечение видит
      // только body.
      body: article.title ? `${article.title}\n\n${article.body}` : article.body,
      publishedAt: article.publishedAt,
      forwardFrom: null,
    }));

    stats = await withTransaction(client => storeDocuments(docs, client));
    outcome.itemsNew = stats.inserted;

    if (result.feedUrl && source.config.rss !== result.feedUrl) {
      // Найденный автоматически адрес запоминаем: второй раз искать незачем.
      await updateCursor(source.id, { feed_url: result.feedUrl });
    }

    await finishRun(runId, source.id, outcome);
    return { sourceKey: source.key, ok: true, stats, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    outcome.error = message;
    if (err instanceof WebsiteFetchError) outcome.httpStatus = err.httpStatus;
    await finishRun(runId, source.id, outcome);
    return { sourceKey: source.key, ok: false, stats, error: message };
  }
};

/** Один проход по всем просроченным источникам. Вызывается шедулером и CLI. */
export const runIngestPass = async (limit = 20): Promise<IIngestReport[]> => {
  const sources = await getDueSources(limit);
  const reports: IIngestReport[] = [];

  for (const [index, source] of sources.entries()) {
    if (source.kind === 'telegram') {
      reports.push(await ingestTelegramSource(source));
    } else if (source.kind === 'website') {
      reports.push(await ingestWebsiteSource(source));
    } else {
      continue;
    }
    // Пауза только между запросами, после последнего не нужна.
    if (index < sources.length - 1) await sleep(env.TG_FETCH_DELAY_MS);
  }

  return reports;
};
