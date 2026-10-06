// site-search@1 без сети (этап 25A): что просим у модели, что принимаем в ответ, и что веб-поиск уходит
// только у этой спецификации — разбор публикаций плагина не получает, и у LM Studio поиска нет.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENTITY_MATCH_SPEC, HEADLINE_SPEC, SEMANTIC_SPEC, SITE_SEARCH_SPEC, extractHeadline, extractSiteSearch, parseCitations } from '../client.js';
import { SITE_SEARCH_PROMPT_VERSION, SITE_SEARCH_QUERY_MAX, buildSiteSearchSystemMessage, formatSiteSearchQuery, siteSearchPlugins } from './prompt.js';
import { SITE_SEARCH_JSON_SCHEMA, SITE_SEARCH_REASON_MAX, SITE_SEARCH_SITES_MAX, siteSearchSchema } from './schema.js';

const OPENROUTER_ENV = { LLM_PROVIDER: 'openrouter', LLM_API_KEY: 'sk-or-v1-test-0000', LMSTUDIO_BASE_URL: '', OPENROUTER_PROVIDERS: '' };

const loadWith = async <T>(over: Record<string, string>, load: () => Promise<T>): Promise<T> => {
  const saved = Object.fromEntries(Object.keys(over).map(k => [k, process.env[k]]));
  Object.assign(process.env, over);
  vi.resetModules();
  try {
    return await load();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const ANSWER = '{"sites":[{"url":"https://donstroy.moscow/","reason":"ИНН на странице"}],"none_reason":null}';

const capture = (content: string, annotations: unknown[] = []) => {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content, annotations } }] }), { status: 200 });
  });
  return calls;
};

describe('site-search@1: промпт и схема', () => {
  it('strict json_schema: все свойства обязательны, nullable — массивом типов', () => {
    expect(SITE_SEARCH_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...SITE_SEARCH_JSON_SCHEMA.required]).toEqual(Object.keys(SITE_SEARCH_JSON_SCHEMA.properties));
    const item = SITE_SEARCH_JSON_SCHEMA.properties.sites.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required]).toEqual(Object.keys(item.properties));
    expect(SITE_SEARCH_JSON_SCHEMA.properties.none_reason.type).toEqual(['string', 'null']);
    expect(SITE_SEARCH_SPEC.schemaName).toBe('tg_info_site_search');
    expect(SITE_SEARCH_PROMPT_VERSION).toBe('site-search@1');
    expect(buildSiteSearchSystemMessage().endsWith('/no_think')).toBe(true);
  });

  it('ответ: адреса без пустых, не больше трёх, объяснение по слову; пустая причина — null', () => {
    const parsed = siteSearchSchema.parse({
      sites: [
        { url: ' https://a.ru/ ', reason: '  ИНН   в подвале ' },
        { url: '', reason: 'пусто' },
        { url: 'https://b.ru', reason: 'слово '.repeat(80) },
        { url: 'https://c.ru', reason: 'c' },
        { url: 'https://d.ru', reason: 'd' },
      ],
      none_reason: '  ',
    });
    expect(parsed.sites.map(s => s.url)).toEqual(['https://a.ru/', 'https://b.ru', 'https://c.ru']);
    expect(parsed.sites[0]!.reason).toBe('ИНН в подвале');
    expect(parsed.sites[1]!.reason.length).toBeLessThanOrEqual(SITE_SEARCH_REASON_MAX + 1);
    expect(parsed.sites).toHaveLength(SITE_SEARCH_SITES_MAX);
    expect(parsed.noneReason).toBeNull();
    expect(siteSearchSchema.safeParse({ sites: [{ url: 'x' }], none_reason: null }).success).toBe(false);
  });

  it('запрос — одна строка: кто, ИНН, город, до двух объектов; переводы строк и маркеры убраны', () => {
    const query = formatSiteSearchQuery({
      name: 'Донстрой\nИнвест <<<',
      legalForm: 'ООО',
      taxId: '7704123456',
      city: 'Москва',
      projects: ['ЖК Остров', 'ЖК Символ', 'ЖК Третий'],
      isGroup: false,
    });
    expect(query).toBe('Официальный сайт компании ООО «Донстрой Инвест», ИНН 7704123456, Москва, объекты: ЖК Остров, ЖК Символ');
    expect(formatSiteSearchQuery({ name: 'Донстрой', legalForm: null, taxId: null, city: null, projects: [], isGroup: true })).toBe(
      'Официальный сайт группы компаний «Донстрой»',
    );
    const long = formatSiteSearchQuery({ name: 'А'.repeat(500), legalForm: null, taxId: null, city: null, projects: [], isGroup: false });
    expect(long.length).toBeLessThanOrEqual(SITE_SEARCH_QUERY_MAX);
  });

  it('плагин веб-поиска — только у поиска сайта; у разбора, тем и дублей его нет', () => {
    expect(siteSearchPlugins(5)).toEqual([expect.objectContaining({ id: 'web', engine: 'exa', max_results: 5 })]);
    expect(SITE_SEARCH_SPEC.plugins).toBeTypeOf('function');
    for (const spec of [SEMANTIC_SPEC, HEADLINE_SPEC, ENTITY_MATCH_SPEC]) expect(spec.plugins).toBeUndefined();
  });

  it('цитаты: только url_citation с адресом; заголовок и фрагмент — по возможности', () => {
    expect(
      parseCitations([
        { type: 'url_citation', url_citation: { url: ' https://a.ru/x ', title: 'A', content: 'ИНН 7704123456' } },
        { type: 'url_citation', url_citation: { url: '' } },
        { type: 'file', url_citation: { url: 'https://b.ru' } },
        { type: 'url_citation', url_citation: { url: 'https://c.ru', title: 7 } },
      ]),
    ).toEqual([
      { url: 'https://a.ru/x', title: 'A', content: 'ИНН 7704123456' },
      { url: 'https://c.ru', title: null, content: null },
    ]);
    expect(parseCitations(undefined)).toEqual([]);
  });
});

