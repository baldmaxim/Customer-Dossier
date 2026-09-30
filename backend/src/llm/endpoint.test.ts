// OpenRouter вместо LM Studio: разбор настроек, маршрут в запросе и в идентичности запуска, проверка перед проходом.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseEnv } from '../config/env.js';
import { OPENROUTER_BASE_URL } from '../config/llm.js';
import { EnvValueError } from '../config/parse.js';
import { buildFingerprint, lmStudioProvider, type IChunkerParams } from '../reprocess/provider.js';
import { extractHeadline, setAdminLlmApiKey } from './client.js';
import { checkOpenRouter, matchesRoute, openRouterRouting, requestHeaders, type ILlmTarget } from './endpoint.js';

const SECRET = 'sk-or-v1-test-secret-value';
const base = { DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x' };
const chunker: IChunkerParams = { chunkSize: 3500, maxChunks: 6, overlap: 400 };
const OPENROUTER_ENV = { LLM_PROVIDER: 'openrouter', LLM_API_KEY: SECRET, LMSTUDIO_BASE_URL: '', OPENROUTER_PROVIDERS: '' };

/** Свежий граф модулей с другим env: env разбирается один раз при импорте. */
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

const errorText = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EnvValueError);
    return (err as Error).message;
  }
  throw new Error('ожидалась ошибка конфигурации');
};

describe('настройки модели (config/llm.ts)', () => {
  it('по умолчанию — LM Studio без ключа и маршрута', () => {
    const env = parseEnv(base);
    expect(env.LLM_PROVIDER).toBe('lmstudio');
    expect(env.LLM_API_KEY).toBe('');
    expect(env.OPENROUTER_PROVIDERS).toEqual([]);
    expect(env.LMSTUDIO_BASE_URL).toBe('http://127.0.0.1:1234/v1');
  });

  it('openrouter по http не собирается, текст ошибки без значения ключа; без ключа в .env — собирается', () => {
    // Ключ задают и в админке (settings/llmKey.ts): его отсутствие в .env — не ошибка конфигурации.
    expect(parseEnv({ ...base, LLM_PROVIDER: 'openrouter' }).LLM_API_KEY).toBe('');
    const http = errorText(() => parseEnv({ ...base, LLM_PROVIDER: 'openrouter', LLM_API_KEY: SECRET, LMSTUDIO_BASE_URL: 'http://127.0.0.1:1234/v1' }));
    expect(http).toMatch(/https/);
    expect(http).not.toContain(SECRET);
    expect(errorText(() => parseEnv({ ...base, LLM_PROVIDER: 'openai' }))).toMatch(/LLM_PROVIDER/);
  });

  it('openrouter без адреса — API OpenRouter; маршрут приводится к нижнему регистру и проверяется', () => {
    const env = parseEnv({ ...base, LLM_PROVIDER: 'OpenRouter', LLM_API_KEY: ` ${SECRET} `, OPENROUTER_PROVIDERS: ' DeepInfra/fp8 , siliconflow ' });
    expect(env.LLM_PROVIDER).toBe('openrouter');
    expect(env.LMSTUDIO_BASE_URL).toBe(OPENROUTER_BASE_URL);
    expect(env.LLM_API_KEY).toBe(SECRET);
    expect(env.OPENROUTER_PROVIDERS).toEqual(['deepinfra/fp8', 'siliconflow']);
    const or = { ...base, LLM_PROVIDER: 'openrouter', LLM_API_KEY: SECRET };
    expect(errorText(() => parseEnv({ ...or, OPENROUTER_PROVIDERS: 'deep infra' }))).toMatch(/OPENROUTER_PROVIDERS/);
    expect(errorText(() => parseEnv({ ...or, OPENROUTER_PROVIDERS: 'deepinfra,deepinfra' }))).toMatch(/дважды/);
  });

  it('ключ и маршрут, оставленные в .env при возврате на LM Studio, ни на что не влияют: ключ не уходит в LM Studio', () => {
    const env = parseEnv({ ...base, LLM_API_KEY: SECRET, OPENROUTER_PROVIDERS: 'deep infra' });
    expect(env.OPENROUTER_PROVIDERS).toEqual([]);
    expect(env.LLM_API_KEY).toBe('');
  });
});

describe('маршрут OpenRouter', () => {
  it('всегда только строгая схема и без сбора данных; названы хостинги — только они, по порядку', () => {
    expect(openRouterRouting([])).toEqual({ sort: 'price', require_parameters: true, data_collection: 'deny' });
    expect(openRouterRouting(['deepinfra/fp8', 'siliconflow'])).toEqual({
      order: ['deepinfra/fp8', 'siliconflow'],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: 'deny',
    });
  });

  it('хостинг подходит маршруту по тегу целиком или по имени провайдера', () => {
    expect(matchesRoute('deepinfra/fp8', [])).toBe(true);
    expect(matchesRoute('deepinfra/fp8', ['deepinfra'])).toBe(true);
    expect(matchesRoute('deepinfra/fp8', ['deepinfra/fp8'])).toBe(true);
    expect(matchesRoute('deepinfra/bf16', ['deepinfra/fp8'])).toBe(false);
    expect(matchesRoute('deepinfrax', ['deepinfra'])).toBe(false);
  });
});

