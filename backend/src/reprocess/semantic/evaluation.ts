// Оценка качества ТЕКУЩЕЙ схемы извлечения (current-eval@1, этап 14A). Чистые функции, без сети и базы.
//
// Путь тот же, что у конвейера: нарезка (planCodePointChunks) → ответ модели на каждый чанк → общая классификация
// (extractOutcome.ts: обрезанный/невалидный — не ok) → покрытие (computeCoverage) → сборка и проверка кандидатов
// (buildCandidates: verify + assemble). Кейс «извлечён» только если конвейер завершил бы запуск completed.
//
// План проверок строится ДО вызова модели. Ошибка модели или неполный разбор не удаляют проверки из знаменателя:
// safety — «не оценено», recall — «не найдено». Отношения вида 24/25 — число проверок, а не проценты качества.

import { createHash } from 'node:crypto';

import type { ILlmResult } from '../../llm/client.js';
import type { IExtraction } from '../../llm/schema.js';
import type { ISemanticExtraction } from '../../llm/semantic/schema.js';
import { canonicalJson } from '../../snapshot/canonical.js';
import { buildCandidates, type ICandidateBuild } from '../candidates.js';
import { computeCoverage, planCodePointChunks } from '../chunking.js';
import { classifyExtractError, classifyExtractResult, type ChunkOutcome } from '../extractOutcome.js';
import type { IChunkerParams } from '../provider.js';
import type { ICorpusCase } from './__fixtures__/corpus.js';

export const EVALUATION_CONTRACT_VERSION = 'current-eval@1';
export const SCORING_VERSION = 'corpus-checks@1';

/** Пороги задаются до прогона. Средним значением отказ safety не компенсируется. */
export interface IGates {
  safetyAllPass: true;
  /** Минимум пройденных recall-проверок из запланированных; null — только отчёт, без решения. */
  recallMinPassed: number | null;
}

export const DEFAULT_GATES: IGates = { safetyAllPass: true, recallMinPassed: null };

export class EvaluationSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationSelectionError';
  }
}

/** Выбор кейсов: пустой или неизвестный селектор — ошибка, а не «оценено 0 из 0». */
export const selectCases = (corpus: readonly ICorpusCase[], selector: readonly string[] | null): ICorpusCase[] => {
  if (corpus.length === 0) throw new EvaluationSelectionError('корпус пуст');
  if (selector === null) return [...corpus];
  if (selector.length === 0) throw new EvaluationSelectionError('селектор кейсов пуст');
  const unknown = selector.filter(id => !corpus.some(c => c.id === id));
  if (unknown.length > 0) throw new EvaluationSelectionError(`неизвестные кейсы: ${unknown.join(', ')}`);
  return corpus.filter(c => selector.includes(c.id));
};

/** Версия корпуса: тексты, метки и виды проверок. Правка разметки — другой hash, сравнение несовместимо. */
export const corpusHash = (corpus: readonly ICorpusCase[]): string =>
  createHash('sha256')
    .update(canonicalJson(corpus.map(c => ({ id: c.id, text: c.text, checks: c.checks.map(k => ({ label: k.label, kind: k.kind })) }))), 'utf8')
    .digest('hex');

export type CheckStatus = 'passed' | 'failed' | 'not_evaluated';

export interface ICheckResult {
  label: string;
  kind: 'safety' | 'recall';
  status: CheckStatus;
  reason: string | null;
}

/** Сохраняемый ответ модели на чанк: по нему отчёт воспроизводится без сети. */
export interface IRecordedChunk {
  index: number;
  start: number;
  end: number;
  result: ILlmResult<IExtraction | ISemanticExtraction> | { thrown: string };
}

export type CaseStatus = 'extracted' | 'not_publishable' | 'infrastructure_error';

/**
 * Этап 14B: на какой стадии потерян факт (каталог ошибок качества). Стадии «текст не получен», «сущность не
 * сопоставилась» и «досье отфильтровало» на синтетическом корпусе без базы не определяются — только в сквозном прогоне.
 */
export type MissStage = 'text_coverage' | 'infrastructure' | 'output_invalid' | 'verification_rejected' | 'provider_not_extracted';

export interface IMissDiagnosis {
  label: string;
  stage: MissStage;
  /** Эвристика: по наличию отвергнутых кандидатов, без эталонного набора фактов. */
  heuristic: boolean;
  detail: string[];
}

