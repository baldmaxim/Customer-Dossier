// Классификация ответа модели на чанк — одна логика для конвейера (runs.ts) и оценки качества (semantic/evaluation.ts).
// Этап 14A: оценщик не может считать успехом то, что конвейер отверг бы (обрезанный вход, невалидный JSON, ошибка схемы).

import type { ILlmResult } from '../llm/client.js';
import type { IExtraction } from '../llm/schema.js';
import type { ISemanticExtraction } from '../llm/semantic/schema.js';

export type ChunkOutcome = 'ok' | 'invalid_json' | 'schema_error' | 'llm_error' | 'timeout' | 'truncated_input';

export interface IClassifiedResult {
  outcome: ChunkOutcome;
  payload: IExtraction | ISemanticExtraction | null;
  raw: string | null;
  error: string | null;
}

/** Ответ на укороченном тексте описывает не весь чанк — не ok. Таймаут отделён от прочих отказов. */
export const classifyExtractResult = (result: ILlmResult<IExtraction | ISemanticExtraction>): IClassifiedResult => {
  if (result.ok && result.truncatedInput) {
    return { outcome: 'truncated_input', payload: null, raw: result.rawResponse, error: 'ответ получен на укороченном тексте и описывает не весь чанк' };
  }
  if (result.ok) return { outcome: 'ok', payload: result.data, raw: null, error: null };
  return {
    outcome: /timeout|timed out|aborted/i.test(result.message) ? 'timeout' : result.failure,
    payload: null,
    raw: result.rawResponse,
    error: result.message,
  };
};

export const isTimeoutError = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|timed out/i.test(err.message));

/** Исключение вызова — тот же исход, что в конвейере: timeout или llm_error. */
export const classifyExtractError = (err: unknown): IClassifiedResult => ({
  outcome: isTimeoutError(err) ? 'timeout' : 'llm_error',
  payload: null,
  raw: null,
  error: err instanceof Error ? err.message : String(err),
});