describe('идентичность исполнения', () => {
  it('у LM Studio отпечаток прежний: поставленные запуски не уходят в blocked', () => {
    const provider = lmStudioProvider();
    expect(provider.provider).toBe('lmstudio');
    // Порядок ключей входит в hash — сверяем строкой.
    expect(JSON.stringify(provider.params)).toBe(
      JSON.stringify({ temperature: 0.1, maxTokens: 2048, contextNote: 'ctx задаётся в LM Studio; чанк в символах — приближение' }),
    );
  });

  it('та же модель через OpenRouter — другая конфигурация; маршрут в отпечатке, ключа и адреса нет', async () => {
    const local = buildFingerprint(lmStudioProvider(), chunker);
    const cloud = await loadWith(OPENROUTER_ENV, async () => {
      const m = await import('../reprocess/provider.js');
      return { fp: m.buildFingerprint(m.lmStudioProvider(), chunker), provider: m.lmStudioProvider() };
    });
    const pinned = await loadWith({ ...OPENROUTER_ENV, OPENROUTER_PROVIDERS: 'deepinfra/fp8' }, async () => {
      const m = await import('../reprocess/provider.js');
      return m.buildFingerprint(m.lmStudioProvider(), chunker);
    });
    expect(cloud.provider.provider).toBe('openrouter');
    expect(cloud.provider.model).toBe(lmStudioProvider().model);
    expect(cloud.provider.params.routing).toEqual(openRouterRouting([]));
    expect(cloud.fp.modelIdentityHash).not.toBe(local.modelIdentityHash);
    expect(pinned.modelIdentityHash).not.toBe(cloud.fp.modelIdentityHash);
    const json = JSON.stringify(cloud.fp.json);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('openrouter.ai');
  });
});

describe('запрос к модели', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const ok = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const capture = (responses: Response[]) => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return responses.shift() ?? ok('{"topic":"запасной ответ"}');
    });
    return calls;
  };

  it('LM Studio — без ключа и без маршрута, как раньше; ключ из админки ему не уходит', async () => {
    setAdminLlmApiKey(SECRET);
    try {
      const calls = capture([ok('{"topic":"Стройка школы"}')]);
      const result = await extractHeadline({ body: 'Текст новости.', publishedAt: null });
      expect(result.ok).toBe(true);
      expect(calls[0]?.headers.Authorization).toBeUndefined();
      expect(calls[0]?.body).not.toHaveProperty('provider');
    } finally {
      setAdminLlmApiKey(null);
    }
  });

  it('ключ из админки главнее LLM_API_KEY; удалили — снова .env', async () => {
    const client = await loadWith(OPENROUTER_ENV, () => import('./client.js'));
    const calls = capture([ok('{"topic":"первый"}'), ok('{"topic":"второй"}')]);
    client.setAdminLlmApiKey('sk-or-v1-from-admin-0002');
    await client.extractHeadline({ body: 'Текст новости.', publishedAt: null });
    client.setAdminLlmApiKey(null);
    await client.extractHeadline({ body: 'Текст новости.', publishedAt: null });
    expect(calls.map(c => c.headers.Authorization)).toEqual(['Bearer sk-or-v1-from-admin-0002', `Bearer ${SECRET}`]);
  });

  it('OpenRouter — ключ в заголовке, маршрут в теле, строгая схема на месте', async () => {
    const client = await loadWith(OPENROUTER_ENV, () => import('./client.js'));
    const calls = capture([ok('{"topic":"Стройка школы"}')]);
    const result = await client.extractHeadline({ body: 'Текст новости.', publishedAt: null });
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe(`${OPENROUTER_BASE_URL}/chat/completions`);
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(calls[0]?.body.provider).toEqual(openRouterRouting([]));
    expect(calls[0]?.body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect(JSON.stringify(calls[0]?.body)).not.toContain(SECRET);
  });

  it('сбой хостинга в теле ответа — сетевой сбой с повтором, а не «невалидный JSON» с урезанным текстом', async () => {
    vi.useFakeTimers();
    const calls = capture([
      new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 502 } }), { status: 200 }),
      ok('{"topic":"Стройка школы"}'),
    ]);
    const pending = extractHeadline({ body: 'Текст новости о стройке.', publishedAt: null });
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.ok && result.truncatedInput).toBeFalsy();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.temperature).toBe(0.1);
  });
});

