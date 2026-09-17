// Оценка текущей конфигурации извлечения на синтетическом корпусе (current-eval@1, этап 14A).
//
//   npm run benchmark:model [-- --experiment ID] [-- --case SYN-05,SYN-07] [-- --out report.json] — вызвать настроенную модель
//                                                                              (ID из experiments.ts; по умолчанию baseline-semantic@1)
//   npm run benchmark:model -- --replay report.json [-- --out new.json]        — пересчитать по сохранённым ответам, без сети
//   npm run benchmark:model -- --compare before.json after.json                 — парное сравнение двух отчётов
//   npm run benchmark:model -- --import-legacy benchmark-06.json                — разбор отчёта прежнего формата
//
// Путь тот же, что у конвейера extract@3 (evaluation.ts). В модель уходят только вымышленные тексты корпуса; база не
// открывается. Это не precision/recall на реальных данных и не валидация модели. Пороги задаются до прогона.
// Exit 1: неизвестный/пустой выбор кейсов, вердикт FAIL/INCOMPLETE, несовместимое сравнение, недоступная модель.

import fs from 'node:fs';

import { env } from '../../config/env.js';
import { checkLlmConnection } from '../../llm/client.js';
import { SEMANTIC_SCHEMA_VERSION } from '../../llm/semantic/schema.js';
import { planCodePointChunks } from '../chunking.js';
import { buildFingerprint, buildModelIdentity, defaultChunkerParams, lmStudioProvider, type IChunkerParams } from '../provider.js';
import { CORPUS } from './__fixtures__/corpus.js';
import { PROPOSED_CASES, PROPOSED_CASES_VERSION } from './__fixtures__/proposedCases.js';
import { experimentForRun } from './experiments.js';
import {
  DEFAULT_GATES,
  EVALUATION_CONTRACT_VERSION,
  SCORING_VERSION,
  compareReports,
  corpusHash,
  describeLegacyReport,
  evaluateCase,
  selectCases,
  summarize,
  type IEvaluationReport,
  type IRecordedChunk,
} from './evaluation.js';

const argv = process.argv.slice(2);
const argValue = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const printSummary = (report: IEvaluationReport): void => {
  const s = report.summary;
  console.log(`[eval] ${report.identity.contract} · ${report.identity.schemaVersion} · корпус ${report.identity.corpusHash.slice(0, 12)}… · исполнение ${report.identity.executionFingerprint.slice(0, 12)}… · режим ${report.meta.mode}`);
  console.log(`[eval] кейсов ${s.cases.planned}: извлечено ${s.cases.extracted}, не публикуемо ${s.cases.notPublishable}, отказ инфраструктуры ${s.cases.infrastructureError}; невалидная схема в ${s.schemaInvalidCases}`);
  console.log(`[eval] safety: пройдено ${s.safety.passed}, нарушено ${s.safety.failed}, не оценено ${s.safety.notEvaluated} из ${s.safety.planned} запланированных`);
  console.log(`[eval] recall: найдено ${s.recall.passed} из ${s.recall.planned} запланированных (не найдено ${s.recall.failed})`);
  console.log(`[eval] вердикт ${s.verdict}${s.verdictReasons.length ? `: ${s.verdictReasons.join('; ')}` : ''}`);
  for (const c of report.cases) {
    const failed = c.checks.filter(x => x.status !== 'passed');
    console.log(`  ${c.id} ${c.status}${c.reason ? ` (${c.reason})` : ''}${failed.length ? ` — ${failed.map(x => `[${x.kind}:${x.status}] ${x.label}`).join('; ')}` : ''}`);
    for (const m of c.missDiagnosis ?? []) console.log(`      пропуск «${m.label}»: ${m.stage}${m.heuristic ? ' (эвристика)' : ''}${m.detail.length ? ` — ${m.detail.slice(0, 3).join('; ')}` : ''}`);
  }
};

const writeOut = (report: unknown): void => {
  const out = argValue('--out');
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`[eval] отчёт: ${out}`);
  }
};

const selector = (): string[] | null => {
  const raw = argValue('--case');
  if (argv.includes('--case') && (raw === null || raw.startsWith('--'))) return [];
  return raw === null ? null : raw.split(',').map(s => s.trim()).filter(Boolean);
};

const finish = (report: IEvaluationReport): void => {
  printSummary(report);
  writeOut(report);
  if (report.summary.verdict === 'FAIL' || report.summary.verdict === 'INCOMPLETE') process.exitCode = 1;
};

