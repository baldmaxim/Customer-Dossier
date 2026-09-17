// Этап 16 без сети и БД: контракт профиля, состояние источника, реестр возможностей и офлайн-представления страниц
// (полная статья и анонс, пустая лента и слом вёрстки, anti-bot/paywall, неизвестная дата, вложение без текста).
// Фикстуры написаны по известной разметке, а не скачаны: актуальность селекторов живого источника они не доказывают.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SOURCE_CAPABILITIES } from './capabilities.js';
import { evaluateSourcePolicy } from './policy.js';
import { SOURCE_PROFILE_CONTRACT, pathAllowed, sourceProfileMetaSchema } from './profileMeta.js';
import { parseSiteDate } from './sites/dates.js';
import { parseArticlePage, parseListPage } from './sites/parsers.js';
import { parseSiteProfile } from './sites/profile.js';
import { classifySourceHealth, listPageDegraded, type ISourceHealthInput } from './sourceHealth.js';
import { telegramProfileSchema } from './telegram/webCrawler.js';

const profile = (over: Record<string, unknown> = {}) =>
  parseSiteProfile({
    mode: 'html_list',
    startUrls: ['https://news-demo.test/news/'],
    list: { itemSelector: '.item', linkSelector: 'a.title', dateSelector: 'time', dateAttribute: 'datetime' },
    pagination: { nextSelector: 'a.next', maxPages: 3 },
    article: { bodySelector: '.article-body', truncatedSelector: '.paywall', dateSelector: 'time', dateAttribute: 'datetime' },
    limits: { delayMs: 0 },
    ...over,
  });

const filler = `<div class="banner">${'реклама и меню '.repeat(200)}</div>`;

describe('профиль источника source-profile@1 (T16-02)', () => {
  it('всё неизвестное — unknown/пусто; шаблон — draft', () => {
    const meta = sourceProfileMetaSchema.parse({});
    expect(meta).toMatchObject({
      contract: SOURCE_PROFILE_CONTRACT,
      owner: null,
      collectionMethod: 'unknown',
      expectedCompleteness: 'unknown',
      permissionsEvidence: { collect: null, aiProcessing: null },
      reviewStatus: 'draft',
    });
  });

  it('профиль сайта принимает meta, неизвестные ключи и параметры в префиксе отвергаются', () => {
    expect(profile({ meta: { owner: 'оператор', allowedPathPrefixes: ['/news/'] } }).meta?.allowedPathPrefixes).toEqual(['/news/']);
    expect(() => profile({ meta: { approved: true } })).toThrow(/профиль источника некорректен/);
    expect(() => profile({ meta: { allowedPathPrefixes: ['/news?id=1'] } })).toThrow();
  });

  it('основание в профиле не выдаёт допуск: сбор и ИИ решает только политика источника', () => {
    const p = profile({
      meta: {
        permissionsEvidence: {
          collect: { reference: 'письмо №1', checkedAt: '2026-09-17', checkedBy: 'оператор' },
          aiProcessing: { reference: 'письмо №1', checkedAt: '2026-09-17', checkedBy: 'оператор' },
        },
        reviewStatus: 'operator_checked',
      },
    });
    expect(p.meta?.reviewStatus).toBe('operator_checked');
    const policy = { key: 'news-demo.test', accessStatus: 'unknown' as const, aiProcessingStatus: 'unknown' as const, policyExpiresAt: null };
    expect(evaluateSourcePolicy(policy, 'collect').allowed).toBe(false);
    expect(evaluateSourcePolicy({ ...policy, accessStatus: 'approved' }, 'ai_processing').allowed).toBe(false);
  });

  it('префиксы пути сужают: соседний раздел и выход через «..» не проходят', () => {
    expect(pathAllowed('https://news-demo.test/news/2026/a', ['/news/'])).toBe(true);
    expect(pathAllowed('https://news-demo.test/newsletter', ['/news'])).toBe(false);
    expect(pathAllowed('https://news-demo.test/news/../admin', ['/news/'])).toBe(false);
    expect(pathAllowed('https://news-demo.test/anything', [])).toBe(true);
    expect(pathAllowed('не адрес', ['/news/'])).toBe(false);
  });
});

