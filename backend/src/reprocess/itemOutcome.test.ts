// Состояние публикации словами: почему из текста «ничего не взято».
// Причины разные, и смешивать их нельзя — иначе экран молчит там, где должен объяснять.

import { describe, expect, it } from 'vitest';

import { decideItemState } from './itemOutcome.js';

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
