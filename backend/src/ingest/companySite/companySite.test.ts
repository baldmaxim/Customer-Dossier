// Чтение сайта компании без сети (этап 25B): профиль строгий, robots.txt соблюдается, страницы проектов — по ссылкам
// главной с баллом, обход — на подменённом транспорте: проба ничего не пишет, сайт на одном JS — словами, сбой
// одной страницы проектов — «частично», отзыв допуска во время записи — policy_blocked.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSitePageImages } from '../../companySites/photos.js';

import type { SafeTransport } from '../../net/safeFetch.js';
import { setSiteTransportForTests } from '../sites/fetcher.js';
import type { ISource } from '../sources.js';
import { crawlCompanySite } from './crawler.js';
import { projectLinks } from './links.js';
import { companySitePolicy, isCompanySiteConfig, parseCompanySiteProfile, siteHost } from './profile.js';
import { parseRobots, robotsAllows } from './robots.js';
import { SiteCollectRevokedError, clipText, PAGE_TEXT_MAX, type ISitePage } from './store.js';

const HOME = 'https://www.demo-stroy.ru/';

const source = (config: Record<string, unknown> = { mode: 'company_site', homepage: HOME }): ISource => ({
  id: 9,
  kind: 'website',
  key: 'site:demo-stroy.ru',
  title: 'demo-stroy.ru',
  baseUrl: HOME,
  cursor: {},
  config,
  status: 'active',
  pollIntervalSec: 259200,
  failStreak: 0,
  accessStatus: 'approved',
  aiProcessingStatus: 'approved',
  policyExpiresAt: null,
  isSynthetic: false,
  historyDays: null,
});

const HOME_HTML = `<html><head><title>Демо-Строй</title></head><body>
  <nav><a href="/projects/">Проекты</a> <a href="/zhk-ostrov">ЖК «Остров»</a> <a href="/vacancies">Вакансии</a>
  <a href="/docs/price.pdf">Прайс</a> <a href="https://other.ru/zhk">ЖК партнёра</a> <a href="/about">О компании</a></nav>
  <main><h1>Строим жилые комплексы в Москве</h1><p>ЖК «Остров» — в продаже, сдача IV квартал 2027. ЖК «Символ» сдан в 2024 году.
  Квартиры бизнес-класса на западе столицы, ипотека от 6 %, отделка под ключ и подземный паркинг в каждом доме.</p></main></body></html>`;

