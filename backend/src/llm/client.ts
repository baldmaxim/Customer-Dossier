// Клиент модели: LM Studio или OpenRouter (OpenAI-совместимый /v1 у обоих).
//
// Изолирован намеренно: переезд с локальной RTX на отдельную машину с RTX 6000
// — смена LMSTUDIO_BASE_URL и LMSTUDIO_MODEL, в облако — ещё LLM_PROVIDER и
// LLM_API_KEY (llm/endpoint.ts), без правок в пайплайне.

import { env } from '../config/env.js';
import type { ZodType, ZodTypeDef } from 'zod';

import { EXTRACT_JSON_SCHEMA, extractionSchema, type IExtraction } from './schema.js';
import { buildSystemMessage, buildUserMessage } from './prompt.js';
import { SEMANTIC_JSON_SCHEMA, semanticExtractionSchema, type ISemanticExtraction } from './semantic/schema.js';
import { buildSemanticSystemMessage, buildSemanticUserMessage } from './semantic/prompt.js';
import { HEADLINE_JSON_SCHEMA, headlineSchema, type IHeadline } from './headline/schema.js';
import { buildHeadlineSystemMessage, buildHeadlineUserMessage } from './headline/prompt.js';
import { DOMRF_HINT_JSON_SCHEMA, domRfHintSchema, type IDomRfHint } from './domrfHint/schema.js';
import { buildEntityMatchSystemMessage, buildEntityMatchUserMessage } from './entityMatch/prompt.js';
import { ENTITY_MATCH_JSON_SCHEMA, entityMatchSchema, type IEntityMatch } from './entityMatch/schema.js';
import { buildDomRfHintSystemMessage, buildDomRfHintUserMessage } from './domrfHint/prompt.js';
import { SITE_SEARCH_JSON_SCHEMA, siteSearchSchema, type ISiteSearch } from './siteSearch/schema.js';
import { buildSiteSearchSystemMessage, siteSearchPlugins } from './siteSearch/prompt.js';
import { SITE_PROJECTS_JSON_SCHEMA, siteProjectsSchema, type ISiteProjects } from './siteProjects/schema.js';
import { buildSiteProjectsSystemMessage, buildSiteProjectsUserMessage } from './siteProjects/prompt.js';
import { checkOpenRouter, requestHeaders, requestRouting, type ILlmConnection, type ILlmTarget } from './endpoint.js';

export type LlmFailure = 'invalid_json' | 'schema_error' | 'llm_error';

export interface ILlmUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

/** Страница из результатов веб-поиска OpenRouter (`message.annotations[].url_citation`). */
export interface ILlmCitation {
  url: string;
  title: string | null;
  content: string | null;
}

export type ILlmResult<T = IExtraction> =
  | {
      ok: true;
      data: T;
      usage: ILlmUsage;
      rawResponse: string;
      /** Ответ получен на укороченном тексте: он описывает не весь вход. */
      truncatedInput?: boolean;
      /** Только у спецификации с веб-поиском: страницы, которые поиск отдал модели. */
      citations?: ILlmCitation[];
    }
  | { ok: false; failure: LlmFailure; message: string; usage: ILlmUsage; rawResponse: string | null };

interface IUrlCitationAnnotation {
  type?: string;
  url_citation?: { url?: unknown; title?: unknown; content?: unknown };
}

