// Чистая логика 03A: offsets в code points, ключ содержания, состояние утверждения.

import { describe, it, expect } from 'vitest';

import {
  assertionContentKey,
  deriveAssertionState,
  evidenceSetHash,
  type IAssertionContent,
  type IEvidenceRef,
} from './model.js';
import { findQuoteSpans, locateQuote, sliceByCodePoints } from './span.js';

describe('span — code points (TC-024)', () => {
  it('кириллица: offsets совпадают с символами', () => {
    const body = 'Компания «Демо-Альфа» ведёт монтаж';
    const location = locateQuote(body, '«Демо-Альфа»');
    expect(location).toMatchObject({ kind: 'unique', span: { start: 9, end: 21, quote: '«Демо-Альфа»' } });
  });

  it('эмодзи — один символ, суррогатная пара не разрывается', () => {
    const body = '🏗️ Старт работ на корпусе 2 🚧 объявлен';
    const location = locateQuote(body, 'корпусе 2');
    expect(location.kind).toBe('unique');
    if (location.kind !== 'unique') return;
    // 🏗 (1) + VS16 (1) + пробел + «Старт работ на » = 18 символов до цитаты.
    expect(location.span.start).toBe(Array.from('🏗️ Старт работ на ').length);
    expect(sliceByCodePoints(body, location.span)?.quote).toBe('корпусе 2');
  });

  it('неразрывный пробел не приравнивается к обычному: исходник не нормализуется', () => {
    const body = 'срок — IV квартал';
    expect(locateQuote(body, 'срок — IV').kind).toBe('not_found');
    expect(locateQuote(body, 'срок — IV').kind).toBe('unique');
  });

  it('повторяющаяся цитата не привязывается к первому вхождению', () => {
    const body = 'Демо-Альфа — генподрядчик. Позже: Демо-Альфа — генподрядчик.';
    expect(findQuoteSpans(body, 'Демо-Альфа — генподрядчик')).toHaveLength(2);
    expect(locateQuote(body, 'Демо-Альфа — генподрядчик')).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('контекст вокруг фрагмента различает одинаковые цитаты', () => {
    const body = 'А'.repeat(100) + 'цитата' + 'Б'.repeat(100);
    const span = sliceByCodePoints(body, { start: 100, end: 106 })!;
    expect(span.contextBefore).toBe('А'.repeat(80));
    expect(span.contextAfter).toBe('Б'.repeat(80));
  });

  it('выход за границы — null', () => {
    expect(sliceByCodePoints('abc', { start: 2, end: 5 })).toBeNull();
    expect(sliceByCodePoints('abc', { start: 2, end: 2 })).toBeNull();
  });
});

const content = (over: Partial<IAssertionContent> = {}): IAssertionContent => ({
  predicate: 'participates_in_project',
  role: 'contractor',
  eventType: null,
  subjectCompanyId: 1,
  subjectProjectId: null,
  subjectText: null,
  objectCompanyId: null,
  objectProjectId: 10,
  objectText: null,
  counterpartyCompanyId: null,
  scopeBuilding: null,
  workPackage: null,
  validFrom: null,
  validTo: null,
  periodPrecision: 'unknown',
  modality: 'unknown',
  valueType: null,
  valueNumeric: null,
  valueCurrency: null,
  ...over,
});

describe('assertionContentKey', () => {
  it('одинаковое содержание — одинаковый ключ (два документа подтверждают одну связь)', () => {
    expect(assertionContentKey(content())).toBe(assertionContentKey(content()));
  });

  it('корпус, модальность, период и роль меняют смысл', () => {
    const base = assertionContentKey(content());
    expect(assertionContentKey(content({ scopeBuilding: 'корпус 2' }))).not.toBe(base);
    expect(assertionContentKey(content({ modality: 'planned' }))).not.toBe(base);
    expect(assertionContentKey(content({ modality: 'negated' }))).not.toBe(base);
    expect(assertionContentKey(content({ validFrom: '2026-06-01' }))).not.toBe(base);
    expect(assertionContentKey(content({ role: 'general_contractor' }))).not.toBe(base);
  });
});

const ev = (id: number, stance: IEvidenceRef['stance'], status: IEvidenceRef['status'] = 'active'): IEvidenceRef => ({
  id,
  stance,
  status,
});

describe('deriveAssertionState', () => {
  it('без решения: поддерживающее доказательство — text_grounded, иначе candidate', () => {
    expect(deriveAssertionState([ev(1, 'supports')], null)).toEqual({ status: 'text_grounded', needsRevalidation: false });
    expect(deriveAssertionState([ev(1, 'mentions')], null).status).toBe('candidate');
    expect(deriveAssertionState([ev(1, 'supports', 'withdrawn')], null).status).toBe('candidate');
  });

  it('решение сохраняется, пока набор доказательств прежний', () => {
    const evidence = [ev(1, 'supports'), ev(2, 'supports')];
    const state = deriveAssertionState(evidence, { decision: 'reviewed_supported', evidenceSetHash: evidenceSetHash(evidence) });
    expect(state).toEqual({ status: 'reviewed_supported', needsRevalidation: false });
  });

  it('отзыв одного доказательства: решение остаётся, нужен пересмотр (TC-019)', () => {
    const atDecision = [ev(1, 'supports'), ev(2, 'supports')];
    const now = [ev(1, 'supports', 'withdrawn'), ev(2, 'supports')];
    const state = deriveAssertionState(now, { decision: 'reviewed_supported', evidenceSetHash: evidenceSetHash(atDecision) });
    expect(state).toEqual({ status: 'reviewed_supported', needsRevalidation: true });
  });

  it('новое опровержение тоже требует пересмотра (TC-021)', () => {
    const atDecision = [ev(1, 'supports')];
    const now = [ev(1, 'supports'), ev(3, 'contradicts')];
    expect(
      deriveAssertionState(now, { decision: 'reviewed_supported', evidenceSetHash: evidenceSetHash(atDecision) }).needsRevalidation,
    ).toBe(true);
  });

  it('решение «candidate» снимает оценку', () => {
    const evidence = [ev(1, 'supports')];
    expect(deriveAssertionState(evidence, { decision: 'candidate', evidenceSetHash: evidenceSetHash(evidence) })).toEqual({
      status: 'text_grounded',
      needsRevalidation: false,
    });
  });

  it('хэш набора не зависит от порядка и не учитывает отозванные', () => {
    expect(evidenceSetHash([ev(2, 'supports'), ev(1, 'contradicts')])).toBe(
      evidenceSetHash([ev(1, 'contradicts'), ev(2, 'supports'), ev(9, 'supports', 'withdrawn')]),
    );
  });
});