const page = (title: string, body: string): string => `<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;

let routes = new Map<string, () => { status: number; body: string }>();

const transport: SafeTransport = async url => {
  const route = routes.get(url.toString());
  const res = route ? route() : { status: 404, body: 'not found' };
  return { status: res.status, headers: { 'content-type': 'text/html' }, body: Buffer.from(res.body, 'utf8') };
};

const ok = (body: string) => () => ({ status: 200, body });
const noPause = async (): Promise<void> => undefined;

afterEach(() => {
  setSiteTransportForTests(undefined);
  routes = new Map();
});

describe('профиль сайта компании', () => {
  it('строгий: умолчания, хост без www, пауза не меньше 4 с, лишние ключи — отказ', () => {
    const profile = parseCompanySiteProfile({ mode: 'company_site', homepage: HOME });
    expect(profile).toMatchObject({ version: 1, maxPages: 6, limits: { delayMs: 4000, timeoutMs: 20000 } });
    expect(siteHost(HOME)).toBe('demo-stroy.ru');
    expect(companySitePolicy(profile)).toMatchObject({ allowedHosts: ['demo-stroy.ru'], allowSubdomains: true });
    expect(isCompanySiteConfig({ mode: 'company_site' })).toBe(true);
    expect(isCompanySiteConfig({ mode: 'rss' })).toBe(false);
    expect(() => parseCompanySiteProfile({ mode: 'company_site', homepage: HOME, limits: { delayMs: 500 } })).toThrow(/delayMs/);
    expect(() => parseCompanySiteProfile({ mode: 'company_site', homepage: HOME, selectors: {} })).toThrow();
    expect(() => parseCompanySiteProfile({ mode: 'company_site', homepage: 'ftp://demo.ru/' })).toThrow();
  });
});

describe('robots.txt', () => {
  const text = `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nDisallow: /*.pdf$\nAllow: /private/projects\n# комментарий\nDisallow:`;

  it('группа «*», если своей нет; самый длинный префикс решает, Allow при равенстве', () => {
    const rules = parseRobots(text, 'TG_Info/1.0 (+https://pulse.meridianai.ru)');
    expect(robotsAllows(rules, '/projects/')).toBe(true);
    expect(robotsAllows(rules, '/private/docs')).toBe(false);
    expect(robotsAllows(rules, '/private/projects/ostrov')).toBe(true);
    expect(robotsAllows(rules, '/files/price.pdf')).toBe(false);
    expect(robotsAllows(rules, '/files/price.pdf?x=1')).toBe(true);
  });

  it('своя группа главнее «*»; пустого файла и пустого Disallow нет — можно всё', () => {
    const own = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: tg_info\nDisallow: /admin`, 'TG_Info/1.0');
    expect(robotsAllows(own, '/projects/')).toBe(true);
    expect(robotsAllows(own, '/admin/x')).toBe(false);
    expect(robotsAllows(parseRobots('', 'TG_Info/1.0'), '/')).toBe(true);
  });
});

describe('страницы проектов', () => {
  it('только тот же сайт, по баллу; файлы, вакансии, чужие сайты и «О компании» — нет', () => {
    const policy = companySitePolicy(parseCompanySiteProfile({ mode: 'company_site', homepage: HOME }));
    const links = projectLinks(HOME_HTML, HOME, policy, 5);
    expect(links.map(l => l.url)).toEqual(['https://www.demo-stroy.ru/projects/', 'https://www.demo-stroy.ru/zhk-ostrov']);
    expect(projectLinks(HOME_HTML, HOME, policy, 1)).toHaveLength(1);
  });

  it('текст страницы — в пределе по символам', () => {
    expect(Array.from(clipText('ж'.repeat(PAGE_TEXT_MAX + 10)))).toHaveLength(PAGE_TEXT_MAX);
  });
});

describe('обход сайта компании', () => {
  it('robots → главная → страницы проектов; снимок каждой страницы, повтор без изменений — skipped', async () => {
    setSiteTransportForTests(transport);
    routes.set('https://www.demo-stroy.ru/robots.txt', ok('User-agent: *\nDisallow: /zhk-'));
    routes.set(HOME, ok(HOME_HTML));
    routes.set('https://www.demo-stroy.ru/projects/', ok(page('Проекты', 'ЖК «Остров», ЖК «Символ», квартал «Берег» — все проекты компании.')));
    const saved: ISitePage[] = [];
    const report = await crawlCompanySite(source(), {}, async (_id, p) => {
      saved.push(p);
      return saved.length === 1 ? 'saved' : 'unchanged';
    }, noPause);
    expect(report).toMatchObject({ outcome: 'ok', health: 'ok', pagesFetched: 2, counts: { found: 2, saved: 1, skipped: 1, failed: 0 } });
    // /zhk-ostrov закрыт robots.txt — не запрашивался.
    expect(report.coverage).toMatchObject({ mode: 'company_site', robots: 'read', pages: [HOME, 'https://www.demo-stroy.ru/projects/'] });
    expect(saved[1]?.text).toContain('квартал «Берег»');
  });

  it('картинки прочитанных страниц — заметкой в каталоге фото (с флагом главной); проба её не пишет', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-pages-'));
    try {
      setSiteTransportForTests(transport);
      routes.set(HOME, ok(HOME_HTML.replace('<main>', '<main><div><img src="/upload/ostrov.jpg"><b>ЖК «Остров»</b></div>')));
      routes.set('https://www.demo-stroy.ru/projects/', ok(page('Проекты', '<meta property="og:image" content="/upload/all.jpg">Все проекты')));
      await crawlCompanySite(source(), { dryRun: true }, async () => 'saved', noPause, dir);
      expect(readSitePageImages(9, dir)).toBeNull();
      await crawlCompanySite(source(), {}, async () => 'saved', noPause, dir);
      const stored = readSitePageImages(9, dir);
      expect(stored?.pages.map(p => [p.url, p.home, p.og, p.images.map(i => [i.url, i.caption])])).toEqual([
        [HOME, true, null, [['https://www.demo-stroy.ru/upload/ostrov.jpg', 'ЖК «Остров»']]],
        ['https://www.demo-stroy.ru/projects/', false, 'https://www.demo-stroy.ru/upload/all.jpg', []],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('проба ничего не пишет; robots запрещает главную — blocked', async () => {
    setSiteTransportForTests(transport);
    routes.set(HOME, ok(HOME_HTML));
    const probe = await crawlCompanySite(source(), { dryRun: true, maxPages: 1 }, async () => {
      throw new Error('проба не пишет');
    }, noPause);
    expect(probe).toMatchObject({ outcome: 'ok', counts: { saved: 1 }, coverage: { robots: 'absent' } });
    routes.set('https://www.demo-stroy.ru/robots.txt', ok('User-agent: *\nDisallow: /'));
    const blocked = await crawlCompanySite(source(), {}, async () => 'saved', noPause);
    expect(blocked).toMatchObject({ outcome: 'blocked', health: 'blocked', healthReason: 'robots.txt сайта запрещает читать главную страницу' });
  });

  it('главная на одном JS — parser_degraded словами; 403 — blocked; сбой страницы проектов — partial', async () => {
    setSiteTransportForTests(transport);
    routes.set(HOME, ok('<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>'));
    const spa = await crawlCompanySite(source(), {}, async () => 'saved', noPause);
    expect(spa).toMatchObject({ outcome: 'parser_degraded', health: 'parser_degraded' });
    expect(spa.healthReason).toMatch(/только в браузере/);

    routes.set(HOME, () => ({ status: 403, body: 'forbidden' }));
    expect(await crawlCompanySite(source(), {}, async () => 'saved', noPause)).toMatchObject({ outcome: 'blocked', health: 'blocked', httpStatus: 403 });

    routes.set(HOME, ok(HOME_HTML));
    routes.set('https://www.demo-stroy.ru/projects/', () => ({ status: 500, body: 'oops' }));
    const partial = await crawlCompanySite(source(), {}, async () => 'saved', noPause);
    expect(partial).toMatchObject({ outcome: 'partial', counts: { saved: 1, failed: 2 } });
  });

  it('профиль битый — config_invalid; допуск отозван во время записи — policy_blocked', async () => {
    expect(await crawlCompanySite(source({ mode: 'company_site' }), {}, async () => 'saved', noPause)).toMatchObject({ outcome: 'config_invalid' });
    setSiteTransportForTests(transport);
    routes.set(HOME, ok(HOME_HTML));
    const revoked = await crawlCompanySite(source(), { maxPages: 1 }, async () => {
      throw new SiteCollectRevokedError('сбор отозван');
    }, noPause);
    expect(revoked).toMatchObject({ outcome: 'policy_blocked', health: 'blocked', coverage: { pages: [] } });
  });
});