interface IChatCompletionResponse {
  choices?: Array<{ message?: { content?: string; annotations?: IUrlCitationAnnotation[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** OpenRouter: сбой хостинга приходит телом ответа, а не только статусом. */
  error?: { message?: string; code?: number | string };
}

/** Ключ OpenRouter из админки (settings/llmKey.ts): главнее LLM_API_KEY из .env. */
let adminApiKey: string | null = null;

export const setAdminLlmApiKey = (key: string | null): void => {
  adminApiKey = key;
};

/**
 * Куда идёт запрос — из env и ключа админки; ключ живёт только здесь и в заголовке.
 * LM Studio ключ OpenRouter не получает, откуда бы тот ни пришёл.
 */
export const llmTarget = (): ILlmTarget => ({
  provider: env.LLM_PROVIDER,
  baseUrl: env.LMSTUDIO_BASE_URL,
  model: env.LMSTUDIO_MODEL,
  apiKey: env.LLM_PROVIDER === 'openrouter' ? (adminApiKey ?? env.LLM_API_KEY) : '',
  routeProviders: env.OPENROUTER_PROVIDERS,
});

/**
 * Модель иногда оборачивает JSON в ```json ... ``` вопреки инструкции.
 * Дешевле снять обёртку, чем терять документ.
 */
const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
};

/** Что просить у модели и чем проверять ответ: extract@2 или extract@3. */
export interface IExtractSpec<T> {
  schemaName: string;
  jsonSchema: unknown;
  validator: ZodType<T, ZodTypeDef, unknown>;
  system: () => string;
  user: (body: string, publishedAt: Date | null) => string;
  /**
   * Плагины OpenRouter (веб-поиск) — только у спецификации, которой они нужны. В идентичность исполнения
   * запусков разбора (reprocess/provider.ts) тело запроса не входит, у прежних спецификаций поля нет.
   */
  plugins?: () => unknown[];
}

export const LEGACY_SPEC: IExtractSpec<IExtraction> = {
  schemaName: 'tg_info_extract',
  jsonSchema: EXTRACT_JSON_SCHEMA,
  validator: extractionSchema,
  system: buildSystemMessage,
  user: buildUserMessage,
};

export const SEMANTIC_SPEC: IExtractSpec<ISemanticExtraction> = {
  schemaName: 'tg_info_extract_v3',
  jsonSchema: SEMANTIC_JSON_SCHEMA,
  validator: semanticExtractionSchema,
  system: buildSemanticSystemMessage,
  user: buildSemanticUserMessage,
};

/**
 * headline@1 — тема публикации одной строкой. Отдельная спецификация, а не поле в extract@3:
 * иначе смена схемы извлечения меняла бы идентичность всех запусков разбора.
 */
export const HEADLINE_SPEC: IExtractSpec<IHeadline> = {
  schemaName: 'tg_info_headline',
  jsonSchema: HEADLINE_JSON_SCHEMA,
  validator: headlineSchema,
  system: buildHeadlineSystemMessage,
  user: buildHeadlineUserMessage,
};

/** Подсказка к совпадению с реестром ДОМ.РФ: данные запроса уже собраны текстом (formatDomRfHintInput). */
export const DOMRF_HINT_SPEC: IExtractSpec<IDomRfHint> = {
  schemaName: 'tg_info_domrf_hint',
  jsonSchema: DOMRF_HINT_JSON_SCHEMA,
  validator: domRfHintSchema,
  system: buildDomRfHintSystemMessage,
  user: body => buildDomRfHintUserMessage(body),
};

/** Пара «возможный дубль»: две карточки уже собраны текстом (formatEntityMatchInput). */
export const ENTITY_MATCH_SPEC: IExtractSpec<IEntityMatch> = {
  schemaName: 'tg_info_entity_match',
  jsonSchema: ENTITY_MATCH_JSON_SCHEMA,
  validator: entityMatchSchema,
  system: buildEntityMatchSystemMessage,
  user: body => buildEntityMatchUserMessage(body),
};

/**
 * site-search@1 — официальный сайт компании через веб-поиск OpenRouter (этап 25A). Сообщение пользователя —
 * сам поисковый запрос (formatSiteSearchQuery): плагин ищет по нему, маркеры ему не нужны.
 */
export const SITE_SEARCH_SPEC: IExtractSpec<ISiteSearch> = {
  schemaName: 'tg_info_site_search',
  jsonSchema: SITE_SEARCH_JSON_SCHEMA,
  validator: siteSearchSchema,
  system: buildSiteSearchSystemMessage,
  user: body => body,
  plugins: () => siteSearchPlugins(env.SITE_SEARCH_MAX_RESULTS),
};

/** site-projects@1 — проекты со страницы сайта компании (этап 25B): текст уже собран formatSiteProjectsInput. */
export const SITE_PROJECTS_SPEC: IExtractSpec<ISiteProjects> = {
  schemaName: 'tg_info_site_projects',
  jsonSchema: SITE_PROJECTS_JSON_SCHEMA,
  validator: siteProjectsSchema,
  system: buildSiteProjectsSystemMessage,
  user: body => buildSiteProjectsUserMessage(body),
};

/** Цитаты веб-поиска из ответа: только с адресом; заголовок и фрагмент — по возможности. */
export const parseCitations = (annotations: IUrlCitationAnnotation[] | undefined): ILlmCitation[] =>
  (annotations ?? []).flatMap(a => {
    const c = a.type === 'url_citation' ? a.url_citation : undefined;
    if (!c || typeof c.url !== 'string' || c.url.trim() === '') return [];
    const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
    return [{ url: c.url.trim(), title: text(c.title, 300), content: text(c.content, 2000) }];
  });

export interface IExtractOptions {
  body: string;
  publishedAt: Date | null;
  /** Понижение temperature на повторе после невалидного JSON. */
  temperature?: number;
  maxTokens?: number;
  /** Внешняя отмена (best-effort): уже отправленный запрос мог дойти до модели. Таймаут действует всегда. */
  signal?: AbortSignal;
  /** Вызывается перед КАЖДОЙ попыткой, включая повторы; исключение прекращает попытки (допуск отозван, аренда потеряна). */
  beforeAttempt?: () => Promise<void>;
  /** Экспериментальный вариант промта extract@3 (этап 14B, только оценка). */
  promptVariant?: string | null;
}

/** Политика повторов ниже — часть идентичности исполнения запуска (reprocess/provider.ts). */
export const RETRY_POLICY_VERSION = 'retry@1:llm_error×3(2s,8s);invalid_json→1×temp0,70%';

/**
 * OpenRouter: хостинг иногда отдаёт JSON без обязательных полей, хотя строгую схему заявляет (28 из 289
 * ответов при переразборе 30.09.2026). Один повтор тем же текстом при temperature 0. У LM Studio
 * схему держит сам сервер — политика и отпечаток прежние.
 */
export const retryPolicyVersion = (): string =>
  env.LLM_PROVIDER === 'openrouter' ? `${RETRY_POLICY_VERSION};schema_error→1×temp0` : RETRY_POLICY_VERSION;

/** Таймаут одного вызова: у облака ответ идёт через туннель и медленные хостинги — свой предел. */
export const llmTimeoutMs = (): number => (env.LLM_PROVIDER === 'openrouter' ? env.OPENROUTER_TIMEOUT_MS : env.LMSTUDIO_TIMEOUT_MS);

const callOnce = async <T>(options: IExtractOptions, spec: IExtractSpec<T>): Promise<ILlmResult<T>> => {
  const startedAt = Date.now();
  const emptyUsage = (): ILlmUsage => ({
    tokensIn: null,
    tokensOut: null,
    latencyMs: Date.now() - startedAt,
  });

  const target = llmTarget();
  const routing = requestRouting(target);
  if (spec.plugins && target.provider !== 'openrouter') {
    // Веб-поиск — услуга OpenRouter; у LM Studio его нет, и молча отвечать без поиска модель не должна.
    return { ok: false, failure: 'llm_error', message: 'веб-поиск доступен только через OpenRouter (LLM_PROVIDER=openrouter)', usage: emptyUsage(), rawResponse: null };
  }
  let response: Response;
  try {
    response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: requestHeaders(target),
      body: JSON.stringify({
        model: env.LMSTUDIO_MODEL,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? env.EXTRACT_MAX_TOKENS,
        messages: [
          { role: 'system', content: spec.system() },
          { role: 'user', content: spec.user(options.body, options.publishedAt) },
        ],
        // Инструменты модели не передаются: ответ — только JSON по схеме, текст публикации ничего не вызывает.
        response_format: {
          type: 'json_schema',
          json_schema: { name: spec.schemaName, strict: true, schema: spec.jsonSchema },
        },
        ...(routing ? { provider: routing } : {}),
        ...(spec.plugins ? { plugins: spec.plugins() } : {}),
      }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(llmTimeoutMs())])
        : AbortSignal.timeout(llmTimeoutMs()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, failure: 'llm_error', message, usage: emptyUsage(), rawResponse: null };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      failure: 'llm_error',
      message: `HTTP ${response.status}: ${text.slice(0, 500)}`,
      usage: emptyUsage(),
      rawResponse: null,
    };
  }