const runModel = async (): Promise<void> => {
  const cases = selectCases(CORPUS, selector());
  experimentForRun(argValue('--experiment') ?? 'baseline-semantic@1');
  const connection = await checkLlmConnection();
  if (!connection.ok) {
    console.error(`[eval] LM Studio недоступен: ${connection.error}. Оценка NOT_RUN.`);
    process.exitCode = 1;
    return;
  }
  const experiment = experimentForRun(argValue('--experiment') ?? 'baseline-semantic@1');
  const provider = lmStudioProvider({ promptVariant: experiment.change.promptVariant ?? null });
  const chunker: IChunkerParams = defaultChunkerParams();
  console.log(`[eval] эксперимент ${experiment.id} (${experiment.factor}): ${experiment.change.note}`);
  const recorded: Record<string, IRecordedChunk[]> = {};
  for (const c of cases) {
    recorded[c.id] = [];
    for (const p of planCodePointChunks(c.text, chunker.chunkSize, chunker.maxChunks, chunker.overlap)) {
      try {
        recorded[c.id]!.push({ index: p.index, start: p.start, end: p.end, result: await provider.extract(p.text, null) });
      } catch (err) {
        recorded[c.id]!.push({ index: p.index, start: p.start, end: p.end, result: { thrown: err instanceof Error ? err.message : String(err) } });
      }
    }
  }
  const evaluated = cases.map(c => evaluateCase(c, chunker, recorded[c.id]!));
  finish({
    identity: {
      contract: EVALUATION_CONTRACT_VERSION,
      scoring: SCORING_VERSION,
      corpusHash: corpusHash(CORPUS),
      executionFingerprint: buildFingerprint(provider, chunker).fingerprint,
      schemaVersion: provider.schemaVersion ?? 'extract@2',
      gates: DEFAULT_GATES,
    },
    meta: {
      takenAt: new Date().toISOString(),
      mode: 'model',
      modelReported: { ...(buildModelIdentity(provider).serverReported as Record<string, string>), model: env.LMSTUDIO_MODEL, loadedModels: connection.models.join(','), experiment: experiment.id, proposedCases: `${PROPOSED_CASES_VERSION}: ${PROPOSED_CASES.length} не оцениваются (разметка не сопоставлена со схемой)` },
      code: null,
    },
    cases: evaluated,
    recorded,
    summary: summarize(cases, evaluated, DEFAULT_GATES),
  });
  if (provider.schemaVersion !== SEMANTIC_SCHEMA_VERSION) console.log('[eval] ВНИМАНИЕ: EXTRACT_SCHEMA_VERSION не extract@3 — оценивается не текущая схема по умолчанию');
};

const replay = (file: string): void => {
  const prior = JSON.parse(fs.readFileSync(file, 'utf8')) as IEvaluationReport;
  const cases = selectCases(CORPUS, prior.cases.map(c => c.id));
  const chunker: IChunkerParams = defaultChunkerParams();
  const evaluated = cases.map(c => evaluateCase(c, chunker, prior.recorded[c.id] ?? []));
  finish({
    identity: { ...prior.identity, contract: EVALUATION_CONTRACT_VERSION, scoring: SCORING_VERSION, corpusHash: corpusHash(CORPUS), gates: DEFAULT_GATES },
    meta: { ...prior.meta, takenAt: new Date().toISOString(), mode: 'replay' },
    cases: evaluated,
    recorded: prior.recorded,
    summary: summarize(cases, evaluated, DEFAULT_GATES),
  });
};

const main = async (): Promise<void> => {
  const compareIdx = argv.indexOf('--compare');
  if (compareIdx >= 0) {
    const [a, b] = [argv[compareIdx + 1], argv[compareIdx + 2]];
    if (!a || !b) throw new Error('--compare ожидает два файла');
    const cmp = compareReports(JSON.parse(fs.readFileSync(a, 'utf8')) as IEvaluationReport, JSON.parse(fs.readFileSync(b, 'utf8')) as IEvaluationReport);
    if (!cmp.compatible) {
      console.log(`[eval] НЕСОВМЕСТИМО: ${cmp.incompatibleReasons.join('; ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[eval] recall: ${cmp.recallDelta >= 0 ? '+' : ''}${cmp.recallDelta}; потери safety: ${cmp.safetyRegressions.length}`);
    for (const r of cmp.safetyRegressions) console.log(`  SAFETY ↓ ${r}`);
    for (const p of cmp.perCase) console.log(`  ${p.id} [${p.kind}] ${p.label}: ${p.before} → ${p.after}`);
    writeOut(cmp);
    return;
  }
  const legacy = argValue('--import-legacy');
  if (legacy) {
    const described = describeLegacyReport(JSON.parse(fs.readFileSync(legacy, 'utf8')));
    console.log(JSON.stringify(described, null, 2));
    writeOut(described);
    return;
  }
  const replayFile = argValue('--replay');
  if (replayFile) return replay(replayFile);
  return runModel();
};

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(err => {
    console.error('[eval] прервано:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
