// Решения модели по совпадениям компании с записями ДОМ.РФ — без базы: что делать с записями одной компании.
//
// Компании — одна запись реестра (ADR-012 п. 31): ровно одна «скорее он» (или совпавший ИНН) — «Это он» и
// закрыть остальные; «скорее не он» — отклонить всегда; выбор между несколькими «скорее он» — оператору. Разный ИНН — «не он»
// правилом. Решение оператора после подсказки — последнее слово.

import { describe, expect, it } from 'vitest';

import { planCompanyDecisions, type ILinkState } from './domrfModelDecisions.js';

const link = (over: Partial<ILinkState>): ILinkState => ({
  id: 1,
  company_id: 26,
  company_name: 'Донстрой',
  kind: 'group',
  external_ref: '5661',
  name: 'ДОНСТРОЙ',
  state: 'confirmed',
  verdict: null,
  company_inn: null,
  card_inn: null,
  operator_after_hint: false,
  ...over,
});

describe('решения модели по совпадениям ДОМ.РФ', () => {
  it('«Донстрой»: одна группа «скорее он» — «Это он» по ней; остальные подтверждённые закроет «Это он»', () => {
    const plan = planCompanyDecisions([
      link({ id: 1, external_ref: '5661', name: 'ДОНСТРОЙ', verdict: 'match' }),
      link({ id: 2, external_ref: '7382', name: 'Донстрой', verdict: 'no_match' }),
      link({ id: 3, kind: 'developer', external_ref: '15610', name: 'ООО СЗ ДОНСТРОЙ', verdict: 'no_match' }),
    ]);
    expect(plan).toEqual([expect.objectContaining({ linkId: 1, action: 'confirm' })]);
  });

  it('ни одной «скорее он»: «скорее не он» отклоняются, «не уверена» ждёт оператора', () => {
    const plan = planCompanyDecisions([
      link({ id: 1, verdict: 'no_match', state: 'pending' }),
      link({ id: 2, verdict: 'unsure', state: 'pending' }),
      link({ id: 3, verdict: null, state: 'pending' }),
    ]);
    expect(plan.map(p => [p.linkId, p.action])).toEqual([[1, 'reject']]);
  });

  it('несколько «скорее он» — между ними решает оператор, но «скорее не он» уходят сразу', () => {
    expect(planCompanyDecisions([link({ id: 1, verdict: 'match' }), link({ id: 2, verdict: 'match' })])).toEqual([]);
    const plan = planCompanyDecisions([
      link({ id: 1, external_ref: '5661', verdict: 'match' }),
      link({ id: 2, external_ref: '7382', verdict: 'no_match' }),
      link({ id: 3, kind: 'developer', external_ref: '6107', verdict: 'match' }),
      link({ id: 4, kind: 'developer', external_ref: '15610', verdict: 'no_match' }),
    ]);
    expect(plan.map(p => [p.linkId, p.action])).toEqual([
      [2, 'reject'],
      [4, 'reject'],
    ]);
  });

  it('ИНН решает раньше модели: разный — «не он», совпавший — «Это он» даже при «не уверена»', () => {
    const plan = planCompanyDecisions([
      link({ id: 1, kind: 'developer', company_inn: '7727162286', card_inn: '6165197180', verdict: 'match' }),
      link({ id: 2, kind: 'developer', company_inn: '7727162286', card_inn: '7727162286', verdict: 'unsure', state: 'pending' }),
    ]);
    expect(plan.map(p => [p.linkId, p.action])).toEqual([
      [1, 'reject'],
      [2, 'confirm'],
    ]);
  });

  it('одна подтверждённая «скорее он» и больше ничего — делать нечего', () => {
    expect(planCompanyDecisions([link({ id: 1, verdict: 'match' })])).toEqual([]);
  });

  it('оператор подтвердил запись после подсказки — компанию модель не трогает', () => {
    expect(
      planCompanyDecisions([link({ id: 1, verdict: 'no_match', operator_after_hint: true }), link({ id: 2, verdict: 'match', state: 'pending' })]),
    ).toEqual([]);
  });
});