  const payload = (await response.json()) as IChatCompletionResponse;
  const usage: ILlmUsage = {
    tokensIn: payload.usage?.prompt_tokens ?? null,
    tokensOut: payload.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - startedAt,
  };
  if (payload.error) {
    // Сбой хостинга, а не ответ модели: повтор с урезанным текстом тут не поможет.
    const code = payload.error.code === undefined ? '' : ` ${payload.error.code}`;
    return { ok: false, failure: 'llm_error', message: `ошибка провайдера${code}: ${(payload.error.message ?? '').slice(0, 500)}`, usage, rawResponse: null };
  }
  const content = payload.choices?.[0]?.message?.content ?? '';
  const citations = spec.plugins ? parseCitations(payload.choices?.[0]?.message?.annotations) : undefined;

  if (content.trim() === '') {
    // Классический симптом: Qwen3 ушёл в режим рассуждения и сжёг max_tokens.
    return {
      ok: false,
      failure: 'invalid_json',
      message: 'Модель вернула пустой content (вероятно, режим reasoning — проверьте /no_think)',
      usage,
      rawResponse: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch (err) {
    return {
      ok: false,
      failure: 'invalid_json',
      message: err instanceof Error ? err.message : String(err),
      usage,
      rawResponse: content,
    };
  }

  const validated = spec.validator.safeParse(parsed);
  if (!validated.success) {
    const details = validated.error.issues
      .slice(0, 5)
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { ok: false, failure: 'schema_error', message: details, usage, rawResponse: content };
  }

  return { ok: true, data: validated.data, usage, rawResponse: content, ...(citations ? { citations } : {}) };
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Паузы между попытками при сетевых сбоях. */
const BACKOFF_MS = [2000, 8000, 30_000];

/**
 * Извлечение с ретраями.
 *
 * Сетевые сбои и 5xx — три попытки с backoff: LM Studio мог перезагружать модель.
 * Невалидный JSON — ровно один повтор при temperature 0 и урезанном на 30 %
 * тексте: обычная причина — обрыв генерации на лимите токенов, и повтор с той
 * же длиной даст тот же обрыв. OpenRouter: ответ не по схеме — один повтор
 * тем же текстом при temperature 0 (retryPolicyVersion).
 */
export const extractWith = async <T>(options: IExtractOptions, spec: IExtractSpec<T>): Promise<ILlmResult<T>> => {
  let last: ILlmResult<T> | null = null;

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    if (options.beforeAttempt) await options.beforeAttempt();
    const result = await callOnce(options, spec);
    if (result.ok || result.failure !== 'llm_error') {
      last = result;
      break;
    }
    last = result;
    if (attempt < BACKOFF_MS.length - 1) {
      await sleep(BACKOFF_MS[attempt] ?? 2000);
    }
  }

  if (!last) throw new Error('extractWith: недостижимое состояние');
  if (last.ok) return last;
  if (last.failure === 'schema_error' && env.LLM_PROVIDER === 'openrouter') {
    // Ответ не по схеме — дело хостинга, а не длины текста: повтор тем же текстом (retryPolicyVersion).
    console.warn('[llm] ответ не по схеме, повтор при temperature=0');
    if (options.beforeAttempt) await options.beforeAttempt();
    return callOnce({ ...options, temperature: 0 }, spec);
  }
  if (last.failure !== 'invalid_json') return last;

  const shortened = options.body.slice(0, Math.floor(options.body.length * 0.7));
  console.warn('[llm] невалидный JSON, повтор при temperature=0 и укороченном тексте');
  if (options.beforeAttempt) await options.beforeAttempt();
  const retry = await callOnce({ ...options, body: shortened, temperature: 0 }, spec);
  // Хвост текста модель не видела — вызывающий код обязан это знать.
  return retry.ok ? { ...retry, truncatedInput: true } : retry;
};

/** extract@2 — прежний путь (теневой прогон, сравнение моделей). */
export const extractFromText = (options: IExtractOptions): Promise<ILlmResult> => extractWith(options, LEGACY_SPEC);

/** extract@3 — типизированные связи и события (этап 06). */
export const extractSemantic = (options: IExtractOptions): Promise<ILlmResult<ISemanticExtraction>> =>
  extractWith(options, options.promptVariant ? { ...SEMANTIC_SPEC, system: () => buildSemanticSystemMessage(options.promptVariant ?? null) } : SEMANTIC_SPEC);

/** domrf-hint@1 — подсказка инженеру «он / не он». Канон не трогает: результат — на строке совпадения. */
export const extractDomRfHint = (options: IExtractOptions): Promise<ILlmResult<IDomRfHint>> => extractWith(options, DOMRF_HINT_SPEC);

/** entity-match@1 — одна ли сущность в паре «возможный дубль». Вердикт применяет resolve/modelReview.ts. */
export const extractEntityMatch = (options: IExtractOptions): Promise<ILlmResult<IEntityMatch>> => extractWith(options, ENTITY_MATCH_SPEC);

/** site-projects@1 — проекты со страницы сайта компании. Канон не трогает: результат — в company_site_extractions. */
export const extractSiteProjects = (options: IExtractOptions): Promise<ILlmResult<ISiteProjects>> => extractWith(options, SITE_PROJECTS_SPEC);

/** headline@1 — тема публикации. Канон не трогает: результат живёт в revision_headlines. */
export const extractHeadline = (options: IExtractOptions): Promise<ILlmResult<IHeadline>> =>
  extractWith(options, HEADLINE_SPEC);

/**
 * site-search@1 — ровно одна попытка: каждая попытка — платный поиск, повторы и их учёт в лимите решает
 * вызывающий (companySites/search.ts).
 */
export const extractSiteSearch = (options: IExtractOptions): Promise<ILlmResult<ISiteSearch>> => callOnce(options, SITE_SEARCH_SPEC);

/**
 * Сколько ждать проверку перед проходом и на экране. LM Studio — локальный адрес, 3 с хватает с запасом;
 * OpenRouter — три запроса через туннель до nl3, и 3 с на сервере то и дело не хватало: проход пропускался
 * при живой модели.
 */
export const modelProbeTimeoutMs = (): number => (env.LLM_PROVIDER === 'openrouter' ? 15_000 : 3_000);

/**
 * Проверка, что модель доступна. Для CLI, экрана и пропуска прохода конвейера.
 * LM Studio — сервер поднят, `models` — загруженные модели; OpenRouter — ключ, средства и хостинг
 * со строгой схемой, `models` — только выбранная модель (каталог OpenRouter — сотни моделей).
 */
export const checkLlmConnection = async (timeoutMs = 10_000): Promise<ILlmConnection> => {
  const target = llmTarget();
  if (target.provider === 'openrouter') return checkOpenRouter(target, timeoutMs);
  try {
    const response = await fetch(`${target.baseUrl}/models`, {
      headers: requestHeaders(target),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` };
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map(m => m.id ?? '').filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
};