describe('site-search@1: запрос к модели', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('LM Studio: веб-поиска нет — отказ без запроса', async () => {
    const calls = capture(ANSWER);
    const result = await extractSiteSearch({ body: 'Официальный сайт', publishedAt: null });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toMatch(/OpenRouter/);
    expect(calls).toHaveLength(0);
  });

  it('OpenRouter: плагин в теле, сообщение пользователя — сам запрос, цитаты в результате', async () => {
    const client = await loadWith(OPENROUTER_ENV, () => import('../client.js'));
    const calls = capture(ANSWER, [{ type: 'url_citation', url_citation: { url: 'https://donstroy.moscow/about', title: 'О компании' } }]);
    const result = await client.extractSiteSearch({ body: 'Официальный сайт группы компаний «Донстрой»', publishedAt: null });
    expect(result.ok).toBe(true);
    expect(result.ok && result.citations).toEqual([{ url: 'https://donstroy.moscow/about', title: 'О компании', content: null }]);
    expect(calls[0]?.plugins).toEqual([expect.objectContaining({ id: 'web' })]);
    const messages = calls[0]?.messages as Array<{ role: string; content: string }>;
    expect(messages[1]).toEqual({ role: 'user', content: 'Официальный сайт группы компаний «Донстрой»' });
    expect(calls).toHaveLength(1);
  });

  it('разбор и темы плагин не получают даже через OpenRouter', async () => {
    const client = await loadWith(OPENROUTER_ENV, () => import('../client.js'));
    const calls = capture('{"topic":"Стройка школы"}');
    await client.extractHeadline({ body: 'Текст новости.', publishedAt: null });
    expect(calls[0]).not.toHaveProperty('plugins');
    const local = capture('{"topic":"Стройка школы"}');
    const result = await extractHeadline({ body: 'Текст новости.', publishedAt: null });
    expect(result.ok && 'citations' in result).toBe(false);
    expect(local[0]).not.toHaveProperty('plugins');
  });
});
