// Оркестрация ингеста: один проход по просроченным источникам.
//
// Троттлинг здесь, а не в fetchChannelPage: пауза нужна между запросами, а не
// внутри одного. Читаем публичные страницы в человеческом темпе — 1 запрос
// в TG_FETCH_DELAY_MS на канал.

import { env } from '../config/env.js';
import { crawlTelegramChannel } from './telegram/webCrawler.js';
import { crawlSite } from './sites/crawler.js';
import { emptyBatchStats, type IBatchStats } from './store.js';
import { evaluateSourcePolicy } from './policy.js';
import {
  getDueSources,
  startRun,
  finishRun,
  finishSiteRun,
  type ISource,
} from './sources.js';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export interface IIngestReport {
  sourceKey: string;
  ok: boolean;
  stats: IBatchStats;
  error: string | null;
}

/** Отказ по допуску: без сетевого запроса и без записи запуска. */
const policyBlocked = (source: ISource): IIngestReport | null => {
  const decision = evaluateSourcePolicy(source, 'collect');
  if (decision.allowed) return null;
  return { sourceKey: source.key, ok: false, stats: emptyBatchStats(), error: decision.reason };
};

/**
 * Один проход по Telegram-каналу через web-preview (этап 05B, telegram/webCrawler.ts):
 * новые посты и окно перепроверки правок на первой странице, ограниченная догрузка разрыва
 * страницами before=<id>, курсор вместе с постами страницы. История целиком не собирается.
 */
export const ingestTelegramSource = async (source: ISource): Promise<IIngestReport> => {
  const blocked = policyBlocked(source);
  if (blocked) return blocked;

  const runId = await startRun(source.id);
  const startedAt = Date.now();
  try {
    const report = await crawlTelegramChannel(source, { sourceRunId: runId });
    await finishSiteRun(runId, source.id, report, Date.now() - startedAt);
    const stats = emptyBatchStats();
    stats.inserted = report.counts.saved;
    stats.newRevision = report.counts.changed;
    stats.unchanged = report.counts.skipped;
    const ok = report.outcome === 'ok' || report.outcome === 'not_modified';
    return { sourceKey: source.key, ok, stats, error: ok ? null : `${report.outcome}: ${report.healthReason ?? ''}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, source.id, { itemsSeen: 0, itemsNew: 0, httpStatus: null, error: message, layoutStats: {} });
    return { sourceKey: source.key, ok: false, stats: emptyBatchStats(), error: message };
  }
};

/**
 * Один проход по сайту адаптером этапа 05A (sites/crawler.ts): профиль источника,
 * RSS или HTML-список с пагинацией, статьи и карточки объектов. Курсор и записи
 * страницы сохраняются вместе; исход, счётчики и покрытие — в source_runs, здоровье — в sources.
 */
export const ingestWebsiteSource = async (source: ISource): Promise<IIngestReport> => {
  const blocked = policyBlocked(source);
  if (blocked) return blocked;

  const runId = await startRun(source.id);
  const startedAt = Date.now();
  try {
    const report = await crawlSite(source, { sourceRunId: runId });
    await finishSiteRun(runId, source.id, report, Date.now() - startedAt);
    const stats = emptyBatchStats();
    stats.inserted = report.counts.saved;
    stats.newRevision = report.counts.changed;
    stats.unchanged = report.counts.skipped;
    const ok = report.outcome === 'ok' || report.outcome === 'not_modified';
    return { sourceKey: source.key, ok, stats, error: ok ? null : `${report.outcome}: ${report.healthReason ?? ''}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, source.id, { itemsSeen: 0, itemsNew: 0, httpStatus: null, error: message, layoutStats: {} });
    return { sourceKey: source.key, ok: false, stats: emptyBatchStats(), error: message };
  }
};

/** Один проход по всем просроченным источникам. Вызывается шедулером и CLI. */
export const runIngestPass = async (limit = 20): Promise<IIngestReport[]> => {
  const sources = await getDueSources(limit);
  const reports: IIngestReport[] = [];

  for (const [index, source] of sources.entries()) {
    const blocked = policyBlocked(source);
    if (blocked) {
      // Без паузы: запроса не было, троттлить нечего.
      reports.push(blocked);
      continue;
    }
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
