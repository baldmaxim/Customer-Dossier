// Перечитывание истории канала после правки разборщика (06.10.2026, tg_web@3). Ответы на сообщения сохранялись
// цитатой того, на что отвечали, вместо собственного текста; перепроверка обходчика видит только первую страницу.
//
// Обход назад страницами before=<id> — тот же транспорт, темп запросов и допуск, что у обходчика. Записываются только
// посты, которые портал уже знает (история не расширяется): исправленный текст — новая редакция (decideRevision), и она
// уходит на разбор обычным потоком; тот же текст — только наблюдение. Курсор обходчика не трогается. Остановка на
// отказе допуска, 429, смене вёрстки или канала — с номером, откуда продолжить (--from).

import { env } from '../../config/env.js';
import { getPool, withTransaction } from '../../db/pool.js';
import type { ISource } from '../sources.js';
import { storeDocument } from '../store.js';
import { TelegramFetchError, fetchChannelPage, looksLikeLayoutChange, parseChannelPage, type ITelegramPost } from '../telegramWeb.js';
import { collectAllowed, telegramProfileSchema, toDocument } from './webCrawler.js';

export interface IRereadReport {
  channel: string;
  pages: number;
  /** Известных порталу постов на прочитанных страницах. */
  seen: number;
  /** Текст разошёлся с текущей редакцией: с записью — новая редакция. */
  changed: number;
  unchanged: number;
  /** Поста нет в базе — не записывается. */
  unknown: number;
  /** Откуда продолжить (--from); null — дошли до самого старого собранного поста. */
  nextBefore: number | null;
  stoppedBy: 'done' | 'max_pages' | 'policy' | 'fetch_error' | 'layout' | 'identity';
  error: string | null;
  samples: Array<{ postId: number; before: number; after: number }>;
}

export interface IRereadOptions {
  dryRun: boolean;
  maxPages: number;
  /** Начать со страницы before=<id> (продолжение прерванного прохода); без него — с первой страницы. */
  from?: number | null;
  /** Подмена транспорта в тестах. */
  fetchPage?: (channel: string, before: number | undefined) => Promise<{ html: string }>;
  delayMs?: number;
}

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/** Текущий текст известных постов канала: ключ публикации → текст последней редакции. */
const loadKnown = async (sourceId: number): Promise<Map<string, string>> => {
  const rows = (
    await getPool().query<{ item_key: string; body: string }>(
      `SELECT si.item_key, r.body FROM source_items si JOIN document_revisions r ON r.id = si.latest_revision_id
       WHERE si.source_id = $1 AND si.item_key LIKE 'ext:%'`,
      [sourceId],
    )
  ).rows;
  return new Map(rows.map(r => [r.item_key, r.body]));
};

const postIdOfKey = (key: string): number => Number(key.split('/').pop());

export const rereadTelegramHistory = async (source: ISource, options: IRereadOptions): Promise<IRereadReport> => {
  const report: IRereadReport = {
    channel: source.key,
    pages: 0,
    seen: 0,
    changed: 0,
    unchanged: 0,
    unknown: 0,
    nextBefore: options.from ?? null,
    stoppedBy: 'done',
    error: null,
    samples: [],
  };
  const denied = await collectAllowed(null, source.id);
  if (denied) return { ...report, stoppedBy: 'policy', error: denied };

  const profile = telegramProfileSchema.safeParse(source.config ?? {});
  const delayMs = options.delayMs ?? (profile.success ? profile.data.delayMs : undefined) ?? env.TG_FETCH_DELAY_MS;
  const fetchPage = options.fetchPage ?? ((channel: string, before: number | undefined) => fetchChannelPage(channel, before === undefined ? {} : { before }));
  const known = await loadKnown(source.id);
  const oldestKnown = Math.min(...[...known.keys()].map(postIdOfKey).filter(Number.isFinite));
  if (!Number.isFinite(oldestKnown)) return { ...report, nextBefore: null };

  let before: number | undefined = options.from ?? undefined;
  while (report.pages < options.maxPages) {
    if (report.pages > 0) await sleep(delayMs);
    let html: string;
    try {
      ({ html } = await fetchPage(source.key, before));
    } catch (err) {
      report.stoppedBy = 'fetch_error';
      report.error = err instanceof TelegramFetchError ? `${err.kind}: ${err.message}` : err instanceof Error ? err.message : String(err);
      return report;
    }
    report.pages += 1;
    const parsed = parseChannelPage(html, source.key);
    if (looksLikeLayoutChange(parsed)) return { ...report, stoppedBy: 'layout', error: 'страница большая, но постов нет — вёрстка t.me/s/ изменилась' };
    if (parsed.posts.some(p => p.channel.toLowerCase() !== source.key.toLowerCase())) {
      return { ...report, stoppedBy: 'identity', error: 'посты страницы принадлежат другому каналу' };
    }
    if (parsed.posts.length === 0) return { ...report, nextBefore: null };

    const mine: ITelegramPost[] = [];
    for (const post of parsed.posts) {
      const current = known.get(`ext:${post.externalId}`);
      if (current === undefined) {
        report.unknown += 1;
        continue;
      }
      report.seen += 1;
      if (current === post.body) {
        report.unchanged += 1;
        continue;
      }
      mine.push(post);
      if (report.samples.length < 10) report.samples.push({ postId: post.postId, before: current.length, after: post.body.length });
    }

    if (!options.dryRun && mine.length > 0) {
      const fetchedAt = new Date();
      const stop = await withTransaction(async client => {
        await client.query('SELECT id FROM sources WHERE id = $1 FOR UPDATE', [source.id]);
        const revoked = await collectAllowed(client, source.id);
        if (revoked) return revoked;
        for (const post of mine) {
          const result = await storeDocument(toDocument(source, post, null, fetchedAt), client);
          if (result.outcome === 'new_revision') report.changed += 1;
          else report.unchanged += 1;
        }
        return null;
      });
      if (stop) return { ...report, stoppedBy: 'policy', error: stop };
    } else {
      report.changed += mine.length;
    }

    const oldest = parsed.posts.reduce((m, p) => Math.min(m, p.postId), Number.POSITIVE_INFINITY);
    if (oldest <= oldestKnown) return { ...report, nextBefore: null };
    before = oldest;
    report.nextBefore = oldest;
  }
  report.stoppedBy = 'max_pages';
  return report;
};
