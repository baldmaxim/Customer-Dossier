// Этап 05A на PostgreSQL: TC-042…TC-046 — адаптеры сайтов через настоящие сервисы хранения.
// Сеть подменена внедрённым транспортом (setSiteTransportForTests): проверки адресов, редиректов
// и размера остаются в safeFetch. Сайты и тексты синтетические, домены *.test.

import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import type { SafeTransport } from '../../net/safeFetch.js';
import { ingestWebsiteSource } from '../scheduler.js';
import { getSourceById, setSourceConfig } from '../sources.js';
import { setSiteTransportForTests } from './fetcher.js';
import { probeWebsiteSource } from './probe.js';

type Route = (headers: Record<string, string>) => { status: number; headers?: Record<string, string>; body?: string | Buffer };

let routes = new Map<string, Route>();
const calls: string[] = [];
const transport: SafeTransport = async (url, request) => {
  calls.push(url.toString());
  const route = routes.get(url.toString());
  if (!route) return { status: 404, headers: {}, body: Buffer.from('not found') };
  const res = route(request.headers ?? {});
  return {
    status: res.status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...(res.headers ?? {}) },
    body: Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body ?? '', 'utf8'),
  };
};
const html = (body: string): Route => () => ({ status: 200, body });

const pool = () => getPool();
let hostCounter = 0;

const site = async (profile: Record<string, unknown>, hostOverride?: string) => {
  hostCounter += 1;
  const host = hostOverride ?? `site${hostCounter}-demo.test`;
  const id = await insertSyntheticSource({ kind: 'website', key: host, access: 'approved', baseUrl: `https://${host}` });
  await setSourceConfig(id, { limits: { delayMs: 0 }, ...profile });
  return { id, host, url: (path: string) => `https://${host}${path}` };
};

const run = async (id: number) => ingestWebsiteSource((await getSourceById(id))!);

const lastRun = async (sourceId: number) =>
  (
    await pool().query<{
      outcome: string;
      items_found: number;
      items_saved: number;
      items_changed: number;
      items_skipped: number;
      items_failed: number;
      pages_fetched: number;
      coverage: Record<string, unknown>;
      parser_version: string;
    }>(
      `SELECT outcome, items_found, items_saved, items_changed, items_skipped, items_failed, pages_fetched, coverage, parser_version
       FROM source_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1`,
      [sourceId],
    )
  ).rows[0]!;

const sourceRow = async (id: number) =>
  (
    await pool().query<{ health: string; health_reason: string | null; fail_streak: number; cursor: Record<string, any>; next_in_sec: number }>(
      `SELECT health, health_reason, fail_streak, cursor, extract(epoch FROM next_run_at - now())::int AS next_in_sec FROM sources WHERE id = $1`,
      [id],
    )
  ).rows[0]!;

const revisions = async (sourceId: number) =>
  (
    await pool().query<{
      item_key: string;
      revision_no: number;
      body: string;
      completeness: string;
      completeness_reason: string | null;
      body_representation: string;
      published_at_precision: string | null;
      attachments: Array<{ kind: string }>;
    }>(
      `SELECT i.item_key, r.revision_no, r.body, r.completeness::text AS completeness, r.completeness_reason,
              r.body_representation, r.published_at_precision, r.attachments
       FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id
       WHERE i.source_id = $1 ORDER BY i.item_key, r.revision_no`,
      [sourceId],
    )
  ).rows;

const LONG = 'Подробности приводятся в тексте статьи. '.repeat(6);

beforeAll(async () => {
  await resetAndMigrate();
  setSiteTransportForTests(transport);
});

afterEach(() => {
  routes = new Map();
  calls.length = 0;
});