export interface ICaseEvaluation {
  id: string;
  status: CaseStatus;
  /** Исходы чанков по общей классификации конвейера. */
  chunkOutcomes: ChunkOutcome[];
  coverageComplete: boolean;
  reason: string | null;
  checks: ICheckResult[];
  publishable: number;
  review: number;
  rejected: number;
  /** Причины непройденных recall-проверок (этап 14B). */
  missDiagnosis: IMissDiagnosis[];
}

const INFRA: ReadonlySet<ChunkOutcome> = new Set(['llm_error', 'timeout']);

/** Оценка одного кейса по записанным ответам — тот же путь, что finalizeRun конвейера. */
export const evaluateCase = (c: ICorpusCase, chunker: IChunkerParams, recorded: readonly IRecordedChunk[]): ICaseEvaluation => {
  const plan = planCodePointChunks(c.text, chunker.chunkSize, chunker.maxChunks, chunker.overlap);
  const totalChars = Array.from(c.text).length;
  const planCoverage = computeCoverage(plan, totalChars);
  const classified = plan.map(p => {
    const r = recorded.find(x => x.index === p.index);
    if (!r) return { outcome: 'llm_error' as ChunkOutcome, payload: null, raw: null, error: 'ответ на чанк не записан' };
    return 'thrown' in r.result ? classifyExtractError(new Error(r.result.thrown)) : classifyExtractResult(r.result);
  });
  const ok = plan.map((p, i) => ({ p, c: classified[i]! })).filter(x => x.c.outcome === 'ok' && x.c.payload !== null);
  const coverage = computeCoverage(ok.map(x => ({ start: x.p.start, end: x.p.end })), totalChars);
  const outcomes = classified.map(x => x.outcome);
  const complete = planCoverage.complete && ok.length === plan.length && coverage.complete;

  if (!complete) {
    const infra = outcomes.some(o => INFRA.has(o));
    const reason = !planCoverage.complete
      ? 'непокрытый хвост: лимит чанков меньше текста'
      : `исходы чанков: ${outcomes.join(', ')}`;
    return {
      id: c.id,
      status: infra ? 'infrastructure_error' : 'not_publishable',
      chunkOutcomes: outcomes,
      coverageComplete: false,
      reason,
      // Проверки остаются в знаменателе: safety не оценена, recall не найден.
      checks: c.checks.map(k => ({ label: k.label, kind: k.kind, status: k.kind === 'safety' ? 'not_evaluated' : 'failed', reason: `кейс не извлечён: ${reason}` })),
      publishable: 0,
      review: 0,
      rejected: 0,
      missDiagnosis: c.checks
        .filter(k => k.kind === 'recall')
        .map(k => ({
          label: k.label,
          stage: !planCoverage.complete ? 'text_coverage' : infra ? 'infrastructure' : 'output_invalid',
          heuristic: false,
          detail: [reason],
        })),
    };
  }

  const chars = Array.from(c.text);
  const build: ICandidateBuild = buildCandidates(
    ok.map(x => ({ chunkId: x.p.index, index: x.p.index, start: x.p.start, text: chars.slice(x.p.start, x.p.end).join(''), extraction: x.c.payload! })),
    null,
  );
  const checks: ICheckResult[] = c.checks.map(k => ({ label: k.label, kind: k.kind, status: k.pass(build) ? 'passed' : 'failed', reason: null }));
  const rejectedDetail = [
    ...build.rejected.map(r => `отброшено ${r.kind} «${r.name}»: ${r.reason}`),
    ...build.assertions.filter(a => a.rejectedReason).map(a => `${a.content.predicate}/${a.content.role ?? a.content.eventType ?? '—'}: ${a.rejectedReason}`),
  ];
  return {
    id: c.id,
    status: 'extracted',
    chunkOutcomes: outcomes,
    coverageComplete: true,
    reason: null,
    checks,
    missDiagnosis: checks
      .filter(k => k.kind === 'recall' && k.status !== 'passed')
      .map(k => ({
        label: k.label,
        stage: rejectedDetail.length > 0 ? 'verification_rejected' : 'provider_not_extracted',
        heuristic: true,
        detail: rejectedDetail,
      })),
    publishable: build.assertions.filter(a => a.grounded && !a.rejectedReason).length,
    review: build.assertions.filter(a => a.rejectedReason?.startsWith('на проверку')).length,
    rejected: build.rejected.length,
  };
};

