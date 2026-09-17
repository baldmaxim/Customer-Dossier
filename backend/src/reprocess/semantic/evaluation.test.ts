// Этап 14A (T14A-01…T14A-08) без сети: оценка текущей схемы на записанных ответах.

import { describe, expect, it } from 'vitest';

import type { ILlmResult } from '../../llm/client.js';
import type { ISemanticExtraction } from '../../llm/semantic/schema.js';
import { classifyExtractResult } from '../extractOutcome.js';
import type { IChunkerParams } from '../provider.js';
import { CORPUS } from './__fixtures__/corpus.js';
import { answer } from './__fixtures__/semanticAnswers.js';
import {
  DEFAULT_GATES,
  EvaluationSelectionError,
  compareReports,
  corpusHash,
  describeLegacyReport,
  REGRESSION_SPLIT,
  splitViolations,
  evaluateCase,
  selectCases,
  summarize,
  type IEvaluationReport,
  type IRecordedChunk,
} from './evaluation.js';

const usage = { tokensIn: 1, tokensOut: 1, latencyMs: 1 };
const chunker: IChunkerParams = { chunkSize: 3500, maxChunks: 6, overlap: 400 };
const okResult = (data: ISemanticExtraction): ILlmResult<ISemanticExtraction> => ({ ok: true, data, usage, rawResponse: JSON.stringify(data) });
const single = (id: string, result: IRecordedChunk['result']): IRecordedChunk[] => {
  const text = CORPUS.find(c => c.id === id)!.text;
  return [{ index: 0, start: 0, end: Array.from(text).length, result }];
};

const report = (over: Partial<IEvaluationReport['identity']> = {}, cases = CORPUS.slice(0, 3), result: (id: string) => IRecordedChunk['result'] = () => okResult(answer({}))): IEvaluationReport => {
  const recorded = Object.fromEntries(cases.map(c => [c.id, single(c.id, result(c.id))]));
  const evaluated = cases.map(c => evaluateCase(c, chunker, recorded[c.id]!));
  return {
    identity: { contract: 'current-eval@1', scoring: 'corpus-checks@1', corpusHash: corpusHash(CORPUS), executionFingerprint: 'fp', schemaVersion: 'extract@3', gates: DEFAULT_GATES, ...over },
    meta: { takenAt: '2026-09-17T00:00:00Z', mode: 'replay', modelReported: {}, code: null },
    cases: evaluated,
    recorded,
    summary: summarize(cases, evaluated, DEFAULT_GATES),
  };
};

describe('выбор кейсов (T14A-03)', () => {
  it('без селектора — все 17 кейсов регрессионного корпуса', () => {
    expect(selectCases(CORPUS, null)).toHaveLength(17);
  });
  it('пустой и неизвестный селектор — ошибка, а не «0 из 0»', () => {
    expect(() => selectCases(CORPUS, [])).toThrow(EvaluationSelectionError);
    expect(() => selectCases(CORPUS, ['SYN-99'])).toThrow(/SYN-99/);
    expect(() => selectCases([], null)).toThrow(/корпус пуст/);
  });
});

describe('знаменатель не уменьшается от ошибок (T14A-02)', () => {
  it('все кейсы с ошибкой модели — не PASS и не 100%: safety не оценена, recall не найден, план сохранён', () => {
    const cases = CORPUS;
    const recorded = cases.map(c => evaluateCase(c, chunker, single(c.id, { ok: false, failure: 'llm_error', message: 'connection refused', usage, rawResponse: null })));
    const s = summarize(cases, recorded, DEFAULT_GATES);
    const plannedSafety = cases.flatMap(c => c.checks).filter(k => k.kind === 'safety').length;
    const plannedRecall = cases.flatMap(c => c.checks).filter(k => k.kind === 'recall').length;
    expect(s.safety).toEqual({ planned: plannedSafety, passed: 0, failed: 0, notEvaluated: plannedSafety });
    expect(s.recall).toEqual({ planned: plannedRecall, passed: 0, failed: plannedRecall, notEvaluated: 0 });
    expect(s.cases.infrastructureError).toBe(17);
    expect(s.verdict).toBe('INCOMPLETE');
  });

  it('один кейс с ошибкой остаётся в плане; невыполненный кейс тоже', () => {
    const cases = CORPUS.slice(0, 3);
    const evaluated = [
      evaluateCase(cases[0]!, chunker, single(cases[0]!.id, okResult(answer({})))),
      evaluateCase(cases[1]!, chunker, single(cases[1]!.id, { ok: false, failure: 'schema_error', message: 'x', usage, rawResponse: '{}' })),
    ];
    const s = summarize(cases, evaluated, DEFAULT_GATES);
    expect(s.safety.planned + s.recall.planned).toBe(cases.flatMap(c => c.checks).length);
    expect(s.verdictReasons.join(' ')).toMatch(/не все запланированные кейсы выполнены/);
    expect(s.schemaInvalidCases).toBe(1);
  });
});

