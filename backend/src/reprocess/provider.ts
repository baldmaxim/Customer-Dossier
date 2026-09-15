// Провайдер модели для конвейера и отпечаток параметров запуска.
//
// Интерфейс, а не прямой вызов LM Studio: интеграционные тесты подставляют
// детерминированные ответы, а реальный smoke модели проверяется отдельно и
// LOCAL_MODEL_VALIDATED по фикстурам не выставляется.

import { createHash } from 'node:crypto';

import { env } from '../config/env.js';
import { extractFromText, extractSemantic, type ILlmResult } from '../llm/client.js';
import { SYSTEM_PROMPT } from '../llm/prompt.js';
import { EXTRACT_JSON_SCHEMA, SCHEMA_VERSION, type IExtraction } from '../llm/schema.js';
import { SEMANTIC_PROMPT_VERSION, SEMANTIC_SYSTEM_PROMPT } from '../llm/semantic/prompt.js';
import { SEMANTIC_JSON_SCHEMA, SEMANTIC_SCHEMA_VERSION, type ISemanticExtraction } from '../llm/semantic/schema.js';
import { CHUNKER_VERSION } from './chunking.js';

export interface IModelProvider {
  provider: string;
  model: string;
  /** Параметры генерации, влияющие на ответ. */
  params: Record<string, unknown>;
  /** Схема ответа; не указана — extract@2 (прежние провайдеры и фикстуры). */
  schemaVersion?: string;
  extract: (text: string, publishedAt: Date | null) => Promise<ILlmResult<IExtraction | ISemanticExtraction>>;
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

export const lmStudioProvider = (): IModelProvider => ({
  provider: 'lmstudio',
  model: env.LMSTUDIO_MODEL,
  schemaVersion: env.EXTRACT_SCHEMA_VERSION,
  // Совпадает с llm/client.ts. Окно контекста задаётся в LM Studio, а не здесь;
  // размер чанка в символах — приближение к токенам с запасом, не точный лимит.
  params: { temperature: 0.1, maxTokens: 2048, contextNote: 'ctx задаётся в LM Studio; чанк в символах — приближение' },
  extract: (text, publishedAt) =>
    env.EXTRACT_SCHEMA_VERSION === SEMANTIC_SCHEMA_VERSION
      ? extractSemantic({ body: text, publishedAt })
      : extractFromText({ body: text, publishedAt }),
});

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export interface IFingerprint {
  fingerprint: string;
  json: Record<string, unknown>;
}

/** Смена промпта, схемы, модели, провайдера, параметров или нарезки — другой отпечаток. */
export const buildFingerprint = (provider: IModelProvider, chunker: IChunkerParams): IFingerprint => {
  const semantic = provider.schemaVersion === SEMANTIC_SCHEMA_VERSION;
  const json = {
    promptVersion: semantic ? `${env.PROMPT_VERSION}+${SEMANTIC_PROMPT_VERSION}` : env.PROMPT_VERSION,
    promptHash: sha256(semantic ? SEMANTIC_SYSTEM_PROMPT : SYSTEM_PROMPT),
    schemaVersion: semantic ? SEMANTIC_SCHEMA_VERSION : SCHEMA_VERSION,
    schemaHash: sha256(JSON.stringify(semantic ? SEMANTIC_JSON_SCHEMA : EXTRACT_JSON_SCHEMA)),
    provider: provider.provider,
    model: provider.model,
    params: provider.params,
    chunker: { version: CHUNKER_VERSION, ...chunker },
  };
  return { fingerprint: sha256(JSON.stringify(json)), json };
};
