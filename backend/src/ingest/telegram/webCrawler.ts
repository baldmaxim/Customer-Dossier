// Обход публичного канала через web-preview t.me/s/ (этап 05B).
//
// Правила:
//  - «получить → сохранить атомарно → зафиксировать курсор»: посты страницы и курсор — одна транзакция;
//  - номер последнего поста на первой странице не означает, что всё между прошлой отметкой и ним
//    сохранено: разрыв (gap) записывается и догружается ограниченным числом страниц before=<id>;
//  - при первом запуске история не собирается целиком: граница истории записывается в покрытие;
//  - пропущенный номер поста — не потеря и не удаление: считается как «необъяснённый»;
//  - правки видны только в окне перепроверки (свежие страницы), удаления не наблюдаются;
//  - канал в data-post не совпал с ключом источника — неопределённость идентичности, запись не ведётся;
//  - допуск перепроверяется перед каждой записью: отзыв во время прохода — остановка без повторов.

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { getPool, withTransaction } from '../../db/pool.js';
import { evaluateSourcePolicy, type PermissionStatus } from '../policy.js';
import type { ICrawlReport } from '../sites/crawler.js';
import type { ISource } from '../sources.js';
import { storeDocument, type IIncomingDocument, type StoreOutcome } from '../store.js';
import {
  TelegramFetchError,
  fetchChannelPage,
  looksLikeLayoutChange,
  parseChannelPage,
  type ITelegramPost,
} from '../telegramWeb.js';
import { WEB_PREVIEW_CAPABILITIES } from './capabilities.js';
import { sourceProfileMetaSchema } from '../profileMeta.js';

export const TELEGRAM_WEB_PARSER_VERSION = 'tg_web@2';

export const telegramProfileSchema = z
  .object({
    /** Страниц за проход: первая плюс догрузка разрыва. */
    maxPagesPerRun: z.number().int().min(1).max(10).default(3),
    /** Страниц при первом запуске: история глубже не собирается. */
    initialPages: z.number().int().min(1).max(5).default(1),
    /** Как часто перечитывать уже известные посты первой страницы ради правок. */
    recheckIntervalSec: z.number().int().min(0).max(86_400 * 7).default(3600),
    delayMs: z.number().int().min(0).max(60_000).optional(),
    /** Когда оператор сверил возможности транспорта с документацией и условиями. */
    capabilitiesCheckedAt: z.string().max(40).optional(),
    /** Этап 16: контракт подключения (source-profile@1). Допуск не выдаёт. */
    meta: sourceProfileMetaSchema.optional(),
  })
  .passthrough();

export type ITelegramProfile = z.infer<typeof telegramProfileSchema>;

interface ITgCursor {
  lastPostId?: number;
  gap?: { after: number; before: number } | null;
  historyBefore?: number | null;
  lastRecheckAt?: string | null;
}

const STORE_COUNT: Record<StoreOutcome, 'saved' | 'changed' | 'skipped'> = {
  inserted: 'saved',
  duplicate: 'saved',
  new_revision: 'changed',
  unchanged: 'skipped',
  stale: 'skipped',
  too_short: 'skipped',
  edited_skipped: 'skipped',
};

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/** Число номеров между соседними постами страницы, для которых поста нет (не вывод об удалении). */
const missingIds = (posts: readonly ITelegramPost[]): number => {
  const ids = posts.map(p => p.postId).sort((a, b) => a - b);
  let missing = 0;
  for (let i = 1; i < ids.length; i += 1) missing += Math.max(0, ids[i]! - ids[i - 1]! - 1);
  return missing;
};