describe('паритет с конвейером (T14A-04)', () => {
  it('обрезанный вход, невалидный JSON и ошибка схемы — не ok в общей классификации и не извлечённый кейс', () => {
    const truncated: ILlmResult<ISemanticExtraction> = { ok: true, data: answer({}), usage, rawResponse: '{}', truncatedInput: true };
    expect(classifyExtractResult(truncated).outcome).toBe('truncated_input');
    const id = CORPUS[0]!.id;
    const e = evaluateCase(CORPUS[0]!, chunker, single(id, truncated));
    expect(e.status).toBe('not_publishable');
    expect(e.checks.filter(c => c.kind === 'recall').every(c => c.status === 'failed')).toBe(true);
    expect(evaluateCase(CORPUS[0]!, chunker, single(id, { ok: false, failure: 'invalid_json', message: 'обрыв', usage, rawResponse: '{' })).status).toBe('not_publishable');
    expect(evaluateCase(CORPUS[0]!, chunker, single(id, { thrown: 'The operation was aborted due to timeout' })).status).toBe('infrastructure_error');
  });

  it('несколько чанков: без ответа на один из них кейс не извлечён; непокрытый хвост — не извлечён', () => {
    const c = CORPUS.find(x => Array.from(x.text).length > 120)!;
    const small: IChunkerParams = { chunkSize: 60, maxChunks: 20, overlap: 10 };
    expect(evaluateCase(c, small, [{ index: 0, start: 0, end: 60, result: okResult(answer({})) }]).status).toBe('infrastructure_error');
    expect(evaluateCase(c, { chunkSize: 60, maxChunks: 1, overlap: 10 }, [{ index: 0, start: 0, end: 60, result: okResult(answer({})) }]).reason).toMatch(/непокрытый хвост/);
  });

  it('извлечённый пустой ответ: safety оценена, recall не найден; вердикт без порогов — REPORT_ONLY, а не PASS', () => {
    const r = report();
    expect(r.summary.cases.extracted).toBe(3);
    expect(r.summary.safety.notEvaluated).toBe(0);
    expect(r.summary.verdict).toBe(r.summary.safety.failed > 0 ? 'FAIL' : 'REPORT_ONLY');
  });
});

describe('воспроизводимость и сравнение (T14A-07, T14A-08)', () => {
  it('записанные ответы дают тот же результат без сети', () => {
    const a = report();
    const again = CORPUS.slice(0, 3).map(c => evaluateCase(c, chunker, a.recorded[c.id]!));
    expect(again).toEqual(a.cases);
  });

  it('версия корпуса меняется при правке разметки', () => {
    const changed = CORPUS.map((c, i) => (i === 0 ? { ...c, checks: [...c.checks, { label: 'новая проверка', kind: 'recall' as const, pass: () => true }] } : c));
    expect(corpusHash(changed)).not.toBe(corpusHash(CORPUS));
  });

  it('разный корпус, схема или пороги — несовместимо, а не улучшение', () => {
    expect(compareReports(report(), report({ corpusHash: 'other' })).incompatibleReasons).toContain('разный корпус или разметка');
    expect(compareReports(report(), report({ schemaVersion: 'extract@2' })).compatible).toBe(false);
    expect(compareReports(report(), report({ gates: { safetyAllPass: true, recallMinPassed: 5 } })).compatible).toBe(false);
  });

  it('парное сравнение показывает потерю safety отдельно от роста recall', () => {
    const before = report();
    const after = report({ executionFingerprint: 'fp2' }, CORPUS.slice(0, 3), () => ({ ok: false, failure: 'llm_error', message: 'down', usage, rawResponse: null }));
    const cmp = compareReports(before, after);
    expect(cmp.compatible).toBe(true);
    expect(cmp.safetyRegressions.length).toBe(before.summary.safety.passed);
  });
});

describe('отчёт прежнего формата (benchmark-06)', () => {
  it('неизвестный файл — UNKNOWN; известные поля не превращаются в диагноз', () => {
    expect(describeLegacyReport({}).format).toBe('UNKNOWN');
    const d = describeLegacyReport({ summary: { safety: { passed: 24, total: 25 } }, results: [{ id: 'SYN-04', outcome: 'ok', checks: [{ kind: 'safety', pass: false, label: 'нет договора' }] }] });
    expect(d.format).toBe('legacy-benchmark-06');
    expect(d.knownFields.failedSafetyChecks).toEqual(['SYN-04: нет договора']);
    expect(d.unknown.join(' ')).toMatch(/знаменатель/);
  });
});

describe('разбиение корпуса (T14A-06)', () => {
  it('перепечатка одного исходника под другим URL не может оказаться в holdout отдельно от dev', () => {
    expect(splitViolations([
      { id: 'A', originGroup: 'origin-1', split: 'dev', seenDuringTuning: true },
      { id: 'A-reprint', originGroup: 'origin-1', split: 'holdout', seenDuringTuning: false },
    ])).toEqual(['группа происхождения origin-1 в сплитах dev, holdout']);
  });
  it('holdout, виденный при настройке, — нарушение; 17 кейсов этапа 06 — регрессия, не holdout', () => {
    expect(splitViolations([{ id: 'B', originGroup: 'b', split: 'holdout', seenDuringTuning: true }])).toHaveLength(1);
    expect(splitViolations(REGRESSION_SPLIT)).toEqual([]);
    expect(REGRESSION_SPLIT.map(a => a.id).sort()).toEqual(CORPUS.map(c => c.id).sort());
  });
});
