// Провайдер модели для конвейера и неизменная идентичность исполнения запуска (этап 11).
//
// Интерфейс, а не прямой вызов LM Studio: интеграционные тесты подставляют
// детерминированные ответы, а реальный smoke модели проверяется отдельно и
// LOCAL_MODEL_VALIDATED по фикстурам не выставляется.
//
// Идентичность исполнения (execution-identity@1) — всё, что влияет на ответ и на то, как он превращается в кандидатов:
// провайдер и модель, эффективные сообщения (включая /no_think) и шаблон пользовательского сообщения, схема, параметры
// генерации и политика повторов, версия сборки и проверки кандидатов, нарезка. Адрес сервера и секреты не входят.
// Сведения, которые сервер не сообщает (квантизация, окно контекста, версия рантайма), — 'unknown', не догадка.

import { createHash } from 'node:crypto';

import { env } from '../config/env.js';
import { LEGACY_SPEC, SEMANTIC_SPEC, extractFromText, extractSemantic, RETRY_POLICY_VERSION, type ILlmResult } from '../llm/client.js';
import { SYSTEM_PROMPT } from '../llm/prompt.js';
import { EXTRACT_JSON_SCHEMA, SCHEMA_VERSION, type IExtraction } from '../llm/schema.js';
import { SEMANTIC_PROMPT_VERSION, SEMANTIC_SYSTEM_PROMPT } from '../llm/semantic/prompt.js';
import { SEMANTIC_JSON_SCHEMA, SEMANTIC_SCHEMA_VERSION, type ISemanticExtraction } from '../llm/semantic/schema.js';
import { CHUNKER_VERSION } from './chunking.js';

export const EXECUTION_IDENTITY_VERSION = 'execution-identity@1';

/**
 * Версия сборки кандидатов и проверки ответа (candidates.ts, pipeline/verify.ts, reprocess/semantic/{verify,assemble}.ts).
 * Меняется вручную при смысловой правке этих модулей — иначе запуск прежней проверкой выглядел бы как нынешний.
 */
export const CANDIDATE_BUILD_VERSION = 'candidates@1+semantic-verify@1';

/** Контекст одного вызова: best-effort отмена и проверка перед каждой попыткой (включая повторы внутри клиента). */
export interface IExtractContext {
  /** Отмена уже ушедшего запроса — best-effort: данные могли быть отправлены до отмены. */
  signal?: AbortSignal;
  /** Бросает исключение, если новую попытку делать нельзя (допуск отозван, аренда потеряна). */
  beforeAttempt?: () => Promise<void>;
}

export interface IModelProvider {
  provider: string;
  model: string;
  /** Параметры генерации, влияющие на ответ. */
  params: Record<string, unknown>;
  /** Схема ответа; не указана — extract@2 (прежние провайдеры и фикстуры). */
  schemaVersion?: string;
  /** Что известно о модели на сервере. Не сообщено сервером — 'unknown'. */
  serverReported?: Record<string, string>;
  extract: (text: string, publishedAt: Date | null, ctx?: IExtractContext) => Promise<ILlmResult<IExtraction | ISemanticExtraction>>;
}

export interface IChunkerParams {
  chunkSize: number;
  maxChunks: number;
  overlap: number;
}

export const DEFAULT_OVERLAP = 400;

export const defaultChunkerParams = (): IChunkerParams => ({
  chunkSize: env.EXTRACT_CHUNK_SIZE,
  maxChunks: env.EXTRACT_MAX_CHUNKS,
  overlap: DEFAULT_OVERLAP,
});

export const UNKNOWN_SERVER_METADATA: Readonly<Record<string, string>> = {
  quantization: 'unknown',
  contextWindow: 'unknown',
  runtimeVersion: 'unknown',
};