afterAll(async () => {
  setSiteTransportForTests(undefined);
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('RSS: анонс → полная статья (TC-042), повтор, 304, правка, недоступная статья', () => {
  it('анонс из ленты догружается статьёй с отрицанием; недоступная статья — честный анонс', async () => {
    const s = await site({ mode: 'rss', rss: 'https://feed1-demo.test/rss', allowedHosts: ['feed1-demo.test'], article: { bodySelector: '.article-body' } }, 'feed1-demo.test');
    const feed = `<rss><channel>
      <item><title>ЖК «Демо-Роща» не будет сдан в срок</title><link>${s.url('/news/1')}</link><guid>${s.url('/news/1')}</guid>
        <description>Коротко: сроки сдвинуты.</description><pubDate>Sat, 12 Sep 2026 07:30:00 GMT</pubDate></item>
      <item><title>Демо-Гранит получил разрешение</title><link>${s.url('/news/2?utm_source=rss')}</link>
        <description>Анонс второй новости про разрешение на строительство корпуса.</description></item>
    </channel></rss>`;
    routes.set(s.url('/rss'), () => ({ status: 200, headers: { etag: '"v1"', 'content-type': 'application/rss+xml' }, body: feed }));
    routes.set(s.url('/news/1'), html(`<h1>ЖК «Демо-Роща» не будет сдан в срок</h1><div class="article-body"><p>Застройщик сообщил, что дом не будет введён в эксплуатацию до конца года.</p><p>${LONG}</p></div>`));
    routes.set(s.url('/news/2'), () => ({ status: 500, body: 'ошибка' }));

    const report = await run(s.id);
    expect(report.ok).toBe(true);
    const rows = await revisions(s.id);
    expect(rows).toHaveLength(2);
    const full = rows.find(r => r.item_key.endsWith('/news/1'))!;
    expect(full).toMatchObject({ completeness: 'full', body_representation: 'site_article@1+title', published_at_precision: 'exact' });
    expect(full.body).toContain('не будет введён в эксплуатацию');
    const excerpt = rows.find(r => r.item_key.endsWith('/news/2'))!;
    expect(excerpt).toMatchObject({ completeness: 'excerpt', completeness_reason: 'article_fetch_failed:500' });
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'ok', items_found: 2, items_saved: 2, items_failed: 1, parser_version: 'site@1' });

    // Повтор той же ленты: ETag → 304, новых редакций и публикаций нет.
    const beforeItems = rows.length;
    routes.set(s.url('/rss'), headers =>
      headers['if-none-match'] === '"v1"' ? { status: 304 } : { status: 200, headers: { etag: '"v1"' }, body: feed },
    );
    await run(s.id);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'not_modified', items_saved: 0 });
    expect(await revisions(s.id)).toHaveLength(beforeItems);
  });

  it('повтор без ETag не дублирует; правка статьи при refetchKnown — новая редакция', async () => {
    const s = await site({ mode: 'rss', rss: 'https://feed2-demo.test/rss', refetchKnown: true, article: { bodySelector: '.article-body' } }, 'feed2-demo.test');
    const feed = `<rss><channel><item><title>Демо-статья</title><link>${s.url('/a')}</link><description>анонс</description></item></channel></rss>`;
    routes.set(s.url('/rss'), html(feed));
    routes.set(s.url('/a'), html(`<div class="article-body"><p>Первая версия текста статьи о стройке.</p><p>${LONG}</p></div>`));
    await run(s.id);
    await run(s.id);
    expect(await revisions(s.id)).toHaveLength(1);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'ok', items_skipped: 1, items_changed: 0 });

    routes.set(s.url('/a'), html(`<div class="article-body"><p>Исправленная версия: срок перенесён на весну.</p><p>${LONG}</p></div>`));
    await run(s.id);
    const rows = await revisions(s.id);
    expect(rows.map(r => r.revision_no)).toEqual([1, 2]);
    expect(await lastRun(s.id)).toMatchObject({ items_changed: 1 });
  });

  it('ссылка статьи с редиректом вне allowlist не открывается — анонс остаётся анонсом', async () => {
    const s = await site({ mode: 'rss', rss: 'https://feed3-demo.test/rss', article: { bodySelector: '.article-body' } }, 'feed3-demo.test');
    routes.set(s.url('/rss'), html(`<rss><channel><item><title>Редирект</title><link>${s.url('/r')}</link><description>Анонс новости с внешним редиректом.</description></item></channel></rss>`));
    routes.set(s.url('/r'), () => ({ status: 302, headers: { location: 'https://evil-demo.test/steal' } }));
    await run(s.id);
    expect(calls).not.toContain('https://evil-demo.test/steal');
    const [row] = await revisions(s.id);
    expect(row).toMatchObject({ completeness: 'excerpt', completeness_reason: 'article_fetch_failed:policy' });
  });
});

// ---------------------------------------------------------------------------

const listProfile = (host: string, over: Record<string, unknown> = {}) => ({
  mode: 'html_list',
  startUrls: [`https://${host}/news`],
  list: { itemSelector: '.item', linkSelector: 'a', dateSelector: '.date', teaserSelector: '.lead' },
  pagination: { nextSelector: 'a.next', maxPages: 5 },
  article: { bodySelector: '.article-body' },
  canonical: { dropQueryParams: ['from'] },
  ...over,
});

const listPage = (links: string[], next: string | null): string =>
  `<html><body>${links
    .map(l => `<div class="item"><a href="${l}">Новость ${l}</a><span class="date">12.09.2026 10:30</span><p class="lead">Анонс ${l}</p></div>`)
    .join('')}${next ? `<a class="next" href="${next}">дальше</a>` : ''}</body></html>`;

