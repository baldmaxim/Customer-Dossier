// CLI ингеста.
//
//   npm run ingest:once -- --add kzbuild       добавить канал (на паузе, допуск не подтверждён)
//   npm run ingest:once -- --add-site <url> [--rss <feed>]  добавить сайт без сетевых запросов
//   npm run ingest:once -- --probe kzbuild     проверить вёрстку канала (нужен допуск к сбору)
//   npm run ingest:once -- --probe-site <key>  проверить сайт, ничего не сохраняя (нужен допуск)
//   npm run ingest:once -- --source kzbuild    прогнать один источник (нужен допуск)
//   npm run ingest:once                        прогнать все просроченные источники с допуском
//   npm run ingest:once -- --remove <key>      удалить источник без документов
//   npm run ingest:once -- --stats             сводка по сырому слою
//   npm run ingest:once -- --env-check         какие ключи видит программа в .env
//   npm run ingest:once -- --bot-check         проверить форвард-бота (без чтения сообщений)
//   npm run ingest:once -- --bot-once          разобрать накопленные форварды (нужен допуск manual:bot)
//
// Любой живой запрос к источнику — в том числе --probe — это сбор. Он
// выполняется только для зарегистрированного источника с подтверждённым
// допуском (sources.access_status = approved). Допуск ставит оператор в админке.

import { closeDb } from '../db/pool.js';
import { fetchChannelPage, parseChannelPage, looksLikeLayoutChange } from './telegramWeb.js';
import { runIngestPass, ingestTelegramSource } from './scheduler.js';
import {
  addTelegramSource,
  addWebsiteSource,
  deleteSource,
  getSourceByKey,
} from './sources.js';
import { getIngestSummary, getDuplicateRate } from './store.js';
import { checkBot, pollBotUpdates } from './telegramBot.js';
import { checkEnvFile, printEnvCheck } from '../config/env-check.js';
import { discoverFeedUrl, fetchSite } from './website.js';
import { ingestWebsiteSource } from './scheduler.js';
import { evaluateSourcePolicy } from './policy.js';
import type { ISource } from './sources.js';

const argValue = (flag: string): string | null => {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
};

/** Источник по ключу с проверкой допуска к сбору; null — вывод причины и код 1. */
const loadApprovedSource = async (
  kind: 'telegram' | 'website' | null,
  key: string,
): Promise<ISource | null> => {
  const source =
    kind !== null
      ? await getSourceByKey(kind, key)
      : ((await getSourceByKey('telegram', key)) ?? (await getSourceByKey('website', key)));
  if (!source) {
    console.error(`[ingest] источник «${key}» не зарегистрирован. Добавьте его: --add / --add-site`);
    process.exitCode = 1;
    return null;
  }
  const decision = evaluateSourcePolicy(source, 'collect');
  if (!decision.allowed) {
    console.error(`[ingest] ${decision.reason}`);
    console.error('[ingest] Допуск к сбору подтверждает оператор в админке (раздел «Источники»).');
    process.exitCode = 1;
    return null;
  }
  return source;
};

const probe = async (channel: string): Promise<void> => {
  const source = await loadApprovedSource('telegram', channel);
  if (!source) return;
  console.log(`[probe] https://t.me/s/${channel}`);
  const { html, httpStatus } = await fetchChannelPage(channel);
  const parsed = parseChannelPage(html, channel);

  console.log(`[probe] HTTP ${httpStatus}, HTML ${parsed.htmlLength} байт`);
  console.log('[probe] совпадений по селекторам:');
  for (const [name, count] of Object.entries(parsed.layoutStats)) {
    const mark = count === 0 ? ' <-- НОЛЬ' : '';
    console.log(`  ${name.padEnd(10)} ${String(count).padStart(4)}${mark}`);
  }
  console.log(`[probe] разобрано постов с текстом: ${parsed.posts.length}`);

  if (looksLikeLayoutChange(parsed)) {
    console.error('[probe] ВЁРСТКА ИЗМЕНИЛАСЬ: страница большая, но ни одного поста не найдено.');
    console.error('[probe] Правьте TG_SELECTORS в src/ingest/telegramWeb.ts.');
    process.exitCode = 1;
    return;
  }

  const first = parsed.posts[0];
  if (first) {
    console.log('\n[probe] самый свежий пост:');
    console.log(`  id:    ${first.externalId}`);
    console.log(`  дата:  ${first.publishedAt?.toISOString() ?? 'не разобрана'}`);
    console.log(`  форв.: ${first.forwardFrom ?? '—'}`);
    console.log(`  текст: ${first.body.slice(0, 300)}${first.body.length > 300 ? '…' : ''}`);
  }
};

const printReports = (reports: Awaited<ReturnType<typeof runIngestPass>>): void => {
  if (reports.length === 0) {
    console.log('[ingest] просроченных источников нет');
    return;
  }
  for (const r of reports) {
    const s = r.stats;
    const line =
      `новых ${s.inserted}, дублей ${s.duplicate}, ` +
      `коротких ${s.tooShort}, правок ${s.editedSkipped}`;
    if (r.ok) console.log(`[ingest] ok   ${r.sourceKey}: ${line}`);
    else console.error(`[ingest] FAIL ${r.sourceKey}: ${r.error}`);
  }
};

