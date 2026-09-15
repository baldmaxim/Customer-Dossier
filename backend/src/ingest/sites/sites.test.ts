// Этап 05A без БД и сети: профиль, даты, разбор списка/статьи/ленты/карточки, транспорт безопасного клиента.

import { describe, it, expect } from 'vitest';

import { NetworkPolicyError, safeFetch, type SafeTransport } from '../../net/safeFetch.js';
import { parseSiteDate } from './dates.js';
import { parseRetryAfter } from './fetcher.js';
import { parseArticlePage, parseFeedPage, parseListPage, parseProjectCard } from './parsers.js';
import { SiteProfileError, parseSiteProfile, policyForProfile } from './profile.js';

const listProfile = (over: Record<string, unknown> = {}) =>
  parseSiteProfile({
    mode: 'html_list',
    startUrls: ['https://news-demo.test/news'],
    list: { itemSelector: '.item', linkSelector: 'a.title', dateSelector: 'time', dateAttribute: 'datetime', teaserSelector: '.lead' },
    pagination: { nextSelector: 'a.next', maxPages: 3 },
    article: { bodySelector: '.article-body', truncatedSelector: '.paywall', removeSelectors: ['.related'] },
    canonical: { dropQueryParams: ['from'] },
    limits: { delayMs: 0 },
    ...over,
  });

describe('parseSiteProfile', () => {
  it('старый конфиг {rss, articleSelector} приводится к режиму rss', () => {
    const p = parseSiteProfile({ rss: 'https://news-demo.test/rss', articleSelector: '.text' });
    expect(p.mode).toBe('rss');
    expect(p.article?.bodySelector).toBe('.text');
    expect(p.rssContentIsFull).toBe(false);
  });

  it('listSelector без профиля не считается рабочим путём', () => {
    expect(() => parseSiteProfile({ listSelector: '.news a' })).toThrow(SiteProfileError);
  });

  it('неизвестные ключи, код в селекторе и неполный html_list отвергаются', () => {
    expect(() => parseSiteProfile({ mode: 'rss', rss: 'https://news-demo.test/rss', onFetch: 'eval(1)' })).toThrow(SiteProfileError);
    expect(() => listProfile({ list: { itemSelector: '<script>alert(1)</script>' } })).toThrow(SiteProfileError);
    expect(() => parseSiteProfile({ mode: 'html_list', startUrls: ['https://news-demo.test/'] })).toThrow(/html_list требует/);
    expect(() => parseSiteProfile({ mode: 'rss', rss: 'file:///etc/passwd' })).toThrow(SiteProfileError);
  });

  it('сетевая политика: хосты профиля и лимиты', () => {
    const policy = policyForProfile('https://www.news-demo.test', listProfile({ allowedHosts: ['cdn-demo.test'], limits: { maxBytes: 200_000, delayMs: 0 } }));
    expect([...policy.allowedHosts].sort()).toEqual(['cdn-demo.test', 'news-demo.test']);
    expect(policy.maxBytes).toBe(200_000);
  });
});

describe('parseSiteDate — правило, а не догадка', () => {
  const tz = 'Europe/Moscow';
  it('зона в строке — exact; без зоны — зона профиля; без времени — date_only', () => {
    expect(parseSiteDate('2026-09-12T10:30:00+03:00', tz)).toMatchObject({ precision: 'exact' });
    expect(parseSiteDate('12.09.2026 10:30', tz).date?.toISOString()).toBe('2026-09-12T07:30:00.000Z');
    expect(parseSiteDate('12.09.2026 10:30', tz).precision).toBe('local_tz');
    expect(parseSiteDate('12 сентября 2026', tz).precision).toBe('date_only');
  });

  it('год и относительные даты не подставляются', () => {
    expect(parseSiteDate('12 сентября', tz)).toEqual({ date: null, precision: 'no_year', raw: '12 сентября' });
    expect(parseSiteDate('вчера, 10:30', tz).date).toBeNull();
    expect(parseSiteDate('31.02.2026', tz).precision).toBe('unparsed');
  });
});