describe('проверка OpenRouter перед проходом', () => {
  const target: ILlmTarget = {
    provider: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    model: 'qwen/qwen3-30b-a3b-instruct-2507',
    apiKey: SECRET,
    routeProviders: [],
  };
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
  const endpoints = (list: Array<{ tag: string; so: boolean }>) =>
    json(200, { data: { endpoints: list.map(e => ({ tag: e.tag, supported_parameters: e.so ? ['response_format', 'structured_outputs'] : ['response_format'] })) } });
  const fakeFetch = (routes: Record<string, () => Response>) => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    const impl = async (url: string, init: RequestInit): Promise<Response> => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      const path = url.slice(OPENROUTER_BASE_URL.length);
      const route = routes[path];
      if (!route) throw new Error(`неожиданный запрос ${path}`);
      return route();
    };
    return { impl, seen };
  };
  const healthy = {
    '/key': () => json(200, { data: { limit: 10, limit_remaining: 4.2 } }),
    '/credits': () => json(200, { data: { total_credits: 10, total_usage: 3 } }),
    '/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints': () => endpoints([{ tag: 'siliconflow/fp8', so: true }, { tag: 'alibaba', so: false }]),
  };

  it('ключ принят, средства есть, хостинг со строгой схемой есть — модель доступна', async () => {
    const { impl, seen } = fakeFetch(healthy);
    expect(await checkOpenRouter(target, 1000, impl)).toEqual({ ok: true, models: [target.model] });
    expect(seen.map(s => s.auth)).toEqual(Array(3).fill(`Bearer ${SECRET}`));
  });

  it('ключ не принят — прохода нет, в тексте нет ключа', async () => {
    const { impl } = fakeFetch({ ...healthy, '/key': () => json(401, { error: { message: 'User not found.' } }) });
    const result = await checkOpenRouter(target, 1000, impl);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/не принял ключ/);
    expect(result.error).not.toContain(SECRET);
  });

  it('ключа нет ни в админке, ни в .env — прохода нет, OpenRouter не спрашивается', async () => {
    const { impl, seen } = fakeFetch(healthy);
    const result = await checkOpenRouter({ ...target, apiKey: '' }, 1000, impl);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/не задан/) });
    expect(seen).toEqual([]);
  });

  it('лимит ключа или средства счёта исчерпаны — прохода нет', async () => {
    const limit = fakeFetch({ ...healthy, '/key': () => json(200, { data: { limit: 5, limit_remaining: 0 } }) });
    expect((await checkOpenRouter(target, 1000, limit.impl)).error).toMatch(/лимит/);
    const credits = fakeFetch({ ...healthy, '/credits': () => json(200, { data: { total_credits: 5, total_usage: 5.01 } }) });
    expect((await checkOpenRouter(target, 1000, credits.impl)).error).toMatch(/средства/);
  });

  it('остаток счёта недоступен — проверку не проваливает; у ключа без лимита лимит не проверяется', async () => {
    const { impl } = fakeFetch({
      ...healthy,
      '/key': () => json(200, { data: { limit: null, limit_remaining: null } }),
      '/credits': () => json(403, { error: { message: 'forbidden' } }),
    });
    expect((await checkOpenRouter(target, 1000, impl)).ok).toBe(true);
  });

  it('модели нет или нет хостинга со строгой схемой в пределах маршрута — прохода нет', async () => {
    const missing = fakeFetch({ ...healthy, '/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints': () => json(404, {}) });
    expect((await checkOpenRouter(target, 1000, missing.impl)).error).toMatch(/нет в OpenRouter/);
    const loose = fakeFetch({ ...healthy, '/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints': () => endpoints([{ tag: 'alibaba', so: false }]) });
    expect((await checkOpenRouter(target, 1000, loose.impl)).error).toMatch(/строгой JSON-схемой$/);
    const pinned = fakeFetch(healthy);
    expect((await checkOpenRouter({ ...target, routeProviders: ['deepinfra'] }, 1000, pinned.impl)).error).toMatch(/OPENROUTER_PROVIDERS/);
    const provider = fakeFetch(healthy);
    expect((await checkOpenRouter({ ...target, routeProviders: ['siliconflow'] }, 1000, provider.impl)).ok).toBe(true);
  });

  it('сеть не отвечает — прохода нет', async () => {
    const result = await checkOpenRouter(target, 1000, async () => {
      throw new Error('connect ETIMEDOUT');
    });
    expect(result).toEqual({ ok: false, models: [], error: 'connect ETIMEDOUT' });
  });

  it('заголовки: ключ только когда задан', () => {
    expect(requestHeaders({ ...target, apiKey: '' })).toEqual({ 'Content-Type': 'application/json' });
    expect(requestHeaders(target).Authorization).toBe(`Bearer ${SECRET}`);
  });
});