const main = async (): Promise<void> => {
  const probeChannel = argValue('--probe');
  if (probeChannel) {
    await probe(probeChannel);
    return;
  }

  const addChannel = argValue('--add');
  if (addChannel) {
    const source = await addTelegramSource(addChannel);
    console.log(`[ingest] добавлен канал ${source.key} (id ${source.id}), статус ${source.status}`);
    return;
  }

  const siteUrl = argValue('--add-site');
  if (siteUrl) {
    // Регистрация без сетевых запросов: искать ленту — уже сбор, а допуска
    // у нового источника ещё нет. Лента найдётся при первом разрешённом проходе.
    const url = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`);
    const key = url.hostname.replace(/^www\./, '');
    const rss = argValue('--rss');
    const source = await addWebsiteSource(key, argValue('--title') ?? key, url.origin, rss ? { rss } : {});
    console.log(
      `[site] добавлен ${source.key} (id ${source.id}), статус ${source.status}, ` +
        `допуск к сбору: ${source.accessStatus}`,
    );
    return;
  }

  const probeSite = argValue('--probe-site');
  if (probeSite) {
    const source = await loadApprovedSource('website', probeSite.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));
    if (!source) return;
    const origin = source.baseUrl ?? `https://${source.key}`;
    const rss = argValue('--rss') ?? (typeof source.config.rss === 'string' ? source.config.rss : null);
    const feed = rss ?? (await discoverFeedUrl(origin));
    if (!feed) {
      console.error('[probe-site] RSS-лента не найдена. Укажите её через --rss.');
      process.exitCode = 1;
      return;
    }
    console.log(`[probe-site] лента: ${feed}`);
    const result = await fetchSite(origin, { rss: feed }, new Set(), 2);
    console.log(`[probe-site] записей в ленте: ${result.layoutStats.parsed ?? 0}`);
    console.log(`[probe-site] дозагружено полных текстов: ${result.layoutStats.enriched ?? 0}`);
    const first = result.articles[0];
    if (first) {
      console.log('\n[probe-site] свежая статья:');
      console.log(`  ${first.title}`);
      console.log(`  ${first.url}`);
      console.log(`  дата:  ${first.publishedAt?.toISOString() ?? 'не разобрана'}`);
      console.log(`  текст: ${first.body.slice(0, 400)}${first.body.length > 400 ? '…' : ''}`);
      if (first.body.length < 200) {
        console.warn('\n[probe-site] текст короткий — вероятно, только анонс.');
        console.warn('[probe-site] Задайте articleSelector в настройках источника.');
      }
    } else {
      console.warn('[probe-site] лента пуста или все записи уже известны.');
    }
    return;
  }

  const removeKey = argValue('--remove');
  if (removeKey) {
    const withDocuments = process.argv.includes('--with-documents');
    const source =
      (await getSourceByKey('telegram', removeKey)) ?? (await getSourceByKey('website', removeKey));
    if (!source) {
      console.error(`[ingest] источник «${removeKey}» не найден`);
      process.exitCode = 1;
      return;
    }
    const result = await deleteSource(source.id, withDocuments);
    if (result.deleted) {
      console.log(
        `[ingest] удалён ${source.kind}:${source.key}` +
          (withDocuments && result.documentCount > 0
            ? ` вместе с ${result.documentCount} документами`
            : ''),
      );
    } else {
      console.error(`[ingest] не удалён: ${result.reason}`);
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--env-check')) {
    const check = checkEnvFile();
    printEnvCheck(check);
    if (check.problems.length > 0) process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--bot-check')) {
    const result = await checkBot();
    if (result.username) console.log(`[bot] бот: @${result.username}`);
    console.log(`[bot] отправителей в белом списке: ${result.allowedCount}`);
    if (result.pendingUpdates !== null) {
      console.log(`[bot] сообщений ждёт разбора: ${result.pendingUpdates}`);
    }
    for (const problem of result.problems) console.error(`[bot] ${problem}`);
    if (result.ok) {
      console.log('\n[bot] всё готово. Перешлите боту любой пост — он ответит «Принято».');
      console.log(
        '[bot] приём работает при BOT_ENABLED=true в npm run dev и подтверждённом допуске источника manual:bot.',
      );
    } else {
      process.exitCode = 1;
    }
    return;
  }

  if (process.argv.includes('--bot-once')) {
    const result = await pollBotUpdates(0);
    console.log(
      `[bot] обновлений ${result.processed}, принято ${result.accepted}, ` +
        `отклонено ${result.rejected}`,
    );
    return;
  }

  if (process.argv.includes('--stats')) {
    const summary = await getIngestSummary();
    const rate = await getDuplicateRate(1);
    console.log(`[ingest] документов: ${summary.documents}`);
    console.log(`[ingest] в очереди:  ${summary.pending}`);
    console.log(`[ingest] дублей (наблюдений сверх документов): ${summary.duplicateSightings}`);
    console.log(`[ingest] доля дублей за сутки: ${(rate * 100).toFixed(1)} % (цель M1 < 2 %)`);
    return;
  }

  const sourceKey = argValue('--source');
  if (sourceKey) {
    const source = await loadApprovedSource(null, sourceKey);
    if (!source) return;
    printReports([
      source.kind === 'website'
        ? await ingestWebsiteSource(source)
        : await ingestTelegramSource(source),
    ]);
    return;
  }

  printReports(await runIngestPass());
};

main()
  .then(() => closeDb())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async err => {
    console.error('[ingest] прервано:', err instanceof Error ? err.message : String(err));
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