export interface ICount {
  planned: number;
  passed: number;
  failed: number;
  notEvaluated: number;
}

export type EvaluationVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'REPORT_ONLY';

export interface IEvaluationSummary {
  cases: { planned: number; extracted: number; notPublishable: number; infrastructureError: number };
  safety: ICount;
  recall: ICount;
  schemaInvalidCases: number;
  verdict: EvaluationVerdict;
  verdictReasons: string[];
}

const count = (checks: readonly ICheckResult[], kind: 'safety' | 'recall'): ICount => {
  const own = checks.filter(c => c.kind === kind);
  return {
    planned: own.length,
    passed: own.filter(c => c.status === 'passed').length,
    failed: own.filter(c => c.status === 'failed').length,
    notEvaluated: own.filter(c => c.status === 'not_evaluated').length,
  };
};

export const summarize = (plannedCases: readonly ICorpusCase[], evaluated: readonly ICaseEvaluation[], gates: IGates): IEvaluationSummary => {
  // Знаменатель — план: кейс без оценки считается неоценённым целиком.
  const byId = new Map(evaluated.map(e => [e.id, e]));
  const checks: ICheckResult[] = plannedCases.flatMap(c =>
    byId.get(c.id)?.checks ?? c.checks.map(k => ({ label: k.label, kind: k.kind, status: 'not_evaluated' as const, reason: 'кейс не выполнялся' })),
  );
  const safety = count(checks, 'safety');
  const recall = count(checks, 'recall');
  const reasons: string[] = [];
  if (plannedCases.some(c => !byId.has(c.id))) reasons.push('не все запланированные кейсы выполнены');
  if (safety.notEvaluated > 0) reasons.push(`safety не оценена: ${safety.notEvaluated} проверок (ошибка модели или неполный разбор)`);
  if (safety.failed > 0) reasons.push(`safety нарушена: ${safety.failed} проверок`);
  if (gates.recallMinPassed !== null && recall.passed < gates.recallMinPassed) reasons.push(`recall ${recall.passed}/${recall.planned} ниже порога ${gates.recallMinPassed}`);

  const verdict: EvaluationVerdict =
    safety.failed > 0 || (gates.recallMinPassed !== null && recall.passed < gates.recallMinPassed)
      ? 'FAIL'
      : reasons.length > 0
        ? 'INCOMPLETE'
        : gates.recallMinPassed === null
          ? 'REPORT_ONLY'
          : 'PASS';
  return {
    cases: {
      planned: plannedCases.length,
      extracted: evaluated.filter(e => e.status === 'extracted').length,
      notPublishable: evaluated.filter(e => e.status === 'not_publishable').length,
      infrastructureError: evaluated.filter(e => e.status === 'infrastructure_error').length,
    },
    safety,
    recall,
    schemaInvalidCases: evaluated.filter(e => e.chunkOutcomes.some(o => o === 'schema_error' || o === 'invalid_json')).length,
    verdict,
    verdictReasons: reasons,
  };
};

export interface IEvaluationIdentity {
  contract: string;
  scoring: string;
  corpusHash: string;
  /** Полный отпечаток исполнения этапа 11 (модель, сообщения, схема, параметры, проверка, нарезка). */
  executionFingerprint: string;
  schemaVersion: string;
  gates: IGates;
}

export interface IEvaluationReport {
  identity: IEvaluationIdentity;
  meta: { takenAt: string; mode: 'model' | 'replay'; modelReported: Record<string, string>; code: string | null };
  cases: ICaseEvaluation[];
  recorded: Record<string, IRecordedChunk[]>;
  summary: IEvaluationSummary;
}

export interface IComparison {
  compatible: boolean;
  incompatibleReasons: string[];
  perCase: Array<{ id: string; label: string; kind: string; before: CheckStatus; after: CheckStatus }>;
  safetyRegressions: string[];
  recallDelta: number;
}

