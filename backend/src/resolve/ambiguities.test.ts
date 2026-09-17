// Этап 15A без БД: проверка выбора кандидата, окна текста, курсор, токен предпросмотра слияния, контракт запроса решения.

import { describe, expect, it } from 'vitest';

import { ambiguityDecisionSchema } from '../api/entities.routes.js';
import {
  checkAmbiguityChoice,
  decisionRequestHash,
  decodeCursor,
  identifiersIn,
  mentionWindows,
  type IAmbiguityCandidate,
} from './ambiguities.js';
import { previewTokenOf } from './entityMerge.js';

const INN_A = '7707083893';
const INN_B = '7736050003';

const candidate = (over: Partial<IAmbiguityCandidate> & { id: number }): IAmbiguityCandidate => ({
  name: 'Альфа',
  mergedIntoId: null,
  legalForm: 'ООО',
  entityType: 'legal_entity',
  city: null,
  identifiers: [],
  ...over,
});

const twoLlc = [
  candidate({ id: 1, identifiers: [{ type: 'RU:inn', value: INN_A }] }),
  candidate({ id: 2, identifiers: [{ type: 'RU:inn', value: INN_B }] }),
];

const check = (body: string | null, chosenId: number, candidates = twoLlc, surface = 'ООО «Альфа»') =>
  checkAmbiguityChoice({ kind: 'company', surface, body, candidateIds: candidates.map(c => c.id), candidates, chosenId });

describe('выбор кандидата для одного упоминания (T15A-01…03)', () => {
  it('два ООО с разными ИНН: ИНН второго рядом с упоминанием запрещает выбрать первого', () => {
    const body = `Генподрядчик ООО «Альфа» (ИНН ${INN_B}) начал работы.`;
    const wrong = check(body, 1);
    expect(wrong.conflicts.map(c => c.code)).toEqual(['identifier_other_candidate', 'identifier_mismatch']);
    expect(check(body, 2).conflicts).toEqual([]);
    expect(wrong.textIdentifiers).toEqual([{ type: 'inn', value: INN_B }]);
  });

  it('реквизит далеко от упоминания не влияет; без реквизита выбор разрешён', () => {
    const far = `ООО «Альфа» начало работы.${' '.repeat(400)}Другая компания, ИНН ${INN_B}.`;
    expect(check(far, 1).conflicts).toEqual([]);
    expect(check('ООО «Альфа» начало работы.', 1).conflicts).toEqual([]);
  });

  it('не кандидат и слитая сущность — отказ', () => {
    expect(check('ООО «Альфа»', 99).conflicts.map(c => c.code)).toEqual(['not_candidate']);
    const merged = [candidate({ id: 1, mergedIntoId: 5 }), candidate({ id: 2 })];
    expect(check('ООО «Альфа»', 1, merged).conflicts.map(c => c.code)).toEqual(['candidate_merged']);
  });

  it('правовая форма в упоминании противоречит кандидату — отказ', () => {
    const forms = [candidate({ id: 1, legalForm: 'АО' }), candidate({ id: 2, legalForm: 'ООО' })];
    expect(check('ООО «Альфа» строит', 1, forms).conflicts.map(c => c.code)).toEqual(['legal_form_conflict']);
    expect(check('ООО «Альфа» строит', 2, forms).conflicts).toEqual([]);
  });

  it('без редакции и без дословного вхождения — пометка, что реквизиты не проверены; город не сверяется', () => {
    expect(check(null, 1).notes.join(' ')).toMatch(/редакция упоминания не сохранена/);
    expect(check('текст без упоминания', 1).notes.join(' ')).toMatch(/не найдено в тексте/);
    expect(check('ООО «Альфа»', 1).notes.join(' ')).toMatch(/город упоминания не сверяется/);
  });

  it('объект: реквизиты и форма не применяются, только принадлежность кандидатам', () => {
    const projects = [candidate({ id: 7, legalForm: null }), candidate({ id: 8, legalForm: null })];
    const r = checkAmbiguityChoice({ kind: 'project', surface: 'ЖК Север', body: `ЖК Север, ИНН ${INN_A}`, candidateIds: [7, 8], candidates: projects, chosenId: 8 });
    expect(r.conflicts).toEqual([]);
    expect(r.textLegalForm).toBeNull();
  });
});

