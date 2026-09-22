// Клиент LM Studio (OpenAI-совместимый /v1).
//
// Изолирован намеренно: переезд с локальной RTX на отдельную машину с RTX 6000
// или на облачный эндпоинт — это смена LMSTUDIO_BASE_URL и LMSTUDIO_MODEL,
// без правок в пайплайне.

import { env } from '../config/env.js';
import type { ZodType, ZodTypeDef } from 'zod';

import { EXTRACT_JSON_SCHEMA, extractionSchema, type IExtraction } from './schema.js';
import { buildSystemMessage, buildUserMessage } from './prompt.js';
import { SEMANTIC_JSON_SCHEMA, semanticExtractionSchema, type ISemanticExtraction } from './semantic/schema.js';
import { buildSemanticSystemMessage, buildSemanticUserMessage } from './semantic/prompt.js';
import { HEADLINE_JSON_SCHEMA, headlineSchema, type IHeadline } from './headline/schema.js';
import { buildHeadlineSystemMessage, buildHeadlineUserMessage } from './headline/prompt.js';

export type LlmFailure = 'invalid_json' | 'schema_error' | 'llm_error';

export interface ILlmUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export type ILlmResult<T = IExtraction> =
  | {
      ok: true;
      data: T;
      usage: ILlmUsage;
      rawResponse: string;
      /** Ответ получен на укороченном тексте: он описывает не весь вход. */
      truncatedInput?: boolean;
    }
  | { ok: false; failure: LlmFailure; message: string; usage: ILlmUsage; rawResponse: string | null };

interface IChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

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

const callOnce = async <T>(options: IExtractOptions, spec: IExtractSpec<T>): Promise<ILlmResult<T>> => {
  const startedAt = Date.now();
  const emptyUsage = (): ILlmUsage => ({
    tokensIn: null,
    tokensOut: null,
    latencyMs: Date.now() - startedAt,
  });

  let response: Response;
  try {
    response = await fetch(`${env.LMSTUDIO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.LMSTUDIO_MODEL,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 2048,
        messages: [
          { role: 'system', content: spec.system() },
          { role: 'user', content: spec.user(options.body, options.publishedAt) },
        ],
        // Инструменты модели не передаются: ответ — только JSON по схеме, текст публикации ничего не вызывает.
        response_format: {
          type: 'json_schema',
          json_schema: { name: spec.schemaName, strict: true, schema: spec.jsonSchema },
        },
      }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(env.LMSTUDIO_TIMEOUT_MS)])
        : AbortSignal.timeout(env.LMSTUDIO_TIMEOUT_MS),
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
  const content = payload.choices?.[0]?.message?.content ?? '';
  const usage: ILlmUsage = {
    tokensIn: payload.usage?.prompt_tokens ?? null,
    tokensOut: payload.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - startedAt,
  };

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

  return { ok: true, data: validated.data, usage, rawResponse: content };
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
 * же длиной даст тот же обрыв.
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
  if (last.ok || last.failure !== 'invalid_json') return last;

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

/** headline@1 — тема публикации. Канон не трогает: результат живёт в revision_headlines. */
export const extractHeadline = (options: IExtractOptions): Promise<ILlmResult<IHeadline>> =>
  extractWith(options, HEADLINE_SPEC);

/** Проверка, что LM Studio поднят и модель загружена. Для CLI и health-check. */
export const checkLlmConnection = async (
  timeoutMs = 10_000,
): Promise<{ ok: boolean; models: string[]; error?: string }> => {
  try {
    const response = await fetch(`${env.LMSTUDIO_BASE_URL}/models`, {
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