describe('офлайн-представления страниц (T16-01, T16-03, T16-04)', () => {
  it('законно пустая лента и сломанный селектор — разные исходы', () => {
    const empty = parseListPage('<html><body><p>Новостей пока нет</p></body></html>', 'https://news-demo.test/news/', profile());
    expect(empty.items).toHaveLength(0);
    expect(listPageDegraded({ items: 0, htmlLength: empty.htmlLength, minItems: 1, lastListCount: null })).toBe(false);

    const redesigned = parseListPage(`<html><body>${filler}<div class="card"><a href="/news/1">Статья</a></div></body></html>`, 'https://news-demo.test/news/', profile());
    expect(redesigned.items).toHaveLength(0);
    expect(listPageDegraded({ items: 0, htmlLength: redesigned.htmlLength, minItems: 1, lastListCount: null })).toBe(true);
    // Маленькая страница, но раньше записи были — тоже слом, а не «новостей нет».
    expect(listPageDegraded({ items: 0, htmlLength: 300, minItems: 1, lastListCount: 12 })).toBe(true);
  });

  it('полная статья, анонс под paywall и anti-bot заглушка различаются по полноте', () => {
    const full = parseArticlePage('<h1>А</h1><div class="article-body"><p>Полный текст статьи о стройке.</p></div>', profile());
    expect(full.completeness).toBe('full');
    const paywall = parseArticlePage('<h1>А</h1><div class="article-body"><p>Начало статьи…</p></div><div class="paywall">Оформите подписку</div>', profile());
    expect(paywall.completeness).toBe('excerpt');
    const challenge = parseArticlePage(`<html><body><h1>Проверка браузера</h1><p>Подтвердите, что вы не робот</p>${filler}</body></html>`, profile());
    expect(challenge.completeness).toBe('failed');
    expect(challenge.body).toBe('');
  });

  it('неизвестная дата — null, а не «сегодня»; дата без зоны — по зоне профиля', () => {
    const noDate = parseArticlePage('<div class="article-body"><p>Текст без даты.</p></div>', profile());
    expect(noDate.date).toBeNull();
    const vague = parseSiteDate('вчера', 'Europe/Moscow');
    expect(vague.date).toBeNull();
    const zoned = parseSiteDate('2026-09-17T10:00:00', 'Europe/Moscow');
    expect(zoned.date?.toISOString()).toBe('2026-09-17T07:00:00.000Z');
  });

  it('вложение без текста отмечено необработанным, OCR не выполняется', () => {
    const withImage = parseArticlePage('<div class="article-body"><img src="/plan.png"><p>Подпись к плану.</p></div>', profile());
    expect(withImage.attachments).toEqual([{ kind: 'image', status: 'unsupported' }]);
    expect(withImage.body).toBe('Подпись к плану.');
  });

  it('ссылка «дальше» на ту же страницу не считается следующей; цикл A→B→A останавливает crawler (sites.int)', () => {
    const page = parseListPage(
      '<div class="item"><a class="title" href="/news/1">Статья</a></div><a class="next" href="/news/">дальше</a>',
      'https://news-demo.test/news/',
      profile(),
    );
    expect(page.nextUrl).toBeNull();
    expect(page.stats.next).toBe(1);
  });
});

describe('состояние источника source-health@1 (T16-01, T16-06, T16-07)', () => {
  const base: ISourceHealthInput = {
    key: 'news-demo.test',
    accessStatus: 'approved',
    aiProcessingStatus: 'unknown',
    policyExpiresAt: null,
    health: 'ok',
    healthReason: null,
    lastAttemptAt: '2026-09-17T08:00:00Z',
    cursor: {},
    lastOutcome: 'ok',
    lastCoverage: { stopReason: 'exhausted' },
  };
  const state = (over: Partial<ISourceHealthInput>) => classifySourceHealth({ ...base, ...over }, new Date('2026-09-17T09:00:00Z'));

  it('шесть различимых состояний', () => {
    expect(state({}).state).toBe('healthy');
    expect(state({ lastAttemptAt: null, health: null, lastOutcome: null }).state).toBe('never_run');
    expect(state({ accessStatus: 'unknown' }).state).toBe('policy_blocked');
    expect(state({ health: 'blocked', healthReason: 'HTTP 403' }).state).toBe('policy_blocked');
    expect(state({ health: 'parser_degraded', healthReason: 'селектор нашёл 0' }).state).toBe('degraded');
    expect(state({ health: 'rate_limited' }).state).toBe('temporary_error');
    expect(state({ cursor: { tg: { gap: { after: 100, before: 140 } } } }).state).toBe('partial_history');
    expect(state({ lastCoverage: { stopReason: 'pagination_loop' } }).state).toBe('partial_history');
  });

  it('полнота истории всегда неизвестна; разрыв Telegram — фактическими границами', () => {
    const v = state({ cursor: { tg: { gap: { after: 100, before: 140 } } } });
    expect(v.coverage.totalKnown).toBe(false);
    expect(v.coverage.gaps[0]).toBe('Telegram: посты 101…139 ещё не догружены');
    expect(state({}).coverage).toEqual({ totalKnown: false, gaps: [] });
  });

  it('сбор разрешён — ИИ не разрешён, пока нет отдельного допуска', () => {
    expect(state({}).aiAllowed).toBe(false);
    expect(state({ aiProcessingStatus: 'approved' }).aiAllowed).toBe(true);
  });
});

describe('реестр возможностей (T16-06)', () => {
  it('ни один адаптер не обещает полную историю и наблюдение удалений', () => {
    expect(SOURCE_CAPABILITIES.map(c => c.adapter)).toEqual(['site_rss', 'site_html_list', 'telegram_web_preview', 'telegram_bot']);
    for (const c of SOURCE_CAPABILITIES) {
      expect(c.history.state, c.adapter).not.toBe('supported');
      expect(c.deletes.state, c.adapter).not.toBe('supported');
    }
  });
});

describe('шаблоны профилей (T16-08)', () => {
  const template = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(fileURLToPath(new URL(`../../../docs/development/sources/${name}`, import.meta.url)), 'utf8')) as Record<string, unknown>;

  it('шаблоны проходят схему, остаются draft без оснований и с адресом-заглушкой', () => {
    const site = parseSiteProfile(template('site-profile.template.json'));
    expect(site.meta).toMatchObject({ reviewStatus: 'draft', permissionsEvidence: { collect: null, aiProcessing: null } });
    expect(site.startUrls.every(u => new URL(u).hostname.endsWith('.invalid'))).toBe(true);
    const tg = telegramProfileSchema.parse(template('telegram-profile.template.json'));
    expect(tg.meta).toMatchObject({ reviewStatus: 'draft', collectionMethod: 'telegram_web_preview', permissionsEvidence: { collect: null, aiProcessing: null } });
  });
});
