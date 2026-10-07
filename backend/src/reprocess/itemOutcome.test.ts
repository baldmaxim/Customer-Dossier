// Состояние публикации словами: почему из текста «ничего не взято».
// Причины разные, и смешивать их нельзя — иначе экран молчит там, где должен объяснять.

import { describe, expect, it } from 'vitest';

import { decideItemState, decideRunOutcome } from './itemOutcome.js';

const base = { policyAllowed: true, run: null, activeSetId: null, assertions: 0 };

describe('decideItemState', () => {
  it('набор в карточках: с утверждениями — взято, без них — разные причины пустоты', () => {
    expect(decideItemState({ ...base, activeSetId: 7, assertions: 3 })).toBe('in_cards');
    expect(decideItemState({ ...base, activeSetId: 7, run: { status: 'completed', relevant: false } })).toBe('not_relevant');
    expect(decideItemState({ ...base, activeSetId: 7, run: { status: 'completed', relevant: true } })).toBe('nothing_found');
  });

  it('карточки старше отозванного допуска: взятое не прячется', () => {
    expect(decideItemState({ policyAllowed: false, run: null, activeSetId: 7, assertions: 2 })).toBe('in_cards');
  });

  it('без разбора: нет допуска — это решение, а не поломка и не пустота', () => {
    expect(decideItemState({ ...base, policyAllowed: false })).toBe('no_policy');
    expect(decideItemState(base)).toBe('no_run');
  });

  it('разбор идёт или не удался — состояние называется, а не выдаётся за «ничего нет»', () => {
    expect(decideItemState({ ...base, run: { status: 'queued', relevant: null } })).toBe('queued');
    expect(decideItemState({ ...base, run: { status: 'running', relevant: null } })).toBe('running');
    expect(decideItemState({ ...base, run: { status: 'partial', relevant: null } })).toBe('partial');
    expect(decideItemState({ ...base, run: { status: 'failed', relevant: null } })).toBe('failed');
    expect(decideItemState({ ...base, run: { status: 'cancelled', relevant: null } })).toBe('cancelled');
    // Разобрано полностью, но в карточки ещё не перенесено.
    expect(decideItemState({ ...base, run: { status: 'completed', relevant: true } })).toBe('built_not_in_cards');
  });
});

describe('decideRunOutcome — итог одного запуска (строка «Обработки», страница разбора)', () => {
  const base = { status: 'completed', relevant: true, setStatus: null, policyAllowed: true, failures: 0, retryMax: 3 };

  it('перенесённое в карточки старше выключенного источника; не перенесённое — со статусом набора', () => {
    expect(decideRunOutcome({ ...base, setStatus: 'published', policyAllowed: false })).toEqual({ state: 'in_cards', detail: null });
    expect(decideRunOutcome({ ...base, relevant: false })).toEqual({ state: 'not_relevant', detail: null });
    expect(decideRunOutcome({ ...base, setStatus: 'rejected_stale' })).toEqual({ state: 'built_not_in_cards', detail: 'rejected_stale' });
    expect(decideRunOutcome({ ...base, setStatus: 'built' })).toEqual({ state: 'built_not_in_cards', detail: null });
  });

  it('упавший — «попытки исчерпаны» по тому же порогу, что плитка failed_exhausted', () => {
    expect(decideRunOutcome({ ...base, status: 'failed', relevant: null, failures: 3 })).toEqual({ state: 'failed', detail: 'exhausted' });
    expect(decideRunOutcome({ ...base, status: 'partial', relevant: null, failures: 1 })).toEqual({ state: 'partial', detail: 'retrying' });
    expect(decideRunOutcome({ ...base, status: 'queued', relevant: null, policyAllowed: false })).toEqual({ state: 'no_policy', detail: null });
  });
});