const toDocument = (source: ISource, post: ITelegramPost, runId: number | null, fetchedAt: Date): IIncomingDocument => ({
  sourceId: source.id,
  sourceRunId: runId,
  externalId: post.externalId,
  url: post.url,
  title: null,
  body: post.body,
  publishedAt: post.publishedAt,
  publishedAtPrecision: post.publishedAt ? 'exact' : 'unparsed',
  // Происхождение пересылки — отдельно от канала публикации; скрытый источник не достраивается.
  forwardFrom: post.forward?.username ?? null,
  representation: 'telegram_web_text@1',
  completeness: post.completeness,
  completenessReason: post.completenessReason,
  attachments: post.attachments,
  sourceModifiedAt: null,
  fetchedAt,
  parserVersion: TELEGRAM_WEB_PARSER_VERSION,
  transportMeta: {
    transport: 'telegram_web_preview',
    channel: post.channel,
    postId: post.postId,
    edited: post.edited,
    editDate: null,
    mediaGroupSize: post.mediaGroupSize || null,
    forwardOrigin: post.forward,
  },
});

interface IPolicyRow {
  key: string;
  access_status: PermissionStatus;
  ai_processing_status: PermissionStatus;
  policy_expires_at: Date | null;
}

/** Актуальный допуск из базы: оператор мог отозвать его, пока проход ждал ответа. */
const collectAllowed = async (client: PoolClient | null, sourceId: number): Promise<string | null> => {
  const exec = client ?? getPool();
  const row = (
    await exec.query<IPolicyRow>('SELECT key, access_status, ai_processing_status, policy_expires_at FROM sources WHERE id = $1', [sourceId])
  ).rows[0];
  if (!row) return 'источник удалён';
  const decision = evaluateSourcePolicy(
    { key: row.key, accessStatus: row.access_status, aiProcessingStatus: row.ai_processing_status, policyExpiresAt: row.policy_expires_at },
    'collect',
  );
  return decision.allowed ? null : decision.reason;
};

class PolicyRevokedError extends Error {}

export interface ITelegramCrawlOptions {
  dryRun?: boolean;
  sourceRunId?: number | null;
  now?: Date;
}

