// Сравнение моделей на одних и тех же документах.
//
// Выбор между 8B и 4B шёл по впечатлениям: «8B качественнее, но таймаутит»,
// «4B стабильнее, но чаще говорит нерелевантно». Впечатления не отвечают на
// главный вопрос — на каких именно документах модели расходятся и кто прав.
//
// Схема это уже позволяет: модель входит в ключ идемпотентности extractions,
// поэтому разборы двух моделей одного документа хранятся рядом и не мешают
// друг другу. Нужно только наполнить вторую сторону и посчитать расхождения.

import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { extractFromText } from '../llm/client.js';
import { recordExtraction, splitIntoChunks } from './worker.js';

export interface IShadowResult {
  processed: number;
  failed: number;
}

/**
 * Теневой прогон текущей модели по уже разобранным документам.
 *
 * Результат пишется ТОЛЬКО в extractions: канон не трогается, статус документа
 * не меняется. Иначе в карточках смешались бы факты двух моделей, и сравнивать
 * стало бы нечего — а откатить такое смешение нельзя.
 */
export const runShadowExtraction = async (
  limit: number,
  sourceKey: string | null,
): Promise<IShadowResult> => {
  const docs = await query<{ id: number; body: string; published_at: Date | null }>(
    `SELECT d.id, d.body, d.published_at
     FROM raw_documents d
     WHERE d.status IN ('extracted', 'skipped')
       AND ($2::text IS NULL OR d.source_id IN (SELECT id FROM sources WHERE key = $2::text))
       AND NOT EXISTS (
         SELECT 1 FROM extractions e
         WHERE e.document_id = d.id AND e.model = $1 AND e.prompt_version = $3
       )
     ORDER BY d.id DESC
     LIMIT $4`,
    [env.LMSTUDIO_MODEL, sourceKey, env.PROMPT_VERSION, limit],
  );

  const result: IShadowResult = { processed: 0, failed: 0 };

  for (const doc of docs) {
    let anyOk = false;
    for (const [index, chunk] of splitIntoChunks(doc.body).entries()) {
      const extraction = await extractFromText({ body: chunk, publishedAt: doc.published_at });
      if (extraction.ok) {
        anyOk = true;
        await recordExtraction(doc.id, index, 'ok', extraction.data, null, extraction.usage);
      } else {
        await recordExtraction(
          doc.id,
          index,
          extraction.failure,
          null,
          extraction.rawResponse ?? extraction.message,
          extraction.usage,
        );
      }
    }
    result.processed += 1;
    if (!anyOk) result.failed += 1;
    console.log(`[shadow] док ${doc.id}: ${anyOk ? 'ok' : 'ошибка'}`);
  }

  return result;
};

export interface IModelStats {
  model: string;
  documents: number;
  /** Доля документов, где хотя бы один чанк разобран без ошибки. */
  okRate: number;
  /** Доля признанных релевантными среди разобранных. */
  relevantRate: number;
  avgCompanies: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

export interface IDisagreement {
  documentId: number;
  sourceTitle: string;
  preview: string;
}

export interface IPairComparison {
  modelA: string;
  modelB: string;
  overlap: number;
  agreement: number;
  /** A считает релевантным, B — нет. */
  onlyA: IDisagreement[];
  /** B считает релевантным, A — нет. */
  onlyB: IDisagreement[];
}

export interface IComparison {
  models: IModelStats[];
  pair: IPairComparison | null;
}

/**
 * Итог по документу для одной модели: релевантность решается по любому чанку,
 * как в основном пайплайне (mergeChunkExtractions). Иначе сравнение считало бы
 * не то, что реально уходит в канон.
 */
const PER_DOC_CTE = `
  per_doc AS (
    SELECT e.document_id, e.model,
           bool_or((e.payload->>'doc_relevant')::boolean)                       AS relevant,
           bool_or(e.status = 'ok')                                              AS any_ok,
           sum(jsonb_array_length(coalesce(e.payload->'companies', '[]'::jsonb))) AS companies,
           avg(e.latency_ms)                                                     AS latency,
           max(e.latency_ms)                                                     AS max_latency
    FROM extractions e
    WHERE e.prompt_version = $1
    GROUP BY e.document_id, e.model
  )`;

export const compareModels = async (): Promise<IComparison> => {
  const models = await query<{
    model: string;
    documents: number;
    ok_rate: number;
    relevant_rate: number;
    avg_companies: number;
    avg_latency: number;
    max_latency: number;
  }>(
    `WITH ${PER_DOC_CTE}
     SELECT model,
            count(*)::int                                                        AS documents,
            avg(CASE WHEN any_ok THEN 1.0 ELSE 0.0 END)                           AS ok_rate,
            avg(CASE WHEN relevant THEN 1.0 ELSE 0.0 END) FILTER (WHERE any_ok)   AS relevant_rate,
            avg(companies) FILTER (WHERE relevant)                                AS avg_companies,
            avg(latency)                                                          AS avg_latency,
            max(max_latency)                                                      AS max_latency
     FROM per_doc
     GROUP BY model
     ORDER BY documents DESC`,
    [env.PROMPT_VERSION],
  );

  const stats: IModelStats[] = models.map(m => ({
    model: m.model,
    documents: m.documents,
    okRate: Number(m.ok_rate ?? 0),
    relevantRate: Number(m.relevant_rate ?? 0),
    avgCompanies: Number(m.avg_companies ?? 0),
    avgLatencyMs: Math.round(Number(m.avg_latency ?? 0)),
    maxLatencyMs: Math.round(Number(m.max_latency ?? 0)),
  }));

  if (stats.length < 2) return { models: stats, pair: null };

  // Сравниваем две модели с наибольшим числом документов.
  const [a, b] = stats as [IModelStats, IModelStats];

  const rows = await query<{
    document_id: number;
    rel_a: boolean | null;
    rel_b: boolean | null;
    source_title: string;
    body: string;
  }>(
    `WITH ${PER_DOC_CTE}
     SELECT pa.document_id,
            pa.relevant AS rel_a,
            pb.relevant AS rel_b,
            s.title     AS source_title,
            d.body
     FROM per_doc pa
     JOIN per_doc pb      ON pb.document_id = pa.document_id AND pb.model = $3
     JOIN raw_documents d ON d.id = pa.document_id
     JOIN sources s       ON s.id = d.source_id
     WHERE pa.model = $2 AND pa.any_ok AND pb.any_ok`,
    [env.PROMPT_VERSION, a.model, b.model],
  );

  const toDisagreement = (r: (typeof rows)[number]): IDisagreement => ({
    documentId: r.document_id,
    sourceTitle: r.source_title,
    preview: r.body.replace(/\s+/g, ' ').slice(0, 140),
  });

  const agreed = rows.filter(r => Boolean(r.rel_a) === Boolean(r.rel_b)).length;

  return {
    models: stats,
    pair: {
      modelA: a.model,
      modelB: b.model,
      overlap: rows.length,
      agreement: rows.length === 0 ? 0 : agreed / rows.length,
      onlyA: rows.filter(r => r.rel_a && !r.rel_b).map(toDisagreement),
      onlyB: rows.filter(r => !r.rel_a && r.rel_b).map(toDisagreement),
    },
  };
};