/** Сравнение конфигураций: корпус, scoring, гейты и схема должны совпадать; иначе — несовместимо, а не «улучшение». */
export const compareReports = (a: IEvaluationReport, b: IEvaluationReport): IComparison => {
  const reasons: string[] = [];
  if (a.identity.contract !== b.identity.contract) reasons.push('разные версии контракта оценки');
  if (a.identity.scoring !== b.identity.scoring) reasons.push('разные версии scoring');
  if (a.identity.corpusHash !== b.identity.corpusHash) reasons.push('разный корпус или разметка');
  if (a.identity.schemaVersion !== b.identity.schemaVersion) reasons.push('разные схемы извлечения');
  if (canonicalJson(a.identity.gates) !== canonicalJson(b.identity.gates)) reasons.push('разные пороги');
  if (reasons.length > 0) return { compatible: false, incompatibleReasons: reasons, perCase: [], safetyRegressions: [], recallDelta: 0 };

  const perCase: IComparison['perCase'] = [];
  for (const ca of a.cases) {
    const cb = b.cases.find(x => x.id === ca.id);
    for (const [i, check] of ca.checks.entries()) {
      const after = cb?.checks[i];
      perCase.push({ id: ca.id, label: check.label, kind: check.kind, before: check.status, after: after?.status ?? 'not_evaluated' });
    }
  }
  return {
    compatible: true,
    incompatibleReasons: [],
    perCase: perCase.filter(p => p.before !== p.after),
    safetyRegressions: perCase.filter(p => p.kind === 'safety' && p.before === 'passed' && p.after !== 'passed').map(p => `${p.id}: ${p.label}`),
    recallDelta: b.summary.recall.passed - a.summary.recall.passed,
  };
};

/** Разбор отчёта прежнего формата (benchmark-06.json): известно только то, что в нём записано. */
export const describeLegacyReport = (raw: unknown): { format: string; knownFields: Record<string, unknown>; unknown: string[] } => {
  const obj = (raw ?? {}) as { summary?: Record<string, unknown>; results?: Array<{ id?: string; checks?: Array<{ kind?: string; pass?: boolean; label?: string }>; outcome?: string }> };
  const unknown: string[] = [
    'прежний формат строил знаменатель только из выполненных кейсов: ошибки модели уменьшали число проверок',
    'execution fingerprint (сообщения, параметры, проверка) не записан — конфигурация неполна',
    'обрезанный вход засчитывался как извлечённый',
  ];
  if (!obj.summary || !Array.isArray(obj.results)) return { format: 'UNKNOWN', knownFields: {}, unknown: ['файл не похож на отчёт benchmark:model этапа 06', ...unknown] };
  const failedSafety = obj.results.flatMap(r => (r.checks ?? []).filter(c => c.kind === 'safety' && c.pass === false).map(c => `${r.id}: ${c.label}`));
  return {
    format: 'legacy-benchmark-06',
    knownFields: { ...obj.summary, modelErrorCases: obj.results.filter(r => r.outcome === 'model_error').map(r => r.id), failedSafetyChecks: failedSafety },
    unknown,
  };
};

export type CorpusSplit = 'regression' | 'dev' | 'holdout';

export interface ISplitAssignment {
  id: string;
  /** Происхождение текста: перепечатки и правки одного исходника — одна группа. */
  originGroup: string;
  split: CorpusSplit;
  /** Кейс видели при настройке промта — holdout-ом он уже не является. */
  seenDuringTuning: boolean;
}

/** Нарушения разбиения: одна группа происхождения в разных сплитах, «unseen» holdout, виденный при настройке. */
export const splitViolations = (assignments: readonly ISplitAssignment[]): string[] => {
  const violations: string[] = [];
  const byGroup = new Map<string, Set<CorpusSplit>>();
  for (const a of assignments) byGroup.set(a.originGroup, new Set([...(byGroup.get(a.originGroup) ?? []), a.split]));
  for (const [group, splits] of byGroup) if (splits.size > 1) violations.push(`группа происхождения ${group} в сплитах ${[...splits].sort().join(', ')}`);
  for (const a of assignments) if (a.split === 'holdout' && a.seenDuringTuning) violations.push(`${a.id}: holdout виден при настройке`);
  return violations;
};

/** 17 кейсов этапа 06 видели при настройке промта semantic@1: это регрессия, не holdout. */
export const REGRESSION_SPLIT: readonly ISplitAssignment[] = [
  'SYN-01', 'SYN-02', 'SYN-03', 'SYN-04', 'SYN-05', 'SYN-06', 'SYN-07', 'SYN-08', 'SYN-09',
  'SYN-10', 'SYN-11', 'SYN-12', 'SYN-13', 'SYN-14', 'SYN-15', 'SYN-16', 'SYN-17',
].map(id => ({ id, originGroup: id, split: 'regression', seenDuringTuning: true }));