export const crawlTelegramChannel = async (source: ISource, options: ITelegramCrawlOptions = {}): Promise<ICrawlReport> => {
  const report: ICrawlReport = {
    outcome: 'ok',
    health: 'ok',
    healthReason: null,
    httpStatus: null,
    retryAfterAt: null,
    counts: { found: 0, saved: 0, changed: 0, skipped: 0, failed: 0 },
    pagesFetched: 0,
    coverage: {},
    layoutStats: {},
    parserVersion: TELEGRAM_WEB_PARSER_VERSION,
    samples: [],
    errors: [],
  };
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();

  const parsedProfile = telegramProfileSchema.safeParse(source.config ?? {});
  if (!parsedProfile.success) {
    report.outcome = 'config_invalid';
    report.health = 'config_invalid';
    report.healthReason = `профиль канала некорректен: ${parsedProfile.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
    return report;
  }
  const profile = parsedProfile.data;
  const delayMs = profile.delayMs ?? env.TG_FETCH_DELAY_MS;
  const stored = (source.cursor.tg ?? {}) as ITgCursor;
  // Курсор этапа 01 (last_post_id) — отметка, от которой нельзя утверждать полноту раньше неё.
  const lastPostId = stored.lastPostId ?? Number(source.cursor.last_post_id ?? 0);
  const firstRun = lastPostId === 0;
  const recheckDue =
    !stored.lastRecheckAt || now.getTime() - new Date(stored.lastRecheckAt).getTime() >= profile.recheckIntervalSec * 1000;

  let cursor: ITgCursor = { lastPostId, gap: stored.gap ?? null, historyBefore: stored.historyBefore ?? null, lastRecheckAt: stored.lastRecheckAt ?? null };
  let missing = 0;
  let requests = 0;
  const pageLimit = firstRun ? Math.min(profile.initialPages, profile.maxPagesPerRun) : profile.maxPagesPerRun;

  const fetchPage = async (before?: number) => {
    if (requests > 0) await sleep(delayMs);
    requests += 1;
    return fetchChannelPage(source.key, before === undefined ? {} : { before });
  };

  /** Посты страницы, курсор и (при записи) допуск — одной транзакцией. */
  const persist = async (posts: ITelegramPost[], nextCursor: ITgCursor): Promise<void> => {
    const fetchedAt = new Date();
    const docs = posts.map(post => toDocument(source, post, options.sourceRunId ?? null, fetchedAt));
    for (const doc of docs) {
      if (report.samples.length < 5) {
        report.samples.push({ url: doc.url ?? '', title: doc.externalId ?? '', completeness: doc.completeness ?? 'unknown', reason: doc.completenessReason ?? '', preview: doc.body.slice(0, 300) });
      }
    }
    if (dryRun) {
      report.counts.saved += docs.length;
      cursor = nextCursor;
      return;
    }
    await withTransaction(async client => {
      await client.query('SELECT id FROM sources WHERE id = $1 FOR UPDATE', [source.id]);
      const denied = await collectAllowed(client, source.id);
      if (denied) throw new PolicyRevokedError(denied);
      for (const doc of docs) {
        const result = await storeDocument(doc, client);
        report.counts[STORE_COUNT[result.outcome]] += 1;
      }
      await client.query(
        `UPDATE sources SET cursor = jsonb_set(cursor, '{tg}', $2::jsonb), updated_at = now() WHERE id = $1`,
        [source.id, JSON.stringify(nextCursor)],
      );
    });
    cursor = nextCursor;
  };

  const handleFetchError = (err: unknown): void => {
    if (err instanceof TelegramFetchError) {
      report.httpStatus = err.httpStatus;
      if (err.kind === 'rate_limited') {
        report.outcome = 'rate_limited';
        report.health = 'rate_limited';
      } else if (err.kind === 'private' || err.kind === 'not_found') {
        report.outcome = err.kind;
        report.health = 'error';
      } else {
        report.outcome = report.pagesFetched > 0 ? 'partial' : 'network';
        report.health = 'error';
      }
      report.healthReason = err.message;
    } else {
      report.outcome = report.pagesFetched > 0 ? 'partial' : 'error';
      report.health = 'error';
      report.healthReason = err instanceof Error ? err.message : String(err);
    }
    report.errors.push(report.healthReason ?? '');
  };

  /** Разбор и проверки страницы: вёрстка и идентичность канала. null — проход остановлен. */
  const parsePage = (html: string): ITelegramPost[] | null => {
    const parsed = parseChannelPage(html, source.key);
    report.pagesFetched += 1;
    for (const [k, v] of Object.entries(parsed.layoutStats)) report.layoutStats[k] = (report.layoutStats[k] ?? 0) + v;
    if (looksLikeLayoutChange(parsed)) {
      report.outcome = report.pagesFetched > 1 ? 'partial' : 'parser_degraded';
      report.health = 'parser_degraded';
      report.healthReason = 'страница большая, но ни одного поста не найдено — вёрстка t.me/s/ изменилась';
      return null;
    }
    const foreign = parsed.posts.find(p => p.channel.toLowerCase() !== source.key.toLowerCase());
    if (foreign) {
      report.outcome = 'identity_changed';
      report.health = 'identity_uncertain';
      report.healthReason =
        `посты страницы принадлежат каналу «${foreign.channel}», а источник — «${source.key}»: ` +
        'канал переименован или адрес указывает на другой канал; запись остановлена до решения оператора';
      return null;
    }
    report.counts.found += parsed.posts.length;
    missing += missingIds(parsed.posts);
    return parsed.posts;
  };

  let stopReason = 'up_to_date';
  try {
    // --- Первая страница: новые посты и окно перепроверки правок ------------------------
    const first = await fetchPage();
    report.httpStatus = first.httpStatus;
    const posts = parsePage(first.html);
    if (posts === null) return finalize();

    const fresh = posts.filter(p => p.postId > lastPostId);
    const toStore = recheckDue ? posts : fresh;
    report.counts.skipped += posts.length - toStore.length;
    const maxId = posts.reduce((m, p) => Math.max(m, p.postId), lastPostId);
    const minId = posts.reduce((m, p) => Math.min(m, p.postId), Number.POSITIVE_INFINITY);

    const next: ITgCursor = { ...cursor, lastPostId: maxId, lastRecheckAt: recheckDue ? now.toISOString() : cursor.lastRecheckAt ?? null };
    if (firstRun && posts.length > 0) {
      next.historyBefore = minId;
    } else if (!firstRun && fresh.length > 0 && minId > lastPostId + 1 && posts.length > 0 && fresh.length === posts.length) {
      // Вся страница новее отметки: между отметкой и самым старым постом страницы может быть разрыв.
      const prior = cursor.gap;
      next.gap = { after: prior ? Math.min(prior.after, lastPostId) : lastPostId, before: minId };
    }
    await persist(toStore, next);

    // --- Первый запуск: ограниченная глубина истории ----------------------------------------
    if (firstRun) {
      while (report.pagesFetched < pageLimit && cursor.historyBefore) {
        const page = await fetchPage(cursor.historyBefore);
        const older = parsePage(page.html);
        if (older === null) return finalize();
        if (older.length === 0) {
          await persist([], { ...cursor, historyBefore: null });
          break;
        }
        await persist(older, { ...cursor, historyBefore: older.reduce((m, p) => Math.min(m, p.postId), Number.POSITIVE_INFINITY) });
      }
      stopReason = cursor.historyBefore ? 'history_not_collected' : 'channel_start_reached';
    }

    // --- Догрузка разрыва страницами before=<id> ------------------------------------------
    while (!firstRun && cursor.gap) {
      if (report.pagesFetched >= pageLimit) {
        stopReason = 'gap_open_max_pages';
        break;
      }
      const gap: { after: number; before: number } = cursor.gap;
      const page = await fetchPage(gap.before);
      const older = parsePage(page.html);
      if (older === null) return finalize();
      const inGap = older.filter(p => p.postId > gap.after && p.postId < gap.before);
      const oldest = older.reduce((m, p) => Math.min(m, p.postId), Number.POSITIVE_INFINITY);
      const closed = older.length === 0 || oldest <= gap.after + 1;
      await persist(inGap, { ...cursor, gap: closed ? null : { after: gap.after, before: oldest } });
      stopReason = closed ? 'gap_closed' : stopReason;
    }
  } catch (err) {
    if (err instanceof PolicyRevokedError) {
      report.outcome = 'policy_blocked';
      report.health = 'blocked';
      report.healthReason = `допуск отозван во время прохода: ${err.message}; незаписанная страница не сохранена, курсор не сдвинут`;
      stopReason = 'policy_blocked';
    } else {
      handleFetchError(err);
      stopReason = 'failed';
    }
  }
  return finalize();

  function finalize(): ICrawlReport {
    report.coverage = {
      transport: WEB_PREVIEW_CAPABILITIES.transport,
      stopReason: report.outcome === 'ok' ? stopReason : report.outcome,
      pagesFetched: report.pagesFetched,
      lastPostId: cursor.lastPostId ?? null,
      gap: cursor.gap ?? null,
      historyBefore: cursor.historyBefore ?? null,
      missingIdsUnexplained: missing,
      recheckedEdits: recheckDue,
      capabilities: {
        history: WEB_PREVIEW_CAPABILITIES.history.state,
        edits: WEB_PREVIEW_CAPABILITIES.edits.state,
        deletes: WEB_PREVIEW_CAPABILITIES.deletes.state,
      },
      capabilitiesCheckedAt: profile.capabilitiesCheckedAt ?? null,
      note:
        cursor.gap || cursor.historyBefore
          ? 'история канала собрана не полностью: см. gap и historyBefore'
          : 'новые посты с последней отметки сохранены; удаления и старые правки не наблюдаются',
    };
    if (report.outcome === 'ok' && cursor.gap) {
      report.healthReason = `разрыв постов ${cursor.gap.after + 1}…${cursor.gap.before - 1} ещё не догружен`;
    }
    return report;
  }
};