describe('разбор страниц', () => {
  it('HTML-список: записи, следующая страница, канонические адреса с учётом значимых параметров', () => {
    const html = `<div class="item"><a class="title" href="/news?id=1&utm_source=tg&from=main">Первая</a><time datetime="2026-09-12T10:00:00+03:00"></time><p class="lead">Анонс</p></div>
      <div class="item"><a class="title" href="/news?id=2">Вторая</a></div>
      <div class="item"><a class="title" href="/news?id=1">Дубль первой</a></div>
      <a class="next" href="/news?page=2">дальше</a>`;
    const page = parseListPage(html, 'https://news-demo.test/news', listProfile());
    expect(page.items.map(i => i.url)).toEqual(['https://news-demo.test/news?id=1', 'https://news-demo.test/news?id=2']);
    expect(page.items[0]).toMatchObject({ title: 'Первая', teaser: 'Анонс' });
    expect(page.items[0]!.date.precision).toBe('exact');
    expect(page.nextUrl).toBe('https://news-demo.test/news?page=2');
  });

  it('статья: полный текст по селектору, обрезанная — excerpt, вложения помечены, чужие блоки убраны', () => {
    const html = `<h1>Заголовок</h1><div class="article-body"><p>Срок сдачи не будет соблюдён.</p><table><tr><td>1</td></tr></table>
      <a href="/doc.pdf">PDF</a><div class="related">Читайте также</div></div>`;
    const full = parseArticlePage(html, listProfile());
    expect(full).toMatchObject({ completeness: 'full', completenessReason: 'article_body_selector', title: 'Заголовок' });
    expect(full.body).toContain('не будет соблюдён');
    expect(full.body).not.toContain('Читайте также');
    expect(full.attachments.map(a => a.kind).sort()).toEqual(['pdf', 'table']);
    expect(full.attachments.every(a => a.status === 'unsupported')).toBe(true);

    const cut = parseArticlePage(`${html}<div class="paywall">Полностью — по подписке</div>`, listProfile());
    expect(cut.completeness).toBe('excerpt');

    const missing = parseArticlePage('<article><p>Текст без нужного контейнера.</p></article>', listProfile());
    expect(missing).toMatchObject({ completeness: 'unknown', completenessReason: 'article_selector_missing' });
  });

  it('лента: content:encoded полным не считается без контракта профиля', () => {
    const xml = `<rss><channel><item><title>Т</title><link>https://news-demo.test/a</link><description>анонс</description>
      <content:encoded><![CDATA[<p>полный?</p>]]></content:encoded><pubDate>Sat, 12 Sep 2026 07:30:00 GMT</pubDate></item></channel></rss>`;
    const plain = parseFeedPage(xml, 'https://news-demo.test', parseSiteProfile({ mode: 'rss', rss: 'https://news-demo.test/rss' }));
    expect(plain.items[0]).toMatchObject({ feedBodyIsFull: false, teaser: 'анонс' });
    const contract = parseFeedPage(xml, 'https://news-demo.test', parseSiteProfile({ mode: 'rss', rss: 'https://news-demo.test/rss', rssContentIsFull: true }));
    expect(contract.items[0]!.feedBodyIsFull).toBe(true);
  });

  it('карточка объекта: стабильный текст полей', () => {
    const profile = listProfile({
      projectCards: {
        urls: ['https://news-demo.test/objects/1'],
        nameSelector: 'h1',
        fieldRowSelector: 'dl > div',
        fieldLabelSelector: 'dt',
        fieldValueSelector: 'dd',
      },
    });
    const card = parseProjectCard('<h1>ЖК «Демо-Роща»</h1><dl><div><dt>Застройщик:</dt><dd>Демо-Гранит</dd></div><div><dt>Статус</dt><dd>строится</dd></div></dl>', profile);
    expect(card.body).toBe('Объект: ЖК «Демо-Роща»\nЗастройщик: Демо-Гранит\nСтатус: строится');
  });
});

describe('Retry-After и тестовый транспорт безопасного клиента', () => {
  it('Retry-After в секундах и датой', () => {
    const now = new Date('2026-09-12T10:00:00Z');
    expect(parseRetryAfter('120', now)?.toISOString()).toBe('2026-09-12T10:02:00.000Z');
    expect(parseRetryAfter('Sat, 12 Sep 2026 11:00:00 GMT', now)?.toISOString()).toBe('2026-09-12T11:00:00.000Z');
    expect(parseRetryAfter('мусор', now)).toBeNull();
  });

  const policy = { allowedHosts: ['news-demo.test'], allowSubdomains: true, maxBytes: 1000, timeoutMs: 1000, maxRedirects: 3 };
  const transport: SafeTransport = async url => {
    if (url.pathname === '/out') return { status: 302, headers: { location: 'https://evil-demo.test/x' }, body: Buffer.alloc(0) };
    if (url.pathname === '/in') return { status: 301, headers: { location: '/ok' }, body: Buffer.alloc(0) };
    if (url.pathname === '/big') return { status: 200, headers: {}, body: Buffer.alloc(5000, 97) };
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('готово') };
  };

  it('редирект внутри allowlist проходит, наружу — запрет политики; размер проверяется', async () => {
    const ok = await safeFetch('https://news-demo.test/in', policy, {}, { transport });
    expect(ok).toMatchObject({ status: 200, text: 'готово', redirects: 1 });
    await expect(safeFetch('https://news-demo.test/out', policy, {}, { transport })).rejects.toMatchObject({ kind: 'host_not_allowed' });
    await expect(safeFetch('https://news-demo.test/big', policy, {}, { transport })).rejects.toBeInstanceOf(NetworkPolicyError);
    // Исходный адрес вне allowlist не доходит до транспорта вовсе.
    await expect(safeFetch('http://127.0.0.1/', { ...policy, allowedHosts: ['127.0.0.1'] }, {}, { transport })).rejects.toMatchObject({
      kind: 'blocked_address',
    });
  });
});
