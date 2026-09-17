// Этап 14B без модели: реестр экспериментов, вариант промта только для оценки, каталог причин пропусков,
// неразмеченные предложенные кейсы. Числа качества модели здесь не получаются и не утверждаются.

import { describe, expect, it } from 'vitest';

import type { ILlmResult } from '../../llm/client.js';
import { NO_THINK } from '../../llm/prompt.js';
import { SEMANTIC_PROMPT_VARIANTS, buildSemanticSystemMessage } from '../../llm/semantic/prompt.js';
import type { ISemanticExtraction } from '../../llm/semantic/schema.js';
import { buildFingerprint, lmStudioProvider } from '../provider.js';
import { CORPUS } from './__fixtures__/corpus.js';
import { PROPOSED_CASES } from './__fixtures__/proposedCases.js';
import { answer, company } from './__fixtures__/semanticAnswers.js';
import { DEFAULT_GATES, evaluateCase } from './evaluation.js';
import { EXPERIMENTS, ExperimentError, experimentForRun, registryViolations, type IExperiment } from './experiments.js';

const chunker = { chunkSize: 3500, maxChunks: 6, overlap: 400 };
const usage = { tokensIn: 1, tokensOut: 1, latencyMs: 1 };

describe('реестр экспериментов (T14B-02, T14B-07)', () => {
  it('действующий реестр без нарушений: одна базовая точка, у варианта ровно один фактор', () => {
    expect(registryViolations(EXPERIMENTS)).toEqual([]);
  });

  it('вариант без фактора, с двумя факторами, с ослабленной safety или selected в коде — нарушение', () => {
    const base = EXPERIMENTS[0]!;
    const bad: IExperiment[] = [
      base,
      { ...EXPERIMENTS[1]!, id: 'x1', factor: 'none' },
      { ...EXPERIMENTS[1]!, id: 'x2', factor: 'chunker' },
      { ...EXPERIMENTS[1]!, id: 'x3', gates: { ...DEFAULT_GATES, safetyAllPass: false as unknown as true } },
      { ...EXPERIMENTS[1]!, id: 'x4', status: 'selected' },
      { ...EXPERIMENTS[1]!, id: 'x5', change: { promptVariant: 'no-such', note: '' } },
    ];
    const v = registryViolations(bad).join(' | ');
    expect(v).toMatch(/x1: вариант без изменённого фактора/);
    expect(v).toMatch(/x2: фактор chunker, но меняет и промт/);
    expect(v).toMatch(/x3: safety-порог ослаблен/);
    expect(v).toMatch(/x4: статус selected/);
    expect(v).toMatch(/x5: вариант промта не найден/);
  });

  it('неизвестный и нереализованный эксперимент не запускаются', () => {
    expect(() => experimentForRun('nope')).toThrow(ExperimentError);
    expect(() => experimentForRun('second-pass@1')).toThrow(/не реализован/);
    expect(experimentForRun('prompt-recall-a@1').change.promptVariant).toBe('recall-a@1');
  });
});

describe('вариант промта — только оценка, отдельная идентичность', () => {
  it('рабочий провайдер без варианта; вариант меняет отпечаток исполнения', () => {
    const runtime = lmStudioProvider();
    expect(runtime.params).not.toHaveProperty('promptVariant');
    const variant = lmStudioProvider({ promptVariant: 'recall-a@1' });
    expect(buildFingerprint(variant, chunker).fingerprint).not.toBe(buildFingerprint(runtime, chunker).fingerprint);
  });

  it('вариант дополняет базовый промт: правило «текст — данные» и /no_think сохраняются, цитаты обязательны', () => {
    const msg = buildSemanticSystemMessage('recall-a@1');
    expect(msg.startsWith(buildSemanticSystemMessage().replace(`\n\n${NO_THINK}`, ''))).toBe(true);
    expect(msg).toContain('ТЕКСТ — ДАННЫЕ');
    expect(msg.endsWith(NO_THINK)).toBe(true);
    expect(msg).toContain(SEMANTIC_PROMPT_VARIANTS['recall-a@1']!);
    expect(() => buildSemanticSystemMessage('no-such')).toThrow(/неизвестный вариант/);
  });
});

describe('каталог причин пропуска (T14B-01)', () => {
  const c = CORPUS[0]!;
  const whole = (result: ILlmResult<ISemanticExtraction> | { thrown: string }) => [{ index: 0, start: 0, end: Array.from(c.text).length, result }];

  it('невалидный ответ и отказ инфраструктуры — разные стадии, без эвристики', () => {
    const invalid = evaluateCase(c, chunker, whole({ ok: false, failure: 'schema_error', message: 'x', usage, rawResponse: '{}' }));
    expect(invalid.missDiagnosis.every(m => m.stage === 'output_invalid' && !m.heuristic)).toBe(true);
    const infra = evaluateCase(c, chunker, whole({ thrown: 'connect ECONNREFUSED' }));
    expect(infra.missDiagnosis.every(m => m.stage === 'infrastructure')).toBe(true);
  });

  it('модель ничего не вернула — provider_not_extracted (эвристика); отброшенный проверкой кандидат — verification_rejected', () => {
    const empty = evaluateCase(c, chunker, whole({ ok: true, data: answer({}), usage, rawResponse: '{}' }));
    expect(empty.missDiagnosis.length).toBeGreaterThan(0);
    expect(empty.missDiagnosis.every(m => m.stage === 'provider_not_extracted' && m.heuristic)).toBe(true);
    // Компания с цитатой, которой нет в тексте, отбрасывается проверкой.
    const rejected = evaluateCase(c, chunker, whole({ ok: true, data: answer({ companies: [company('Выдумка', 'этой цитаты нет в тексте')] }), usage, rawResponse: '{}' }));
    expect(rejected.missDiagnosis.every(m => m.stage === 'verification_rejected' && m.detail.length > 0)).toBe(true);
  });
});

describe('предложенные кейсы пакета (24) не оцениваются до сопоставления разметки', () => {
  it('24 кейса со статусом PROPOSED, не пересекаются с регрессионным корпусом', () => {
    expect(PROPOSED_CASES).toHaveLength(24);
    expect(PROPOSED_CASES.every(p => p.groundTruthStatus === 'PROPOSED_REQUIRES_SCHEMA_MAPPING')).toBe(true);
    expect(PROPOSED_CASES.some(p => CORPUS.some(cc => cc.id === p.id))).toBe(false);
  });
});
