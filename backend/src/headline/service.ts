// Тема публикации локальной моделью (headline@1).
//
// Зачем отдельный проход, а не поле в разборе: тема нужна и там, где разбор упал
// или текст признан нерелевантным (именно такие посты и выглядят в ленте как
// «без заголовка»), а идентичность запусков extract@3 менять ради подписи строки
// нельзя — это потребовало бы переразбора всей базы.
//
// Что тема НЕ делает: не становится доказательством, не попадает в цитаты, не
// заменяет заголовок источника. В интерфейсе она подписана как машинная.
//
// Допуск: вызов модели по тексту источника разрешён только при действующем
// ai_processing (ingest/policy.ts) — тот же гейт, что у разбора.

import { env } from '../config/env.js';
import { getPool, query, type DbExecutor } from '../db/pool.js';
import { extractHeadline, type ILlmResult } from '../llm/client.js';
import type { IHeadline } from '../llm/headline/schema.js';
import { HEADLINE_PROMPT_VERSION } from '../llm/headline/prompt.js';
import { HEADLINE_SCHEMA_VERSION } from '../llm/headline/schema.js';
import { loadRevisionPolicy } from '../reprocess/runs.js';
import { approvedPolicySql } from '../ingest/policy.js';

export type HeadlineOutcome =
  | { outcome: 'saved'; topic: string; revisionId: number }
  | { outcome: 'exists'; topic: string; revisionId: number }
  | { outcome: 'refused_policy'; reason: string; revisionId: number }
  | { outcome: 'not_found'; revisionId: number }
  | { outcome: 'model_error'; reason: string; revisionId: number }
  | { outcome: 'disabled'; revisionId: number };

interface IRevisionRow {
  body: string;
  published_at: Date | null;
}

interface IHeadlineRow {
  topic: string;
}

/**
 * Вызов модели вынесен параметром: интеграционный тест подставляет свой и проверяет,
 * что без допуска модель не зовут вовсе. В работе всегда `extractHeadline`.
 */
export type HeadlineCaller = (input: { body: string; publishedAt: Date | null }) => Promise<ILlmResult<IHeadline>>;

const defaultCaller: HeadlineCaller = input =>
  // Строка, а не текст: большой лимит токенов здесь только продлевает ожидание.
  extractHeadline({ body: input.body, publishedAt: input.publishedAt, maxTokens: 200 });

/** Уже сохранённая тема этой редакции для текущей конфигурации: второй раз модель не зовём. */
const existingTopic = async (exec: DbExecutor, revisionId: number): Promise<string | null> =>
  (
    await exec.query<IHeadlineRow>(
      `SELECT topic FROM revision_headlines
       WHERE revision_id = $1 AND headline_version = $2 AND model = $3 AND prompt_version = $4`,
      [revisionId, HEADLINE_SCHEMA_VERSION, env.LMSTUDIO_MODEL, HEADLINE_PROMPT_VERSION],
    )
  ).rows[0]?.topic ?? null;

/**
 * Тема одной редакции. Идемпотентна: та же конфигурация — та же строка, модель не зовётся.
 * Отказ допуска и ошибка модели — исходы, а не исключения: тема не критична для карточки.
 */
export const ensureHeadline = async (revisionId: number, caller: HeadlineCaller = defaultCaller): Promise<HeadlineOutcome> => {
  if (!env.HEADLINE_ENABLED) return { outcome: 'disabled', revisionId };
  const pool = getPool();

  const known = await existingTopic(pool, revisionId);
  if (known !== null) return { outcome: 'exists', topic: known, revisionId };

  const revision = (
    await pool.query<IRevisionRow>('SELECT body, published_at FROM document_revisions WHERE id = $1', [revisionId])
  ).rows[0];
  if (!revision) return { outcome: 'not_found', revisionId };

  // Допуск проверяется перед вызовом: публичность текста основанием для ИИ-обработки не является.
  const policy = await loadRevisionPolicy(pool, revisionId);
  if (!policy) return { outcome: 'not_found', revisionId };
  if (!policy.allowed) return { outcome: 'refused_policy', reason: policy.reason ?? 'ИИ-обработка запрещена', revisionId };

  const chars = Array.from(revision.body);
  const truncated = chars.length > env.HEADLINE_INPUT_CHARS;
  const body = truncated ? chars.slice(0, env.HEADLINE_INPUT_CHARS).join('') : revision.body;

  const result = await caller({ body, publishedAt: revision.published_at });
  if (!result.ok) return { outcome: 'model_error', reason: `${result.failure}: ${result.message}`, revisionId };

  // Допуск мог быть отозван, пока модель отвечала: тему такого текста не сохраняем.
  const after = await loadRevisionPolicy(pool, revisionId);
  if (!after?.allowed) return { outcome: 'refused_policy', reason: after?.reason ?? 'источник не найден', revisionId };

  await pool.query(
    `INSERT INTO revision_headlines
       (revision_id, topic, headline_version, model, prompt_version, schema_version, input_chars, truncated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (revision_id, headline_version, model, prompt_version) DO NOTHING`,
    [
      revisionId,
      result.data.topic,
      HEADLINE_SCHEMA_VERSION,
      env.LMSTUDIO_MODEL,
      HEADLINE_PROMPT_VERSION,
      HEADLINE_SCHEMA_VERSION,
      Array.from(body).length,
      truncated || result.truncatedInput === true,
    ],
  );
  return { outcome: 'saved', topic: result.data.topic, revisionId };
};

/**
 * Редакции без темы: последняя редакция каждой публикации допущенного источника.
 * Старые редакции темы не получают — в ленте и на странице документа показывается текущая.
 */
export const revisionsWithoutHeadline = async (limit: number): Promise<number[]> => {
  const rows = await query<{ id: number }>(
    `SELECT r.id
     FROM source_items i
     JOIN sources s ON s.id = i.source_id
     JOIN document_revisions r ON r.id = i.latest_revision_id
     WHERE ${approvedPolicySql('s', 'ai_processing')}
       AND NOT EXISTS (
         SELECT 1 FROM revision_headlines h
         WHERE h.revision_id = r.id AND h.headline_version = $2 AND h.model = $3 AND h.prompt_version = $4
       )
     ORDER BY coalesce(i.published_at, i.first_observed_at) DESC, i.id DESC
     LIMIT $1`,
    [limit, HEADLINE_SCHEMA_VERSION, env.LMSTUDIO_MODEL, HEADLINE_PROMPT_VERSION],
  );
  return rows.map(r => r.id);
};

/**
 * Один проход. Отказ модели останавливает проход целиком: если LM Studio не отвечает, она
 * не ответит и на девять следующих текстов, а каждая попытка — это три захода с паузами
 * 2 и 8 секунд. Следующий тик попробует заново. Отказ допуска проход не останавливает:
 * он относится к одному источнику, а не к модели.
 */
export const runHeadlinePass = async (
  limit = env.HEADLINE_BATCH_SIZE,
  caller: HeadlineCaller = defaultCaller,
): Promise<HeadlineOutcome[]> => {
  if (!env.HEADLINE_ENABLED) return [];
  const results: HeadlineOutcome[] = [];
  for (const revisionId of await revisionsWithoutHeadline(limit)) {
    let result: HeadlineOutcome;
    try {
      result = await ensureHeadline(revisionId, caller);
    } catch (err) {
      result = { outcome: 'model_error', reason: err instanceof Error ? err.message : String(err), revisionId };
    }
    results.push(result);
    if (result.outcome === 'model_error') break;
  }
  return results;
};