const articleFor = (label: string): Route => html(`<h1>Статья ${label}</h1><div class="article-body"><p>Текст статьи ${label}.</p><p>${LONG}</p></div>`);

describe('HTML-список без RSS (TC-043), сбой второй страницы и продолжение (TC-044), канонические адреса', () => {
  it('записи со всех страниц сохраняются, дата — по зоне профиля; параметр id различает статьи', async () => {
    const s = await site(listProfile('list1-demo.test'), 'list1-demo.test');
    routes.set(s.url('/news'), html(listPage(['/n?id=1&utm_source=x', '/n?id=2', '/n?id=1&from=main'], '/news?page=2')));
    routes.set(s.url('/news?page=2'), html(listPage(['/n?id=3'], null)));
    for (const id of ['1', '2', '3']) routes.set(s.url(`/n?id=${id}`), articleFor(id));

    await run(s.id);
    const rows = await revisions(s.id);
    expect(rows.map(r => r.item_key)).toEqual([
      `url:${s.url('/n?id=1')}`,
      `url:${s.url('/n?id=2')}`,
      `url:${s.url('/n?id=3')}`,
    ]);
    expect(rows.every(r => r.completeness === 'full' && r.published_at_precision === 'local_tz')).toBe(true);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'ok', pages_fetched: 2, items_saved: 3 });
    expect((await lastRun(s.id)).coverage.stopReason).toBe('exhausted');
    expect((await sourceRow(s.id)).cursor.site).toMatchObject({ backlogNext: null, caughtUp: true });
  });

  it('сбой второй страницы: первая сохранена, курсор не ушёл дальше; повтор дочитывает вторую', async () => {
    const s = await site(listProfile('list2-demo.test'), 'list2-demo.test');
    routes.set(s.url('/news'), html(listPage(['/a1', '/a2'], '/news?page=2')));
    routes.set(s.url('/news?page=2'), () => ({ status: 500, body: 'упало' }));
    for (const id of ['a1', 'a2', 'b1']) routes.set(s.url(`/${id}`), articleFor(id));

    await run(s.id);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'partial', items_saved: 2 });
    expect((await sourceRow(s.id)).cursor.site).toMatchObject({ backlogNext: s.url('/news?page=2'), caughtUp: false });
    expect((await sourceRow(s.id)).health).toBe('error');

    routes.set(s.url('/news?page=2'), html(listPage(['/b1'], null)));
    await run(s.id);
    expect((await revisions(s.id)).map(r => r.item_key.split('/').pop())).toEqual(['a1', 'a2', 'b1']);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'ok', items_saved: 1, items_skipped: 2 });
    expect((await sourceRow(s.id)).cursor.site).toMatchObject({ backlogNext: null, caughtUp: true });
  });

  it('лимит страниц виден в покрытии; следующий запуск продолжает с недочитанного хвоста', async () => {
    const s = await site(listProfile('list3-demo.test', { pagination: { nextSelector: 'a.next', maxPages: 1 } }), 'list3-demo.test');
    routes.set(s.url('/news'), html(listPage(['/p1'], '/news?page=2')));
    routes.set(s.url('/news?page=2'), html(listPage(['/p2'], null)));
    routes.set(s.url('/p1'), articleFor('p1'));
    routes.set(s.url('/p2'), articleFor('p2'));

    await run(s.id);
    expect((await lastRun(s.id)).coverage).toMatchObject({ stopReason: 'max_pages' });
    await run(s.id);
    expect((await revisions(s.id)).map(r => r.item_key.split('/').pop())).toEqual(['p1', 'p2']);
  });
});

// ---------------------------------------------------------------------------

