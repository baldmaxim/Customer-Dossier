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
import { storeDocuments, emptyBatchStats, type IIncomingDocument, type IBatchStats } from './store.js';
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

/** Один проход по всем просроченным источникам. Вызывается шедулером и CLI. */
export const runIngestPass = async (limit = 20): Promise<IIngestReport[]> => {
  const sources = await getDueSources(limit);
  const reports: IIngestReport[] = [];

  for (const [index, source] of sources.entries()) {
    if (source.kind === 'telegram') {
      reports.push(await ingestTelegramSource(source));
    } else {
      // Сайты — отдельный парсер, вне M1. Источник не трогаем, чтобы он не
      // копил fail_streak и не ушёл в broken из-за нереализованной ветки.
      console.log(`[ingest] пропуск ${source.kind}:${source.key} — парсер сайтов ещё не готов`);
      continue;
    }
    // Пауза только между запросами, после последнего не нужна.
    if (index < sources.length - 1) await sleep(env.TG_FETCH_DELAY_MS);
  }

  return reports;
};
