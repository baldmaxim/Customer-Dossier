// Проба сайта-источника (этап 05A): уже допущенный источник, одна страница, до трёх записей,
// без записи в базу, без условных заголовков, без включения опроса и без изменения допуска.

import { crawlSource } from '../crawl.js';
import type { ISource } from '../sources.js';
import type { ICrawlReport } from './crawler.js';

export const PROBE_LIMITS = { maxPages: 1, maxItems: 3 } as const;

export const probeWebsiteSource = async (source: ISource): Promise<ICrawlReport> =>
  crawlSource(source, { dryRun: true, ...PROBE_LIMITS });

export const printProbe = (report: ICrawlReport): void => {
  console.log(`[probe-site] исход: ${report.outcome}, здоровье: ${report.health}${report.healthReason ? ` — ${report.healthReason}` : ''}`);
  console.log(`[probe-site] HTTP ${report.httpStatus ?? '—'}, страниц ${report.pagesFetched}, парсер ${report.parserVersion}`);
  console.log(`[probe-site] селекторы: ${JSON.stringify(report.layoutStats)}`);
  const c = report.counts;
  console.log(`[probe-site] найдено ${c.found}, было бы сохранено ${c.saved}, пропущено ${c.skipped}, ошибок ${c.failed}`);
  for (const s of report.samples) {
    console.log(`\n  ${s.title}\n  ${s.url}\n  полнота: ${s.completeness} (${s.reason})\n  ${s.preview.slice(0, 200)}${s.preview.length > 200 ? '…' : ''}`);
  }
  for (const e of report.errors) console.warn(`[probe-site] ${e}`);
  console.log(`\n[probe-site] покрытие: ${JSON.stringify(report.coverage)}`);
};