describe('различимые исходы: смена вёрстки, 429, 403, размер, неверный профиль (TC-045, TC-046)', () => {
  it('селектор не нашёл записи на большой странице — parser_degraded, не «новостей нет»', async () => {
    const s = await site(listProfile('degraded-demo.test'), 'degraded-demo.test');
    routes.set(s.url('/news'), html(`<html><body>${'<div class="new-card"><a href="/x">Новость</a></div>'.repeat(80)}</body></html>`));
    const report = await run(s.id);
    expect(report.ok).toBe(false);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'parser_degraded', items_found: 0 });
    const row = await sourceRow(s.id);
    expect(row).toMatchObject({ health: 'parser_degraded', fail_streak: 1 });
    expect(row.health_reason).toContain('селектор списка нашёл 0');
    expect(row.cursor.site).toBeUndefined();
  });

  it('429 с Retry-After — пауза без роста счётчика неудач; 403 — отказ доступа без обхода', async () => {
    const limited = await site(listProfile('limited-demo.test'), 'limited-demo.test');
    routes.set(limited.url('/news'), () => ({ status: 429, headers: { 'retry-after': '120' }, body: 'slow down' }));
    await run(limited.id);
    expect(await lastRun(limited.id)).toMatchObject({ outcome: 'rate_limited', items_found: 0 });
    const row = await sourceRow(limited.id);
    expect(row).toMatchObject({ health: 'rate_limited', fail_streak: 0 });
    expect(row.next_in_sec).toBeGreaterThan(100);

    const forbidden = await site(listProfile('forbidden-demo.test'), 'forbidden-demo.test');
    routes.set(forbidden.url('/news'), () => ({ status: 403, body: 'captcha' }));
    await run(forbidden.id);
    expect(await lastRun(forbidden.id)).toMatchObject({ outcome: 'blocked' });
    expect(calls.filter(c => c.includes('forbidden-demo.test'))).toHaveLength(1);
  });

  it('слишком большой ответ — oversize, не пустой успех', async () => {
    const s = await site(listProfile('big-demo.test', { limits: { maxBytes: 20_000, delayMs: 0 } }), 'big-demo.test');
    routes.set(s.url('/news'), html(listPage(['/q'], null) + ' '.repeat(40_000)));
    await run(s.id);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'oversize' });
    expect((await sourceRow(s.id)).health).toBe('error');
  });

  it('некорректный профиль — config_invalid без единого запроса', async () => {
    const s = await site({ mode: 'html_list', startUrls: ['https://badcfg-demo.test/news'] }, 'badcfg-demo.test');
    await run(s.id);
    expect(await lastRun(s.id)).toMatchObject({ outcome: 'config_invalid' });
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('карточка объекта и проба', () => {
  const cardProfile = (host: string) =>
    listProfile(host, {
      projectCards: {
        urls: [`https://${host}/objects/1`],
        nameSelector: 'h1',
        fieldRowSelector: 'dl > div',
        fieldLabelSelector: 'dt',
        fieldValueSelector: 'dd',
      },
    });

  it('карточка объекта — версионируемая публикация: повтор без изменений не создаёт «новость»', async () => {
    const s = await site(cardProfile('cards-demo.test'), 'cards-demo.test');
    routes.set(s.url('/news'), html(listPage(['/c1'], null)));
    routes.set(s.url('/c1'), articleFor('c1'));
    routes.set(s.url('/objects/1'), html('<h1>ЖК «Демо-Роща»</h1><dl><div><dt>Застройщик</dt><dd>Демо-Гранит</dd></div><div><dt>Статус</dt><dd>строится</dd></div></dl>'));
    await run(s.id);
    await run(s.id);
    const cards = (await revisions(s.id)).filter(r => r.body_representation === 'project_card@1');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.body).toContain('Застройщик: Демо-Гранит');
    const observations = await pool().query<{ outcome: string; parser_version: string | null }>(
      `SELECT o.outcome, o.parser_version FROM source_observations o JOIN source_items i ON i.id = o.source_item_id
       WHERE i.source_id = $1 AND i.item_key LIKE '%/objects/1' ORDER BY o.id`,
      [s.id],
    );
    expect(observations.rows.map(r => r.outcome)).toEqual(['new_item', 'unchanged']);
    expect(observations.rows.every(r => r.parser_version === 'site@1')).toBe(true);
  });

  it('проба ничего не пишет: ни публикаций, ни курсора, ни кэша', async () => {
    const s = await site(listProfile('probe-demo.test'), 'probe-demo.test');
    routes.set(s.url('/news'), html(listPage(['/z1', '/z2', '/z3', '/z4'], '/news?page=2')));
    for (const id of ['z1', 'z2', 'z3', 'z4']) routes.set(s.url(`/${id}`), articleFor(id));
    const before = await pool().query('SELECT (SELECT count(*) FROM source_items) AS items, (SELECT count(*) FROM http_cache) AS cache, (SELECT count(*) FROM source_runs) AS runs');
    const report = await probeWebsiteSource((await getSourceById(s.id))!);
    expect(report).toMatchObject({ outcome: 'ok', pagesFetched: 1 });
    expect(report.counts.found).toBe(3);
    expect(report.samples[0]).toMatchObject({ completeness: 'full' });
    const after = await pool().query('SELECT (SELECT count(*) FROM source_items) AS items, (SELECT count(*) FROM http_cache) AS cache, (SELECT count(*) FROM source_runs) AS runs');
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((await sourceRow(s.id)).cursor).toEqual({});
  });
});
