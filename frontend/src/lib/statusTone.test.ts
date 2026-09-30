// Тон статуса: у каждой подписи есть тон и наоборот; решение оператора и отсутствие данных —
// не тревога. Цвет — подсветка, а не оценка (ADR-009).
import { describe, expect, it } from 'vitest';

import * as labels from './labels';
import * as tones from './statusTone';

type Dictionary = Readonly<Record<string, string>>;
type Tones = Readonly<Record<string, tones.StatusTone>>;

const PAIRS: Array<[string, Dictionary, Tones]> = [
  ['состояние источника', labels.SOURCE_HEALTH_STATE_LABELS, tones.SOURCE_HEALTH_STATE_TONE],
  ['работа сборщика', labels.SOURCE_HEALTH_LABELS, tones.SOURCE_HEALTH_TONE],
  ['статус разбора', labels.RUN_STATUS_LABELS, tones.RUN_STATUS_TONE],
  ['найденное в тексте', labels.CANDIDATE_SET_STATUS_LABELS, tones.CANDIDATE_SET_STATUS_TONE],
  ['одно найденное сведение', labels.CANDIDATE_VERDICT_LABELS, tones.CANDIDATE_VERDICT_TONE],
  ['журнал переноса', labels.PUBLICATION_ACTION_LABELS, tones.PUBLICATION_ACTION_TONE],
  ['где текст сейчас', labels.REVISION_STATE_LABELS, tones.REVISION_STATE_TONE],
  ['итог по тексту', labels.ITEM_STATE_LABELS, tones.ITEM_STATE_TONE],
  ['статус сведения', labels.ASSERTION_STATUS_LABELS, tones.ASSERTION_STATUS_TONE],
  ['проверено ли сведение', labels.REVIEW_LEVEL_LABELS, tones.REVIEW_LEVEL_TONE],
  ['неясное упоминание', labels.AMBIGUITY_STATUS_LABELS, tones.AMBIGUITY_STATUS_TONE],
];

describe('тон статуса', () => {
  it.each(PAIRS)('%s: у каждой подписи есть тон, лишних тонов нет', (_name, dictionary, toneMap) => {
    expect(Object.keys(toneMap).sort()).toEqual(Object.keys(dictionary).sort());
  });

  it('выключенный и ещё не собиравшийся источник — не тревога', () => {
    expect(tones.SOURCE_HEALTH_STATE_TONE.policy_blocked).toBe('neutral');
    expect(tones.SOURCE_HEALTH_STATE_TONE.never_run).toBe('neutral');
    expect(tones.REVISION_STATE_TONE.no_ai_permission).toBe('neutral');
    expect(tones.switchTone(false)).toBe('neutral');
  });

  it('отклонённое сведение не красное: это не оценка компании', () => {
    expect(tones.ASSERTION_STATUS_TONE.rejected).not.toBe('danger');
    expect(tones.REVIEW_LEVEL_TONE.rejected).not.toBe('danger');
  });

  it('незнакомое значение — нейтральный тон', () => {
    expect(tones.toneOf(tones.RUN_STATUS_TONE, 'status_from_the_future')).toBe('neutral');
    expect(tones.toneOf(tones.RUN_STATUS_TONE, null)).toBe('neutral');
    expect(tones.toneOf(tones.RUN_STATUS_TONE, 'completed')).toBe('success');
  });
});