export const lmStudioProvider = (): IModelProvider => ({
  provider: 'lmstudio',
  model: env.LMSTUDIO_MODEL,
  schemaVersion: env.EXTRACT_SCHEMA_VERSION,
  // Совпадает с llm/client.ts. Окно контекста задаётся в LM Studio, а не здесь;
  // размер чанка в символах — приближение к токенам с запасом, не точный лимит.
  params: { temperature: 0.1, maxTokens: 2048, contextNote: 'ctx задаётся в LM Studio; чанк в символах — приближение' },
  // LM Studio по OpenAI-совместимому API не сообщает квантизацию и окно контекста загруженной модели.
  serverReported: { ...UNKNOWN_SERVER_METADATA },
  extract: (text, publishedAt, ctx) =>
    env.EXTRACT_SCHEMA_VERSION === SEMANTIC_SCHEMA_VERSION
      ? extractSemantic({ body: text, publishedAt, signal: ctx?.signal, beforeAttempt: ctx?.beforeAttempt })
      : extractFromText({ body: text, publishedAt, signal: ctx?.signal, beforeAttempt: ctx?.beforeAttempt }),
});

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Образец для хеша шаблона пользовательского сообщения: меняется шаблон — меняется хеш. */
const TEMPLATE_SAMPLE_TEXT = '⟦sample⟧';
const TEMPLATE_SAMPLE_DATE = new Date(Date.UTC(2000, 0, 1));

export interface IFingerprint {
  fingerprint: string;
  /** Хеш идентичности модели без нарезки: по нему worker отбирает свою очередь. */
  modelIdentityHash: string;
  json: Record<string, unknown>;
}

/** Идентичность модели и её вызова, без нарезки текста. */
export const buildModelIdentity = (provider: IModelProvider): Record<string, unknown> => {
  const semantic = provider.schemaVersion === SEMANTIC_SCHEMA_VERSION;
  const spec = semantic ? SEMANTIC_SPEC : LEGACY_SPEC;
  return {
    identityVersion: EXECUTION_IDENTITY_VERSION,
    promptVersion: semantic ? `${env.PROMPT_VERSION}+${SEMANTIC_PROMPT_VERSION}` : env.PROMPT_VERSION,
    promptHash: sha256(semantic ? SEMANTIC_SYSTEM_PROMPT : SYSTEM_PROMPT),
    // Эффективное системное сообщение целиком — с /no_think и прочими добавками.
    systemMessageHash: sha256(spec.system()),
    userTemplateHash: sha256(spec.user(TEMPLATE_SAMPLE_TEXT, TEMPLATE_SAMPLE_DATE)),
    schemaVersion: semantic ? SEMANTIC_SCHEMA_VERSION : SCHEMA_VERSION,
    schemaHash: sha256(JSON.stringify(semantic ? SEMANTIC_JSON_SCHEMA : EXTRACT_JSON_SCHEMA)),
    provider: provider.provider,
    model: provider.model,
    params: provider.params,
    retryPolicy: RETRY_POLICY_VERSION,
    candidateBuildVersion: CANDIDATE_BUILD_VERSION,
    serverReported: { ...UNKNOWN_SERVER_METADATA, ...(provider.serverReported ?? {}) },
  };
};

/** Смена промпта, схемы, модели, провайдера, параметров, проверки или нарезки — другой отпечаток. */
export const buildFingerprint = (provider: IModelProvider, chunker: IChunkerParams): IFingerprint => {
  const model = buildModelIdentity(provider);
  const modelIdentityHash = sha256(JSON.stringify(model));
  const json = { ...model, modelIdentityHash, chunker: { version: CHUNKER_VERSION, ...chunker } };
  return { fingerprint: sha256(JSON.stringify(json)), modelIdentityHash, json };
};

/** Запуск, поставленный до этапа 11: идентичность неполная, реконструировать её нельзя. */
export const isHistoricalIdentity = (fingerprintJson: Record<string, unknown>): boolean =>
  fingerprintJson.identityVersion !== EXECUTION_IDENTITY_VERSION;
