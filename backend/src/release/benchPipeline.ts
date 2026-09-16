// Отдельный замер конвейера на синтетике (флаг --pipeline-synthetic): сохранение публикации → запуск →
// разбор подменённой детерминированной моделью → набор кандидатов → публикация в канон.
//
// Модель НЕ вызывается: ответы — фикстура extract@3. Это время кода приложения и базы, а не скорость
// извлечения реальной LLM. Пишет в базу (синтетический источник release_bench_synthetic), только тестовая цель.

import { performance } from 'node:perf_hooks';

import { insertSyntheticSource } from '../__tests__/integration/db.js';
import { getPool } from '../db/pool.js';
import { storeDocument } from '../ingest/store.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import { answer, company, semanticProvider } from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { summarizeStep, type IBenchStep, type ISample } from './bench.js';

export const PIPELINE_BENCH_LABEL = 'synthetic/mocked model: детерминированная фикстура extract@3, реальная модель не вызывалась';

const one = async (sourceId: number, seq: string): Promise<ISample> => {
  const name = `Синтетика-Замер-${seq}`;
  const text = `ООО «${name}» получило синтетический контракт на отделку корпуса ${seq} (замер конвейера).`;
  const stored = await storeDocument({ sourceId, sourceRunId: null, externalId: `release-bench/${seq}`, url: null, title: null, body: text, publishedAt: new Date(), forwardFrom: null });
  if (!stored.revisionId) return { ok: false, status: 0, detail: `публикация не сохранена: ${stored.outcome}` };
  const provider = semanticProvider(() => answer({ companies: [company(name, text, { legal_form: 'ООО' })] }));
  const queued = await enqueueRun(getPool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'release-bench' });
  if (queued.outcome !== 'queued') return { ok: false, status: 0, detail: `запуск не поставлен: ${queued.outcome}` };
  const claim = await claimNextRun('release-bench', { runId: queued.runId });
  if (!claim) return { ok: false, status: 0, detail: 'запуск не захвачен' };
  const run = await processRun(provider, claim);
  if (run.status !== 'completed' || !run.candidateSetId) return { ok: false, status: 0, detail: `запуск ${run.status}` };
  const published = await publishCandidateSet({ setId: run.candidateSetId, expectedVersion: 0, actor: 'release-bench' });
  return published.outcome === 'published' ? { ok: true, status: 0, detail: 'опубликовано' } : { ok: false, status: 0, detail: `публикация: ${published.outcome}` };
};

export const runPipelineSyntheticBench = async (runs: number): Promise<IBenchStep> => {
  const sourceId = await insertSyntheticSource({ kind: 'manual', key: 'release_bench_synthetic', status: 'paused', access: 'approved', ai: 'approved' });
  const stamp = Date.now().toString(36);
  const time = async (seq: string) => {
    const started = performance.now();
    try {
      return { sample: await one(sourceId, seq), ms: performance.now() - started };
    } catch (err) {
      return { sample: { ok: false, status: 0, detail: `исключение: ${err instanceof Error ? err.message : String(err)}` }, ms: performance.now() - started };
    }
  };
  const warmup = (await time(`${stamp}-w`)).sample;
  const samples = [];
  for (let i = 0; i < runs; i += 1) samples.push(await time(`${stamp}-${i}`));
  return { ...summarizeStep({ code: 'pipeline_synthetic', title: `конвейер на синтетике (${PIPELINE_BENCH_LABEL})`, required: false }, warmup, samples) };
};
