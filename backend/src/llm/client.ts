// Клиент LM Studio (OpenAI-совместимый /v1).
//
// Изолирован намеренно: переезд с локальной RTX на отдельную машину с RTX 6000
// или на облачный эндпоинт — это смена LMSTUDIO_BASE_URL и LMSTUDIO_MODEL,
// без правок в пайплайне.

import { env } from '../config/env.js';
import { EXTRACT_JSON_SCHEMA, extractionSchema, type IExtraction } from './schema.js';
import { buildSystemMessage, buildUserMessage } from './prompt.js';

export type LlmFailure = 'invalid_json' | 'schema_error' | 'llm_error';

export interface ILlmUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export type ILlmResult =
  | { ok: true; data: IExtraction; usage: ILlmUsage; rawResponse: string }
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

export interface IExtractOptions {
  body: string;
  publishedAt: Date | null;
  /** Понижение temperature на повторе после невалидного JSON. */
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

const callOnce = async (options: IExtractOptions): Promise<ILlmResult> => {
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
          { role: 'system', content: buildSystemMessage() },
          { role: 'user', content: buildUserMessage(options.body, options.publishedAt) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'tg_info_extract', strict: true, schema: EXTRACT_JSON_SCHEMA },
        },
      }),
      signal: options.signal ?? AbortSignal.timeout(env.LMSTUDIO_TIMEOUT_MS),
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

  const validated = extractionSchema.safeParse(parsed);
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
export const extractFromText = async (options: IExtractOptions): Promise<ILlmResult> => {
  let last: ILlmResult | null = null;

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    const result = await callOnce(options);
    if (result.ok || result.failure !== 'llm_error') {
      last = result;
      break;
    }
    last = result;
    if (attempt < BACKOFF_MS.length - 1) {
      await sleep(BACKOFF_MS[attempt] ?? 2000);
    }
  }

  if (!last) throw new Error('extractFromText: недостижимое состояние');
  if (last.ok || last.failure !== 'invalid_json') return last;

  const shortened = options.body.slice(0, Math.floor(options.body.length * 0.7));
  console.warn('[llm] невалидный JSON, повтор при temperature=0 и укороченном тексте');
  return callOnce({ ...options, body: shortened, temperature: 0 });
};

/** Проверка, что LM Studio поднят и модель загружена. Для CLI и health-check. */
export const checkLlmConnection = async (): Promise<{ ok: boolean; models: string[]; error?: string }> => {
  try {
    const response = await fetch(`${env.LMSTUDIO_BASE_URL}/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` };
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map(m => m.id ?? '').filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
};