describe('текст вокруг упоминания', () => {
  it('окна в code points: эмодзи до упоминания не сдвигает границы', () => {
    const w = mentionWindows('🏗️ ООО «Альфа» строит', 'ООО «Альфа»', 3);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('ООО «Альфа» с');
  });

  it('реквизиты — только самостоятельные числа длиной 10/12/13/15', () => {
    expect(identifiersIn(`ИНН ${INN_A}, телефон 849512345678901234, 12345`)).toEqual([{ type: 'inn', value: INN_A }]);
  });
});

describe('контракт решения (T15A-02)', () => {
  const base = { reason: 'по реквизитам в тексте', expectedVersion: 1, idempotencyKey: 'ambiguity-key-01' };

  it('resolved_to требует сущность; kept_unknown и dismissed — без неё; причина обязательна', () => {
    expect(ambiguityDecisionSchema.safeParse({ ...base, decision: 'resolved_to', entityId: 3 }).success).toBe(true);
    expect(ambiguityDecisionSchema.safeParse({ ...base, decision: 'resolved_to' }).success).toBe(false);
    expect(ambiguityDecisionSchema.safeParse({ ...base, decision: 'kept_unknown', entityId: 3 }).success).toBe(false);
    expect(ambiguityDecisionSchema.safeParse({ ...base, decision: 'dismissed' }).success).toBe(true);
    expect(ambiguityDecisionSchema.safeParse({ ...base, decision: 'dismissed', reason: '  ' }).success).toBe(false);
  });

  it('hash запроса различает сущность и версию, но не пробелы по краям причины', () => {
    const h = (over: object) => decisionRequestHash({ ambiguityId: 1, decision: 'resolved_to', entityId: 2, reason: 'x y', expectedVersion: 1, ...over });
    expect(h({})).toBe(h({ reason: '  x y ' }));
    expect(h({})).not.toBe(h({ entityId: 3 }));
    expect(h({})).not.toBe(h({ expectedVersion: 2 }));
  });

  it('курсор: мусор и подделка отвергаются', () => {
    const good = Buffer.from(JSON.stringify(['2026-09-17T10:00:00.000000Z', 5]), 'utf8').toString('base64url');
    expect(decodeCursor(good)).toEqual({ updatedAt: '2026-09-17T10:00:00.000000Z', id: 5 });
    expect(decodeCursor('не-курсор')).toBeNull();
    expect(decodeCursor(Buffer.from('["x", 1]').toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('токен предпросмотра слияния (T15A-04)', () => {
  const state = { entities: ['1:3:', '2:1:'], evidence: ['10:active', '11:active'], reviews: ['5'] };

  it('не зависит от порядка ключей и строк', () => {
    const reordered = { reviews: ['5'], evidence: ['11:active', '10:active'], entities: ['2:1:', '1:3:'] };
    expect(previewTokenOf('company', 1, 2, reordered)).toBe(previewTokenOf('company', 1, 2, state));
  });

  it('новое доказательство, решение по утверждению или по упоминанию — другой токен', () => {
    const t = previewTokenOf('company', 1, 2, state);
    expect(previewTokenOf('company', 1, 2, { ...state, evidence: [...state.evidence, '12:active'] })).not.toBe(t);
    expect(previewTokenOf('company', 1, 2, { ...state, reviews: ['5', '6'] })).not.toBe(t);
    expect(previewTokenOf('company', 1, 2, { ...state, ambiguityDecisions: ['1'] })).not.toBe(t);
    expect(previewTokenOf('company', 2, 1, state)).not.toBe(t);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
});
