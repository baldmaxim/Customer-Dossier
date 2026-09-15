// Замер настроенной локальной модели на синтетическом корпусе этапа 06.
//
//   npm run benchmark:model                  — все случаи корпуса
//   npm run benchmark:model -- --case SYN-05 — один случай
//   npm run benchmark:model -- --out report.json
//
// Отправляет в LM Studio только вымышленные тексты корпуса; базу не открывает, источники не трогает.
// Это не precision/recall: 17 синтетических текстов и машинные критерии. Нарушения safety — ошибки
// смысла, которые верификатор не поймал; recall — чего модель не нашла. Пороги по итогам не меняются.

import fs from 'node:fs';

import { env } from '../../config/env.js';
import { checkLlmConnection, extractSemantic } from '../../llm/client.js';
import { SEMANTIC_PROMPT_VERSION } from '../../llm/semantic/prompt.js';
import { SEMANTIC_SCHEMA_VERSION } from '../../llm/semantic/schema.js';
import { buildCandidates } from '../candidates.js';
import { CORPUS } from './__fixtures__/corpus.js';

interface ICaseResult {
  id: string;
  outcome: 'ok' | 'model_error';
  error: string | null;
  latencyMs: number;
  checks: Array<{ label: string; kind: string; pass: boolean }>;
  publishable: number;
  review: number;
  rejected: number;
}

const argValue = (flag: string): string | null => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
};

const main = async (): Promise<void> => {
  const connection = await checkLlmConnection();
  if (!connection.ok) {
    console.error(`[benchmark] LM Studio недоступен: ${connection.error}. Замер NOT_RUN.`);
    process.exitCode = 1;
    return;
  }
  const only = argValue('--case');
  const cases = CORPUS.filter(c => !only || c.id === only);
  const results: ICaseResult[] = [];

  for (const c of cases) {
    const started = Date.now();
    const answer = await extractSemantic({ body: c.text, publishedAt: null });
    const latencyMs = Date.now() - started;
    if (!answer.ok) {
      results.push({ id: c.id, outcome: 'model_error', error: `${answer.failure}: ${answer.message}`, latencyMs, checks: [], publishable: 0, review: 0, rejected: 0 });
      console.log(`${c.id}  ошибка модели: ${answer.failure}`);
      continue;
    }
    const build = buildCandidates([{ chunkId: 0, index: 0, start: 0, text: c.text, extraction: answer.data }], null);
    const checks = c.checks.map(check => ({ label: check.label, kind: check.kind, pass: check.pass(build) }));
    const result: ICaseResult = {
      id: c.id,
      outcome: 'ok',
      error: answer.truncatedInput ? 'ответ на укороченном тексте' : null,
      latencyMs,
      checks,
      publishable: build.assertions.filter(a => a.grounded && !a.rejectedReason).length,
      review: build.assertions.filter(a => a.rejectedReason?.startsWith('на проверку')).length,
      rejected: build.rejected.length,
    };
    results.push(result);
    const failed = checks.filter(x => !x.pass);
    console.log(
      `${c.id}  ${(latencyMs / 1000).toFixed(1)} с  публикуемых ${result.publishable}, на проверку ${result.review}, отброшено ${result.rejected}` +
        (failed.length ? `\n    не выполнено: ${failed.map(x => `[${x.kind}] ${x.label}`).join('; ')}` : '  все критерии'),
    );
  }

  const all = results.flatMap(r => r.checks);
  const summary = {
    model: env.LMSTUDIO_MODEL,
    schema: SEMANTIC_SCHEMA_VERSION,
    prompt: SEMANTIC_PROMPT_VERSION,
    cases: results.length,
    modelErrors: results.filter(r => r.outcome === 'model_error').length,
    safety: { passed: all.filter(x => x.kind === 'safety' && x.pass).length, total: all.filter(x => x.kind === 'safety').length },
    recall: { passed: all.filter(x => x.kind === 'recall' && x.pass).length, total: all.filter(x => x.kind === 'recall').length },
    medianLatencyMs: [...results.map(r => r.latencyMs)].sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null,
    note: 'синтетический корпус, не оценка precision/recall на реальных данных',
  };
  console.log(
    `\n[benchmark] ${summary.model} ${summary.schema}/${summary.prompt}: safety ${summary.safety.passed}/${summary.safety.total}, ` +
      `recall ${summary.recall.passed}/${summary.recall.total}, ошибок модели ${summary.modelErrors}, медиана ${summary.medianLatencyMs} мс`,
  );
  const out = argValue('--out');
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2), 'utf8');
    console.log(`[benchmark] отчёт: ${out}`);
  }
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(err => {
    console.error('[benchmark] прервано:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
